import assert from 'assert';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { getUsagePeriodBounds, getUserMonthlyUsage, getUserQuotaUsage } from '../lib/usage';
import { redactShopifyInstallationData } from '../services/shopify-redaction';
import { appendSecurityAudit, verifySecurityAuditChain } from '../lib/audit-log';
import { createTryOnDispatcher } from '../lib/tryon-dispatch';
import { observeTryOnTerminalResponse, type TryOnLease } from '../lib/tryon-concurrency';
import { completePublicTryOn, PUBLIC_TRYON_ROUTE } from '../lib/public-tryon-completion';
import {
  reserveTryOnUsage, markUsageDispatched, releaseUndispatchedUsage, releaseProvenNoResultUsage,
  commitTryOnResultUsage, commitLegacyRenderUsage, QuotaTicket,
} from '../lib/quota-reservations';

// Called only inside the guarded billing fixture. The caller owns cleanup of
// these exact user IDs; no production endpoint or real inference is involved.
export const verifyQuotaReservations = async (prisma: PrismaClient, ownedUsers: number[]) => {
  const url = requireDisposableDatabase(process.env);
  const replica = new PrismaClient({ datasources: { db: { url } } });
  const at = new Date();
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const marker = crypto.randomUUID();
  const user = await prisma.user.create({ data: {
    email: `billing-db-quota-${marker}@example.invalid`, passwordHash: 'synthetic-not-a-login',
    planType: 'starter', subscriptionProvider: 'stripe', subscriptionStatus: 'active',
    subscriptionCurrentPeriodEndsAt: periodEnd,
  } });
  ownedUsers.push(user.id);
  try {
    const keys = await Promise.all([0, 1].map((index) => prisma.apiKey.create({ data: {
      userId: user.id, keyHash: crypto.createHash('sha256').update(`${marker}:${index}`).digest('hex'),
      kind: 'manual', domainWhitelist: 'quota.example.invalid',
    } })));
    const period = getUsagePeriodBounds(user, at);
    await prisma.billingUsagePeriod.create({ data: {
      apiKeyId: keys[0].id, periodStart: period.periodStart, periodEnd: period.periodEnd, renderCount: 999,
    } });
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      reserveTryOnUsage(index % 2 ? prisma : replica, user.id, keys[index % 2].id, crypto.randomUUID(), 'tryon', at)));
    const winners = attempts.filter((item) => item.ok);
    assert.equal(winners.length, 1, 'Only one of twelve requests across replicas/keys may reserve the final quota unit');
    for (const result of attempts.filter((item) => !item.ok)) assert.equal(result.reason, 'QUOTA_EXCEEDED');
    const admitted = winners[0];
    assert.ok(admitted.ok);
    const ticket = admitted.ticket;
    assert.equal(await getUserMonthlyUsage(prisma, user.id, at), 999, 'Reservation is not a charge');
    const snapshot = await getUserQuotaUsage(prisma, user.id, at);
    assert.equal(snapshot.used, 999);
    assert.equal(snapshot.reserved, 1, 'Reporting must expose pending work separately from charged usage');
    await prisma.usageReservation.update({ where: { id: ticket.id }, data: { createdAt: new Date(0) } });
    const stale = await reserveTryOnUsage(prisma, user.id, keys[0].id, crypto.randomUUID(), 'tryon', at);
    assert.deepEqual(stale, { ok: false, reason: 'QUOTA_EXCEEDED' }, 'An old unresolved hold must not expire and oversubscribe work');
    await markUsageDispatched(prisma, ticket);
    await assert.rejects(() => markUsageDispatched(prisma, ticket), /ALREADY_DISPATCHED/);
    assert.equal(await releaseUndispatchedUsage(prisma, ticket), false, 'Dispatched work cannot be released without terminal evidence');
    await assert.rejects(() => releaseUndispatchedUsage(prisma, { ...ticket, userId: user.id + 100000 }), /NOT_FOUND/);
    await assert.rejects(() => releaseUndispatchedUsage(prisma, { ...ticket, apiKeyId: keys[1].id === ticket.apiKeyId ? keys[0].id : keys[1].id }), /NOT_FOUND/);
    const data = (value: QuotaTicket, status: 'generated' | 'rejected' = 'generated') => ({
      userId: value.userId, apiKeyId: value.apiKeyId, requestId: value.requestId,
      engine: 'synthetic-quota-test', status, personImageUrl: null, resultImageUrl: null,
    });
    const committed = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      commitTryOnResultUsage(index % 2 ? prisma : replica, ticket, data(ticket))));
    assert.equal(new Set(committed.map((item) => item.id)).size, 1, 'Settlement retry must not create or charge a second result');
    assert.equal(await getUserMonthlyUsage(prisma, user.id, at), 1000);
    assert.equal(await prisma.securityAuditLog.count({ where: { targetId: ticket.id, action: 'billing.quota_committed' } }), 1);
    assert.equal((await prisma.usage.aggregate({ where: { apiKey: { userId: user.id } }, _sum: { renderCount: true } }))._sum.renderCount, 1);
    assert.equal((await prisma.usageDaily.aggregate({ where: { apiKey: { userId: user.id } }, _sum: { count: true } }))._sum.count, 1);
    console.log('PASS quota final-unit race across two replicas/two keys, durable holds and exactly-once completion');

    const nextEnd = new Date(periodEnd);
    nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
    await prisma.user.update({ where: { id: user.id }, data: { subscriptionCurrentPeriodEndsAt: nextEnd } });
    const nextAt = new Date(periodEnd.getTime() + 3600000);
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 0);
    await commitTryOnResultUsage(replica, ticket, data(ticket));
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 0, 'A late old-period retry must not charge the new period');
    const reserve = async (kind: QuotaTicket['kind'] = 'tryon') => {
      const admission = await reserveTryOnUsage(prisma, user.id, keys[0].id, crypto.randomUUID(), kind, nextAt);
      assert.ok(admission.ok);
      return admission.ticket;
    };
    const rejected = await reserve();
    await markUsageDispatched(prisma, rejected);
    const rejectedResult = await commitTryOnResultUsage(prisma, rejected, data(rejected, 'rejected'));
    assert.equal(rejectedResult.status, 'rejected');
    assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: rejected.id } })).status, 'released');
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 0);
    const neverDispatched = await reserve();
    assert.equal(await releaseUndispatchedUsage(prisma, neverDispatched), true);
    assert.equal(await releaseUndispatchedUsage(prisma, neverDispatched), false);
    assert.deepEqual(await reserveTryOnUsage(prisma, user.id, keys[0].id, neverDispatched.requestId, 'tryon', nextAt),
      { ok: false, reason: 'REQUEST_ALREADY_RESERVED' });
    await assert.rejects(() => commitTryOnResultUsage(prisma, neverDispatched, data(neverDispatched)), /STATE_INVALID/);
    await assert.rejects(() => commitTryOnResultUsage(prisma, ticket, { ...data(ticket), userId: user.id + 1 }), /MISMATCH/);
    await assert.rejects(() => commitTryOnResultUsage(prisma, ticket, { ...data(ticket), personImageUrl: 'synthetic-rejected-reference' }), /MISMATCH/);
    console.log('PASS quota rollover, quality rejection, pre-dispatch release, replay and cross-tenant boundaries');
    for (const reason of ['transport_not_invoked','ai_not_dispatched','ai_terminal_failure'] as const) {
      const noResult = await reserve(); await markUsageDispatched(prisma, noResult);
      await assert.rejects(() => releaseProvenNoResultUsage(prisma, {...noResult, userId: user.id+100000}, reason), /NOT_FOUND/);
      assert.equal(await releaseProvenNoResultUsage(prisma, noResult, reason), true);
      assert.equal(await releaseProvenNoResultUsage(prisma, noResult, reason), false);
      assert.equal(await prisma.tryOnResult.count({where: {requestId: noResult.requestId}}), 0);
    }
    assert.equal(await releaseProvenNoResultUsage(prisma, ticket, 'transport_not_invoked'), false, 'A settled result cannot be uncharged through a no-result cleanup');
    console.log('PASS exact-ticket no-transport/pre-enqueue/terminal-failure quota cleanup is idempotent and cannot change another tenant or settled result');

    const spoolFailure = await reserve();
    const lease: TryOnLease = {
      token: crypto.randomUUID(), tenantKey: 'synthetic', globalKey: 'synthetic', guard: 'synthetic',
      phase: 'reserved', signal: new AbortController().signal,
    };
    const dispatch = createTryOnDispatcher({
      markUsage: markUsageDispatched,
      releaseQuota: releaseProvenNoResultUsage,
      dispatchSlot: async (slot) => { slot.phase = 'dispatched'; },
      observe: observeTryOnTerminalResponse,
      releaseSlot: async (slot) => { assert.equal(slot.phase, 'terminal'); },
    });
    const failedResponse = await dispatch(prisma, spoolFailure, lease, async () => new Response(null, {
      status: 503,
      headers: {
        'x-drapixai-admission-protocol': '1',
        'x-drapixai-work-state': 'not-dispatched',
        'x-request-id': lease.token,
      },
    }));
    assert.equal(failedResponse.status, 503);
    const afterSpoolFailure = await getUserQuotaUsage(prisma, user.id, nextAt);
    assert.equal(afterSpoolFailure.used, 0);
    assert.equal(afterSpoolFailure.reserved, 0);
    assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: spoolFailure.id } })).status, 'released');
    console.log('PASS a confirmed spool failure releases the paid reservation without adding usage');

    const rollback = await reserve();
    await markUsageDispatched(prisma, rollback);
    const identifier = `quota_test_${marker.replace(/-/g, '')}`;
    // A narrowly scoped, disposable-only trigger forces failure AFTER the result
    // insert and first counter write, proving the entire settlement rolls back.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${identifier}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."apiKeyId" = ${keys[0].id} THEN RAISE EXCEPTION 'SYNTHETIC_QUOTA_COUNTER_FAILURE'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${identifier}" BEFORE INSERT OR UPDATE ON "UsageDaily" FOR EACH ROW EXECUTE FUNCTION "${identifier}"()`);
      await assert.rejects(() => commitTryOnResultUsage(prisma, rollback, data(rollback)));
      assert.equal(await prisma.tryOnResult.count({ where: { requestId: rollback.requestId } }), 0);
      assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 0);
      assert.equal((await prisma.usage.aggregate({ where: { apiKey: { userId: user.id } }, _sum: { renderCount: true } }))._sum.renderCount, 1);
      assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: rollback.id } })).status, 'reserved');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${identifier}" ON "UsageDaily"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${identifier}"()`);
    }
    await commitTryOnResultUsage(prisma, rollback, data(rollback));
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 1);
    console.log('PASS atomic result/counter/reservation rollback under a real database failure and successful retry');

    const legacy = await reserve('legacy_render');
    const render = await prisma.render.create({ data: { apiKeyId: legacy.apiKeyId, status: 'pending' } });
    await markUsageDispatched(prisma, legacy, render.id);
    await Promise.all([commitLegacyRenderUsage(prisma, legacy), commitLegacyRenderUsage(replica, legacy)]);
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 2);
    assert.equal(await releaseUndispatchedUsage(prisma, legacy), false);
    const auditFailure = await reserve();
    await markUsageDispatched(prisma, auditFailure);
    const auditIdentifier = identifier + '_audit';
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${auditIdentifier}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId" = '${auditFailure.requestId}' AND NEW."action" = 'billing.quota_committed' THEN RAISE EXCEPTION 'SYNTHETIC_QUOTA_AUDIT_FAILURE'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${auditIdentifier}" BEFORE INSERT ON "SecurityAuditLog" FOR EACH ROW EXECUTE FUNCTION "${auditIdentifier}"()`);
      await assert.rejects(() => commitTryOnResultUsage(prisma, auditFailure, data(auditFailure)));
      assert.equal(await prisma.tryOnResult.count({ where: { requestId: auditFailure.requestId } }), 0);
      assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 2);
      assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: auditFailure.id } })).status, 'reserved');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${auditIdentifier}" ON "SecurityAuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${auditIdentifier}"()`);
    }
    await commitTryOnResultUsage(prisma, auditFailure, data(auditFailure));
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 3);
    assert.equal(await prisma.securityAuditLog.count({ where: { targetId: auditFailure.id, action: 'billing.quota_committed' } }), 1);
    console.log('PASS an immutable-audit insertion failure rolls back result, counters and settlement together');

    const publicTicket = await reserve();
    await markUsageDispatched(prisma, publicTicket);
    const makeReceipt = () => prisma.apiIdempotencyRecord.create({ data: {
      userId: user.id, apiKeyId: keys[0].id, route: PUBLIC_TRYON_ROUTE,
      keyHash: crypto.randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000),
    } });
    const receipt = await makeReceipt();
    const endpoint = await prisma.webhookEndpoint.create({ data: {
      userId: user.id, url: 'https://merchant.example.invalid', events: 'tryon.completed,tryon.rejected',
      encryptedSecret: 'synthetic-unused',
    } });
    const foreignUser = await prisma.user.create({ data: {
      email: `billing-db-foreign-${marker}@example.invalid`, passwordHash: 'synthetic-not-a-login',
    } });
    ownedUsers.push(foreignUser.id);
    const foreignEndpoint = await prisma.webhookEndpoint.create({ data: {
      userId: foreignUser.id, url: 'https://foreign.example.invalid', events: '*', encryptedSecret: 'synthetic-unused',
    } });
    const publicEvent = `evt_${receipt.id}`;
    const finishPublic = (db: PrismaClient, claim = receipt) => commitTryOnResultUsage(db, publicTicket, data(publicTicket),
      (transaction, result) => completePublicTryOn(transaction, claim, result));
    await assert.rejects(() => finishPublic(prisma, { ...receipt, userId: foreignUser.id }), /RESULT_MISMATCH/);
    await assert.rejects(() => finishPublic(prisma, { ...receipt, expiresAt: new Date(0) }), /RECEIPT_LOST/);
    const outboxIdentifier = identifier + '_outbox';
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${outboxIdentifier}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventId" = '${publicEvent}' THEN RAISE EXCEPTION 'SYNTHETIC_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${outboxIdentifier}" BEFORE INSERT ON "WebhookDelivery" FOR EACH ROW EXECUTE FUNCTION "${outboxIdentifier}"()`);
      await assert.rejects(() => finishPublic(prisma), /SYNTHETIC_OUTBOX_FAILURE/);
      assert.equal(await prisma.tryOnResult.count({ where: { requestId: publicTicket.requestId } }), 0);
      assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 3);
      assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: publicTicket.id } })).status, 'reserved');
      assert.equal((await prisma.apiIdempotencyRecord.findUniqueOrThrow({ where: { id: receipt.id } })).state, 'processing');
      assert.equal(await prisma.webhookDelivery.count({ where: { eventId: publicEvent } }), 0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${outboxIdentifier}" ON "WebhookDelivery"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${outboxIdentifier}"()`);
    }
    const completed = await Promise.all([finishPublic(prisma), finishPublic(replica)]);
    assert.equal(completed[0].id, completed[1].id);
    const durableReceipt = await replica.apiIdempotencyRecord.findUniqueOrThrow({ where: { id: receipt.id } });
    assert.equal(durableReceipt.state, 'completed');
    assert.equal(durableReceipt.responseStatus, 200);
    assert.equal(durableReceipt.tryOnResultId, completed[0].id);
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 4);
    const events = await replica.webhookDelivery.findMany({ where: { eventId: publicEvent } });
    assert.deepEqual(events.map((event) => event.endpointId), [endpoint.id]);
    assert.equal(events[0].eventType, 'tryon.completed');
    assert.deepEqual(Object.keys((events[0].payload as { data: object }).data).sort(),
      ['latency_ms', 'product_id', 'quality_score', 'status', 'tryon_id', 'warnings']);

    const publicRejected = await reserve();
    await markUsageDispatched(prisma, publicRejected);
    const rejectedReceipt = await makeReceipt();
    const rejectedPublicResult = await commitTryOnResultUsage(prisma, publicRejected, data(publicRejected, 'rejected'),
      (transaction, result) => completePublicTryOn(transaction, rejectedReceipt, result));
    assert.equal(rejectedPublicResult.resultImageUrl, null);
    assert.equal((await prisma.apiIdempotencyRecord.findUniqueOrThrow({ where: { id: rejectedReceipt.id } })).responseStatus, 422);
    assert.equal(await prisma.webhookDelivery.count({ where: { eventId: `evt_${rejectedReceipt.id}`, eventType: 'tryon.rejected' } }), 1);
    assert.equal(await prisma.webhookDelivery.count({ where: { endpointId: foreignEndpoint.id } }), 0);
    assert.equal(await getUserMonthlyUsage(prisma, user.id, nextAt), 4);
    console.log('PASS public result, receipt, quota and tenant-scoped webhook commit together, with rollback, duplicate settlement and quality rejection');

    await prisma.apiKey.update({ where: { id: keys[0].id }, data: { isActive: false } });
    assert.deepEqual(await reserveTryOnUsage(prisma, user.id, keys[0].id, crypto.randomUUID(), 'tryon', nextAt),
      { ok: false, reason: 'API_KEY_INACTIVE' });
    await prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: 'past_due' } });
    assert.deepEqual(await reserveTryOnUsage(prisma, user.id, keys[1].id, crypto.randomUUID(), 'tryon', nextAt),
      { ok: false, reason: 'PLAN_INACTIVE' });
    console.log('PASS legacy queue admission exactly once, key revocation and fresh subscription denial');
    await prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: 'active' } });
    const heldForRedaction = await reserveTryOnUsage(prisma, user.id, keys[1].id, crypto.randomUUID(), 'tryon', nextAt);
    assert.ok(heldForRedaction.ok);
    await markUsageDispatched(prisma, heldForRedaction.ticket);
    const installation = await prisma.shopifyInstallation.create({ data: {
      userId: user.id, shopDomain: `quota-${marker}.myshopify.com`, storefrontApiKeyId: keys[1].id,
      encryptedAccessToken: 'synthetic-not-a-token', scopes: 'read_products',
    } });
    await redactShopifyInstallationData(prisma, installation);
    const redactedKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: keys[1].id } });
    assert.equal(redactedKey.isActive, false);
    assert.equal(redactedKey.domainWhitelist, 'redacted.invalid');
    assert.equal(redactedKey.scopes, '');
    assert.equal(await prisma.shopifyInstallation.findUnique({ where: { id: installation.id } }), null);
    assert.equal((await prisma.usageReservation.findUniqueOrThrow({ where: { id: heldForRedaction.ticket.id } })).status, 'reserved');
    await assert.rejects(() => prisma.apiKey.delete({ where: { id: keys[1].id } }));
    console.log('PASS storefront redaction revokes access without erasing unsettled quota or accounting references');
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendSecurityAudit(index % 2 ? prisma : replica, {
      actorUserId: user.id, actorRole: 'system', action: 'billing.synthetic_concurrency_probe',
      targetType: 'quota_test', targetId: marker, metadata: { index },
    })));
    assert.ok((await verifySecurityAuditChain(prisma)).valid, 'Concurrent quota-related audit writes must preserve one valid chain');
    console.log('PASS concurrent audit writes across replicas preserve the immutable chain');

    for (const [planType, quota] of [['growth', 7500], ['pro', 25000]] as const) {
      const paidUser = await prisma.user.create({ data: {
        email: `billing-db-quota-${planType}-${marker}@example.invalid`,
        passwordHash: 'synthetic-not-a-login',
        planType,
        subscriptionProvider: 'stripe',
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEndsAt: periodEnd,
      } });
      ownedUsers.push(paidUser.id);
      const key = await prisma.apiKey.create({ data: {
        userId: paidUser.id,
        keyHash: crypto.createHash('sha256').update(`${marker}:${planType}`).digest('hex'),
        kind: 'manual',
        domainWhitelist: 'quota.example.invalid',
      } });
      const paidPeriod = getUsagePeriodBounds(paidUser, at);
      const usage = await prisma.billingUsagePeriod.create({ data: {
        apiKeyId: key.id,
        periodStart: paidPeriod.periodStart,
        periodEnd: paidPeriod.periodEnd,
        renderCount: 1200,
      } });
      const reservePaid = () => reserveTryOnUsage(prisma, paidUser.id, key.id, crypto.randomUUID(), 'tryon', at);
      const aboveOldCap = await reservePaid();
      assert.ok(aboveOldCap.ok);
      assert.equal(aboveOldCap.plan.quota, quota);
      assert.equal(await releaseUndispatchedUsage(prisma, aboveOldCap.ticket), true);
      await prisma.billingUsagePeriod.update({ where: { id: usage.id }, data: { renderCount: quota - 1 } });
      const lastUnit = await reservePaid();
      assert.ok(lastUnit.ok);
      await markUsageDispatched(prisma, lastUnit.ticket);
      await commitTryOnResultUsage(prisma, lastUnit.ticket, data(lastUnit.ticket));
      assert.equal(await getUserMonthlyUsage(prisma, paidUser.id, at), quota);
      assert.deepEqual(await reservePaid(), { ok: false, reason: 'QUOTA_EXCEEDED' });
      console.log(`PASS ${planType} admits usage above 1200 and stops at its paid allowance of ${quota}`);
    }
  } finally {
    await replica.$disconnect();
  }
};
