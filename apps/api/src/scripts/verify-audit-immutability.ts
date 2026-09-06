import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const expectMutationRejected = async (label: string, mutate: () => Promise<unknown>) => {
  try {
    await mutate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('SecurityAuditLog is append-only')) {
      throw new Error(`${label} failed for an unexpected reason: ${message}`);
    }
    console.log(`PASS SecurityAuditLog ${label} rejected by append-only trigger`);
    return;
  }
  throw new Error(`SecurityAuditLog ${label} unexpectedly succeeded`);
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required and must target a disposable verification database');
  }
  const target = new URL(process.env.DATABASE_URL);
  const databaseName = target.pathname.slice(1);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname);
  const disposableName = /(?:^|[_-])(p0|test|disposable)(?:$|[_-])/i.test(databaseName)
    || databaseName === 'drapixai_launch_gate';
  if (!loopback || !disposableName
    || process.env.DRAPIXAI_DISPOSABLE_DB_APPROVAL !== 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE') {
    throw new Error('Audit mutation tests require an explicitly approved loopback disposable database');
  }

  const unique = crypto.randomUUID();
  const record = await prisma.securityAuditLog.create({
    data: {
      actorRole: 'release-verifier',
      action: 'security.audit.immutability.verify',
      targetType: 'release',
      targetId: unique,
      previousHash: `previous-${unique}`,
      entryHash: `entry-${unique}`,
      metadata: { disposable: true }
    }
  });

  await expectMutationRejected('UPDATE', () => prisma.$executeRawUnsafe(
    'UPDATE "SecurityAuditLog" SET "outcome" = $1 WHERE "id" = $2',
    'tampered',
    record.id
  ));
  await expectMutationRejected('DELETE', () => prisma.$executeRawUnsafe(
    'DELETE FROM "SecurityAuditLog" WHERE "id" = $1',
    record.id
  ));
  await expectMutationRejected('TRUNCATE', () => prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "SecurityAuditLog"'
  ));

  const preserved = await prisma.securityAuditLog.findUnique({ where: { id: record.id } });
  if (!preserved || preserved.outcome !== 'success') {
    throw new Error('SecurityAuditLog verification row was altered despite immutable triggers');
  }
  console.log('PASS SecurityAuditLog row remains unchanged');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
