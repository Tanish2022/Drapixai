import assert from 'assert';
import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { getUserMonthlyUsage, incrementApiKeyUsage } from '../lib/usage';

const prisma = new PrismaClient();

const cleanupFixtures = async () => {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'billing-db-' } },
    select: { id: true, apiKeys: { select: { id: true } } },
  });
  const userIds = users.map((user) => user.id);
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
  await cleanupFixtures();
  const marker = crypto.randomUUID();
  const firstEmail = `billing-db-${marker}@example.invalid`;
  const secondEmail = `billing-db-duplicate-${marker}@example.invalid`;
  const customerId = `cus_db_${marker.replace(/-/g, '')}`;
  const subscriptionId = `sub_db_${marker.replace(/-/g, '')}`;
  const eventId = `evt_db_${marker.replace(/-/g, '')}`;

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
  const apiKey = await prisma.apiKey.create({
    data: {
      userId: first.id,
      keyHash: crypto.createHash('sha256').update(marker).digest('hex'),
      kind: 'dashboard',
      domainWhitelist: 'billing-db.example.invalid',
    },
  });

  try {
    const at = new Date('2026-09-10T12:00:00.000Z');
    await incrementApiKeyUsage(prisma, apiKey.id, at);
    await incrementApiKeyUsage(prisma, apiKey.id, at);
    assert.equal(await getUserMonthlyUsage(prisma, first.id, at), 2);

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
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    );

    console.log('PASS exact subscription-period quota rollover');
    console.log('PASS duplicate billing webhook event rejected');
    console.log('PASS duplicate Stripe customer mapping rejected');
  } finally {
    await prisma.billingWebhookEvent.deleteMany({ where: { id: eventId } });
    await cleanupFixtures();
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : 'BILLING_DATABASE_TEST_FAILED');
  await prisma.$disconnect();
  process.exit(1);
});
