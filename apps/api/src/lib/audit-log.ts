import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

type AuditInput = {
  actorUserId?: number | null;
  actorRole: string;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  outcome?: 'success' | 'failure' | 'denied';
  requestId?: string | null;
  ip?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

const auditSecret = () => {
  const secret = (process.env.DRAPIXAI_AUDIT_LOG_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('AUDIT_LOG_SECRET_NOT_CONFIGURED');
  }
  return secret || 'development-audit-secret-not-for-production';
};

const hashIp = (ip: string | null | undefined) => ip
  ? crypto.createHmac('sha256', auditSecret()).update(ip).digest('hex')
  : null;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const buildAuditHash = (payload: Record<string, unknown>) => crypto
  .createHmac('sha256', auditSecret())
  .update(JSON.stringify(canonicalize(payload)))
  .digest('hex');

export const appendSecurityAudit = async (prisma: PrismaClient, input: AuditInput) => {
  const createdAt = new Date();
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('drapixai-security-audit-chain'))`;
    const previous = await transaction.securityAuditLog.findFirst({
      orderBy: { id: 'desc' },
      select: { entryHash: true },
    });
    const previousHash = previous?.entryHash || 'GENESIS';
    const payload = {
      actorUserId: input.actorUserId || null,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId === undefined || input.targetId === null ? null : String(input.targetId),
      outcome: input.outcome || 'success',
      requestId: input.requestId || null,
      ipHash: hashIp(input.ip),
      metadata: input.metadata || null,
      previousHash,
      createdAt: createdAt.toISOString(),
    };
    const entryHash = buildAuditHash(payload);
    return transaction.securityAuditLog.create({
      data: {
        actorUserId: input.actorUserId || null,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType || null,
        targetId: input.targetId === undefined || input.targetId === null ? null : String(input.targetId),
        outcome: input.outcome || 'success',
        requestId: input.requestId || null,
        ipHash: hashIp(input.ip),
        metadata: input.metadata ? input.metadata as Prisma.InputJsonValue : undefined,
        previousHash,
        entryHash,
        createdAt,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

export const verifySecurityAuditChain = async (prisma: PrismaClient) => {
  const entries = await prisma.securityAuditLog.findMany({ orderBy: { id: 'asc' } });
  let expectedPreviousHash = 'GENESIS';
  for (const entry of entries) {
    if (entry.previousHash !== expectedPreviousHash) {
      return { valid: false, checked: entries.length, invalidEntryId: entry.id, reason: 'PREVIOUS_HASH_MISMATCH' };
    }
    const expectedHash = buildAuditHash({
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      outcome: entry.outcome,
      requestId: entry.requestId,
      ipHash: entry.ipHash,
      metadata: entry.metadata,
      previousHash: entry.previousHash,
      createdAt: entry.createdAt.toISOString(),
    });
    if (
      !/^[a-f0-9]{64}$/.test(entry.entryHash)
      || !crypto.timingSafeEqual(Buffer.from(entry.entryHash, 'hex'), Buffer.from(expectedHash, 'hex'))
    ) {
      return { valid: false, checked: entries.length, invalidEntryId: entry.id, reason: 'ENTRY_HASH_MISMATCH' };
    }
    expectedPreviousHash = entry.entryHash;
  }
  return { valid: true, checked: entries.length, invalidEntryId: null, reason: null };
};
