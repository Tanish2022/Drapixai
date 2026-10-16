import { Prisma, PrismaClient } from '@prisma/client';
import { getPlanAccessContext, TRIAL_DAYS } from './plans';
import { getUsagePeriodBounds, incrementUsageInTransaction, lockAccountUsage } from './usage';
import { runDatabaseTransaction } from './database-transaction';
import { appendSecurityAuditInTransaction } from './audit-log';

export type QuotaTicket = {
  id: string; userId: number; apiKeyId: number; requestId: string; kind: 'tryon' | 'legacy_render';
};

export const reserveTryOnUsage = async (
  prisma: PrismaClient, userId: number, apiKeyId: number, requestId: string,
  kind: QuotaTicket['kind'] = 'tryon', at = new Date(),
) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)
    || !['tryon', 'legacy_render'].includes(kind) || !Number.isFinite(at.getTime())) {
    throw new Error('QUOTA_REQUEST_INVALID');
  }
  return runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, userId);
    const key = await transaction.apiKey.findFirst({
      where: { id: apiKeyId, userId, isActive: true, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] }, include: { user: true },
    });
    if (!key) return { ok: false as const, reason: 'API_KEY_INACTIVE' as const };
    const user = key.user;
    const plan = getPlanAccessContext({ ...user, at,
      trialExpiresAt: user.trialExpiresAt || new Date(user.createdAt.getTime() + TRIAL_DAYS * 86400000),
    });
    if (!plan.active || !Number.isSafeInteger(plan.quota) || plan.quota <= 0) {
      return { ok: false as const, reason: 'PLAN_INACTIVE' as const };
    }
    if (await transaction.usageReservation.findUnique({ where: { requestId } })) {
      return { ok: false as const, reason: 'REQUEST_ALREADY_RESERVED' as const };
    }
    const period = getUsagePeriodBounds(user, at);
    if (period.periodEnd <= period.periodStart) throw new Error('QUOTA_PERIOD_INVALID');
    const used = await transaction.billingUsagePeriod.aggregate({
      where: { periodStart: period.periodStart, periodEnd: period.periodEnd, apiKey: { userId } },
      _sum: { renderCount: true },
    });
    // Reserved work never expires merely with time: the remote worker may still
    // be running after an API failure. Only terminal evidence may settle it.
    const held = await transaction.usageReservation.count({
      where: { userId, periodStart: period.periodStart, periodEnd: period.periodEnd, status: 'reserved' },
    });
    if ((used._sum.renderCount || 0) + held >= plan.quota) {
      return { ok: false as const, reason: 'QUOTA_EXCEEDED' as const };
    }
    const reservation = await transaction.usageReservation.create({ data: {
      requestId, userId, apiKeyId, kind, quota: plan.quota, admittedAt: at,
      periodStart: period.periodStart, periodEnd: period.periodEnd,
    } });
    const ticket: QuotaTicket = { id: reservation.id, userId, apiKeyId, requestId, kind };
    await auditReservation(transaction, ticket, 'billing.quota_reserved', { quota: plan.quota });
    return { ok: true as const, ticket, plan };
  });
};

const readTicket = async (transaction: Prisma.TransactionClient, ticket: QuotaTicket) => {
  const reservation = await transaction.usageReservation.findFirst({ where: ticket });
  if (!reservation) throw new Error('QUOTA_RESERVATION_NOT_FOUND');
  return reservation;
};

const auditReservation = (transaction: Prisma.TransactionClient, ticket: QuotaTicket, action: string,
  metadata: Record<string, string | number | boolean | null> = {}) => appendSecurityAuditInTransaction(transaction, {
  actorUserId: ticket.userId, actorRole: 'system', action,
  targetType: 'usage_reservation', targetId: ticket.id, requestId: ticket.requestId,
  metadata: { kind: ticket.kind, ...metadata },
});

export const markUsageDispatched = async (prisma: PrismaClient, ticket: QuotaTicket, renderId?: number) => {
  await runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, ticket.userId);
    const reservation = await readTicket(transaction, ticket);
    if (reservation.status !== 'reserved' || reservation.dispatchedAt) throw new Error('QUOTA_ALREADY_DISPATCHED');
    if (ticket.kind === 'legacy_render') {
      if (!renderId || !await transaction.render.findFirst({ where: { id: renderId, apiKeyId: ticket.apiKeyId } })) {
        throw new Error('QUOTA_RENDER_NOT_FOUND');
      }
    } else if (renderId !== undefined) throw new Error('QUOTA_KIND_MISMATCH');
    await transaction.usageReservation.update({ where: { id: ticket.id }, data: { dispatchedAt: new Date(), renderId } });
    await auditReservation(transaction, ticket, 'billing.quota_dispatched');
  });
};

export const releaseUndispatchedUsage = async (prisma: PrismaClient, ticket: QuotaTicket) => {
  return runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, ticket.userId);
    const reservation = await readTicket(transaction, ticket);
    if (reservation.status !== 'reserved' || reservation.dispatchedAt) return false;
    await transaction.usageReservation.update({ where: { id: ticket.id }, data: { status: 'released', settledAt: new Date() } });
    await auditReservation(transaction, ticket, 'billing.quota_released', { reason: 'not_dispatched' });
    return true;
  });
};

export const commitTryOnResultUsage = async (
  prisma: PrismaClient, ticket: QuotaTicket, data: Prisma.TryOnResultUncheckedCreateInput,
) => {
  if (ticket.kind !== 'tryon' || data.userId !== ticket.userId || data.apiKeyId !== ticket.apiKeyId
    || data.requestId !== ticket.requestId || !['generated', 'rejected'].includes(data.status || '')
    || data.personImageUrl != null || data.resultImageUrl != null) {
    throw new Error('QUOTA_RESULT_MISMATCH');
  }
  return runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, ticket.userId);
    const reservation = await readTicket(transaction, ticket);
    if (reservation.tryOnResultId !== null) {
      return transaction.tryOnResult.findUniqueOrThrow({ where: { id: reservation.tryOnResultId } });
    }
    if (reservation.status !== 'reserved' || !reservation.dispatchedAt) throw new Error('QUOTA_RESULT_STATE_INVALID');
    const result = await transaction.tryOnResult.create({ data });
    const billable = data.status === 'generated';
    if (billable) await incrementUsageInTransaction(transaction, ticket.apiKeyId, reservation.admittedAt, reservation);
    await transaction.usageReservation.update({ where: { id: ticket.id }, data: {
      status: billable ? 'committed' : 'released', settledAt: new Date(), tryOnResultId: result.id,
    } });
    await auditReservation(transaction, ticket, billable ? 'billing.quota_committed' : 'billing.quota_released', {
      tryOnResultId: result.id, reason: billable ? 'generated' : 'quality_rejected',
    });
    return result;
  });
};

export const commitLegacyRenderUsage = async (prisma: PrismaClient, ticket: QuotaTicket) => {
  return runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, ticket.userId);
    const reservation = await readTicket(transaction, ticket);
    if (ticket.kind !== 'legacy_render' || !reservation.renderId || !reservation.dispatchedAt) throw new Error('QUOTA_RENDER_STATE_INVALID');
    if (reservation.status === 'committed') return;
    if (reservation.status !== 'reserved') throw new Error('QUOTA_RENDER_STATE_INVALID');
    await incrementUsageInTransaction(transaction, ticket.apiKeyId, reservation.admittedAt, reservation);
    await transaction.usageReservation.update({ where: { id: ticket.id }, data: { status: 'committed', settledAt: new Date() } });
    await auditReservation(transaction, ticket, 'billing.quota_committed', { renderId: reservation.renderId, reason: 'legacy_queued' });
  });
};
