import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { purgeDeliveryMetadata } from '../services/delivery-retention';
import { claimTrialReminder } from '../services/trial_notifier';
import { encryptWebhookSecret, processPendingWebhookDeliveries } from '../services/webhooks';

export const verifyOperationalSafety = async (prisma: PrismaClient) => {
  const replica = new PrismaClient({ datasourceUrl: requireDisposableDatabase(process.env) });
  const previousKey = process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY;
  process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const now = new Date();
  const user = await prisma.user.create({ data: {
    email: `ops-fixture-${randomUUID()}@example.invalid`, passwordHash: 'synthetic',
    planType: 'trial', trialExpiresAt: new Date(now.getTime() + 3600_000),
  } });
  try {
    const claims = await Promise.all([claimTrialReminder(prisma, user.id, now), claimTrialReminder(replica, user.id, now)]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await claimTrialReminder(replica, user.id, now), null);
    assert.equal(await prisma.emailLog.count({ where: { userId: user.id, event: 'trial_reminder_claim', email: '' } }), 1);
    console.log('PASS durable once-per-day trial reminder claim across PostgreSQL connections');

    const endpoint = await prisma.webhookEndpoint.create({ data: {
      userId: user.id, url: 'https://synthetic.example.invalid/webhook', events: 'tryon.completed', encryptedSecret: encryptWebhookSecret('synthetic'),
    } });
    const delivery = await prisma.webhookDelivery.create({ data: {
      endpointId: endpoint.id, eventType: 'tryon.completed', eventId: randomUUID(), payload: { synthetic: true },
    } });
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    const oldWorker = processPendingWebhookDeliveries(prisma, 1, async () => {
      entered();
      await paused;
      throw new Error('SYNTHETIC_OLD_ATTEMPT_FAILED');
    });
    await Promise.race([waiting, oldWorker.then(() => { throw Error('OLD_WORKER_DID_NOT_CLAIM'); })]);
    try {
      await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { updatedAt: new Date(Date.now() - 360_000) } });
      await processPendingWebhookDeliveries(replica, 1, async () => ({ status: 204, body: Buffer.alloc(0) }));
    } finally { release(); }
    await oldWorker;
    const delivered = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.attemptCount, 2);
    assert.equal(delivered.responseCode, 204);
    console.log('PASS a stale webhook worker cannot overwrite a newer successful delivery');

    const old = new Date(now.getTime() - 14 * 86400_000);
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { updatedAt: old } });
    const pending = await prisma.webhookDelivery.create({ data: {
      endpointId: endpoint.id, eventType: 'tryon.completed', eventId: randomUUID(), payload: {}, updatedAt: old,
    } });
    await prisma.emailLog.create({ data: { userId: user.id, email: user.email, event: 'synthetic', status: 'sent', createdAt: old } });
    assert.deepEqual(await purgeDeliveryMetadata(prisma, { emailDays: 0, webhookDays: 0 }, now), { email: 0, webhooks: 0 });
    assert.deepEqual(await purgeDeliveryMetadata(prisma, { emailDays: 7, webhookDays: 7 }, now), { email: 1, webhooks: 1 });
    assert.equal(await prisma.webhookDelivery.count({ where: { id: pending.id, status: 'pending' } }), 1);
    assert.equal(await prisma.emailLog.count({ where: { userId: user.id, event: 'trial_reminder_claim' } }), 1);
    console.log('PASS delivery retention is opt-in and preserves fresh claims and pending webhook deliveries');
  } finally {
    await prisma.emailLog.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await replica.$disconnect();
    if (previousKey === undefined) delete process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY;
    else process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY = previousKey;
  }
};
