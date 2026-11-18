import type { PrismaClient } from '@prisma/client';
import { appendSecurityAuditInTransaction } from '../lib/audit-log';
import { DatabaseLockBusy, runDatabaseTransaction } from '../lib/database-transaction';
import { hashPassword, isPasswordInput } from '../lib/password-hash';
import { prisma as runtimePrisma } from '../lib/prisma';

const BOOTSTRAP_ACTION = 'admin.bootstrap.sealed';

export const ensureAdminUser = async (prisma: PrismaClient = runtimePrisma) => {
  if (process.env.DRAPIXAI_ADMIN_BOOTSTRAP_ENABLED !== '1') return;
  const email = (process.env.DRAPIXAI_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.DRAPIXAI_ADMIN_PASSWORD || '';
  if (!email || !isPasswordInput(password) || password.length < 12) {
    throw new Error('ADMIN_BOOTSTRAP_CREDENTIALS_INVALID');
  }

  await runDatabaseTransaction(prisma, async (db) => {
    const [lock] = await db.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext('drapixai-admin-bootstrap')) AS acquired`;
    if (!lock?.acquired) throw new DatabaseLockBusy();
    if (await db.securityAuditLog.findFirst({ where: { action: BOOTSTRAP_ACTION }, select: { id: true } })) return;

    const existing = await db.user.findFirst({ where: { OR: [{ email }, { role: 'system_admin' }] }, select: { id: true } });
    const admin = existing ?? await db.user.create({
      data: {
        email, passwordHash: await hashPassword(password), role: 'system_admin',
        companyName: 'DrapixAI Admin', planType: 'pro', selectedPlan: 'pro',
        subscriptionPlan: 'pro', subscriptionStatus: 'active', subscriptionProvider: 'internal',
      },
      select: { id: true },
    });
    await appendSecurityAuditInTransaction(db, {
      actorRole: 'system', action: BOOTSTRAP_ACTION, targetType: 'user', targetId: admin.id,
      metadata: { created: !existing },
    });
  });
};
