import assert from 'assert';
import { createClient } from 'redis';
import { claimWebhookDelivery } from '../services/webhooks';

const main = async () => {
  process.env.NODE_ENV = 'test';
  process.env.DRAPIXAI_MAX_CONCURRENT_TRYONS = '3';
  process.env.DRAPIXAI_TENANT_MAX_CONCURRENT_TRYONS = '1';
  process.env.DRAPIXAI_TRYON_SLOT_LEASE_MS = '30000';

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const controlRedis = createClient({ url: redisUrl });
  try {
    await controlRedis.connect();
  } catch {
    throw new Error(`DISTRIBUTED_SECURITY_REDIS_UNAVAILABLE: start Redis or set REDIS_URL to a reachable isolated test instance (${redisUrl}).`);
  }
  const keys = await controlRedis.keys('drapixai:tryon-concurrency:*');
  if (keys.length > 0) await controlRedis.del(keys);

  const concurrency = await import('../lib/tryon-concurrency');
  const first = await concurrency.acquireTryOnSlot(101);
  assert.equal(first.ok, true);
  const sameTenant = await concurrency.acquireTryOnSlot(101);
  assert.deepStrictEqual(sameTenant, { ok: false, reason: 'TENANT_CONCURRENCY_LIMIT' });

  const second = await concurrency.acquireTryOnSlot(102);
  const third = await concurrency.acquireTryOnSlot(103);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  const globalOverflow = await concurrency.acquireTryOnSlot(104);
  assert.deepStrictEqual(globalOverflow, { ok: false, reason: 'GLOBAL_CAPACITY_BUSY' });

  if (first.ok) await concurrency.releaseTryOnSlot(first.lease);
  const afterRelease = await concurrency.acquireTryOnSlot(104);
  assert.equal(afterRelease.ok, true, 'A released GPU slot must become available immediately');

  for (const result of [second, third, afterRelease]) {
    if (result.ok) await concurrency.releaseTryOnSlot(result.lease);
  }
  await concurrency.closeTryOnConcurrencyForTests();
  await controlRedis.quit();

  let claimed = false;
  const mockPrisma = {
    webhookDelivery: {
      updateMany: async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      },
    },
  } as any;
  const now = new Date();
  const staleAt = new Date(now.getTime() - 300_000);
  const [claimA, claimB] = await Promise.all([
    claimWebhookDelivery(mockPrisma, 'delivery-1', now, staleAt),
    claimWebhookDelivery(mockPrisma, 'delivery-1', now, staleAt),
  ]);
  assert.deepStrictEqual([claimA.count, claimB.count].sort(), [0, 1], 'Only one API replica may claim a webhook delivery');

  console.log('Distributed concurrency and webhook claim tests passed.');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
