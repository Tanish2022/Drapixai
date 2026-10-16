import assert from 'assert';
import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { getUserMonthlyUsage, incrementApiKeyUsage } from '../lib/usage';
import { requireDisposableDatabase } from '../lib/disposable-database';

const cleanupFixtures = async (prisma: PrismaClient, userIds: number[]) => {
  if (!userIds.length) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, apiKeys: { select: { id: true } } },
  });
  const apiKeyIds = users.flatMap((user) => user.apiKeys.map((apiKey) => apiKey.id));
  if (apiKeyIds.length > 0) {
    await prisma.$transaction([
      prisma.billingUsagePeriod.deleteMany({ where: { apiKeyId: { in: apiKeyIds } } }),
      prisma.usageDaily.deleteMany({ where: { apiKeyId: { in: apiKeyIds } } }),
      prisma.usage.deleteMany({ where: { apiKeyId: { in: apiKeyIds } } }),
      prisma.apiKey.deleteMany({ where: { id: { in: apiKeyIds } } }),
    ]);
  }
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
};

const main = async () => {
  // Validate before constructing Prisma or making any query. Explicitly pass
  // the validated URL so later .env loading cannot redirect this test.
  const databaseUrl = requireDisposableDatabase(process.env);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const userIds: number[] = [];
  let ownsEvent = false;
  let sentinelId: number | null = null;
  const marker = crypto.randomUUID();
  const firstEmail = `billing-db-${marker}@example.invalid`;
  const secondEmail = `billing-db-duplicate-${marker}@example.invalid`;
  const customerId = `cus_db_${marker.replace(/-/g, '')}`;
  const subscriptionId = `sub_db_${marker.replace(/-/g, '')}`;
  const eventId = `evt_db_${marker.replace(/-/g, '')}`;

  try {
    const first = await prisma.user.create({
      data: {
        email: firstEmail,
        passwordHash: 'not-a-real-login',
        planType: 'growth',
        selectedPlan: 'growth',
        subscriptionPlan: 'growth',
        subscriptionStatus: 'active',
        subscriptionProvider: 'stripe',
        subscriptionCustomerId: customerId,
        subscriptionId,
        subscriptionCurrentPeriodEndsAt: new Date('2026-09-30T18:30:00.000Z'),
      },
    });
    userIds.push(first.id);
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: first.id,
        keyHash: crypto.createHash('sha256').update(marker).digest('hex'),
        kind: 'dashboard',
        domainWhitelist: 'billing-db.example.invalid',
      },
    });

    const at = new Date('2026-09-10T12:00:00.000Z');
    await incrementApiKeyUsage(prisma, apiKey.id, at);
    await incrementApiKeyUsage(prisma, apiKey.id, at);
    assert.equal(await getUserMonthlyUsage(prisma, first.id, at), 2);

    const secondKey = await prisma.apiKey.create({ data: {
      userId: first.id,
      keyHash: crypto.createHash('sha256').update(`${marker}:second-key`).digest('hex'),
      kind: 'manual', domainWhitelist: 'billing-db-second.example.invalid',
    } });
    await Promise.all(Array.from({ length: 16 }, (_, index) =>
      incrementApiKeyUsage(prisma, index % 2 ? apiKey.id : secondKey.id, at)));
    assert.equal(await getUserMonthlyUsage(prisma, first.id, at), 18, 'Concurrent increments across keys must not be lost');
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { isActive: false } });
    assert.equal(await getUserMonthlyUsage(prisma, first.id, at), 18, 'Revoking a key must not erase account usage');

    await prisma.user.update({
      where: { id: first.id },
      data: { subscriptionCurrentPeriodEndsAt: new Date('2026-10-31T18:30:00.000Z') },
    });
    const nextPeriodAt = new Date('2026-10-10T12:00:00.000Z');
    assert.equal(await getUserMonthlyUsage(prisma, first.id, nextPeriodAt), 0);
    await incrementApiKeyUsage(prisma, apiKey.id, nextPeriodAt);
    assert.equal(await getUserMonthlyUsage(prisma, first.id, nextPeriodAt), 1);

    await prisma.billingWebhookEvent.create({
      data: { id: eventId, type: 'invoice.paid', livemode: false },
    });
    ownsEvent = true;
    await assert.rejects(
      () => prisma.billingWebhookEvent.create({
        data: { id: eventId, type: 'invoice.paid', livemode: false },
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );

    await assert.rejects(
      () => prisma.user.create({
        data: {
          email: secondEmail,
          passwordHash: 'not-a-real-login',
          subscriptionCustomerId: customerId,
        },
      }).then((created) => { userIds.push(created.id); return created; }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );

    console.log('PASS exact subscription-period quota rollover');
    console.log('PASS concurrent cross-key usage increments and revoked-key accounting');
    console.log('PASS duplicate billing webhook event rejected');
    console.log('PASS duplicate Stripe customer mapping rejected');
    const sentinel = await prisma.user.create({ data: {
      email: `billing-db-preserve-${marker}@example.invalid`, passwordHash: 'synthetic-not-a-login',
    } });
    sentinelId = sentinel.id;
    await cleanupFixtures(prisma, userIds);
    assert.ok(await prisma.user.findUnique({ where: { id: sentinelId } }), 'Cleanup must preserve another fixture sharing the email prefix');
    console.log('PASS cleanup is restricted to this run\'s exact fixture IDs');
  } finally {
    try {
      if (ownsEvent) await prisma.billingWebhookEvent.deleteMany({ where: { id: eventId } });
      await cleanupFixtures(prisma, userIds);
    } finally {
      try {
        if (sentinelId !== null) await prisma.user.deleteMany({ where: { id: sentinelId } });
      } finally {
        await prisma.$disconnect();
      }
    }
  }
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : 'BILLING_DATABASE_TEST_FAILED');
  process.exit(1);
});
