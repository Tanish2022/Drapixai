import crypto from 'crypto';
import { createRequestRedis } from './request-redis';
import { formatLogError } from './security';

type TryOnLease = {
  token: string;
  tenantKey: string;
  globalKey: string;
};

type AcquireResult =
  | { ok: true; lease: TryOnLease }
  | { ok: false; reason: 'TENANT_CONCURRENCY_LIMIT' | 'GLOBAL_CAPACITY_BUSY' | 'CONCURRENCY_CONTROL_UNAVAILABLE' };

const redis = createRequestRedis('Try-on concurrency');

const ACQUIRE_SCRIPT = `
local global_key = KEYS[1]
local tenant_key = KEYS[2]
local now = tonumber(ARGV[1])
local expires_at = tonumber(ARGV[2])
local global_limit = tonumber(ARGV[3])
local tenant_limit = tonumber(ARGV[4])
local token = ARGV[5]

redis.call('ZREMRANGEBYSCORE', global_key, '-inf', now)
redis.call('ZREMRANGEBYSCORE', tenant_key, '-inf', now)

if redis.call('ZCARD', tenant_key) >= tenant_limit then
  return 1
end
if redis.call('ZCARD', global_key) >= global_limit then
  return 2
end

redis.call('ZADD', global_key, expires_at, token)
redis.call('ZADD', tenant_key, expires_at, token)
redis.call('PEXPIRE', global_key, expires_at - now + 5000)
redis.call('PEXPIRE', tenant_key, expires_at - now + 5000)
return 0
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const acquireTryOnSlot = async (tenantId: number): Promise<AcquireResult> => {
  const globalLimit = positiveInteger(process.env.DRAPIXAI_MAX_CONCURRENT_TRYONS, 3);
  const tenantLimit = Math.min(
    positiveInteger(process.env.DRAPIXAI_TENANT_MAX_CONCURRENT_TRYONS, 1),
    globalLimit,
  );
  const leaseMs = positiveInteger(process.env.DRAPIXAI_TRYON_SLOT_LEASE_MS, 120_000);
  const token = crypto.randomUUID();
  const globalKey = 'drapixai:tryon-concurrency:global';
  const tenantKey = `drapixai:tryon-concurrency:tenant:${tenantId}`;

  try {
    const result = await redis.run(client => {
      const now = Date.now();
      return client.eval(ACQUIRE_SCRIPT, {
        keys: [globalKey, tenantKey],
        arguments: [
          String(now),
          String(now + leaseMs),
          String(globalLimit),
          String(tenantLimit),
          token,
        ],
      });
    });
    if (result === 1) return { ok: false, reason: 'TENANT_CONCURRENCY_LIMIT' };
    if (result === 2) return { ok: false, reason: 'GLOBAL_CAPACITY_BUSY' };
    if (result !== 0) throw new Error('CONCURRENCY_REPLY_INVALID');
    return { ok: true, lease: { token, tenantKey, globalKey } };
  } catch (error) {
    console.error('Try-on concurrency acquire failed:', formatLogError(error));
    return { ok: false, reason: 'CONCURRENCY_CONTROL_UNAVAILABLE' };
  }
};

export const releaseTryOnSlot = async (lease: TryOnLease) => {
  try {
    await redis.run(client => client.eval(RELEASE_SCRIPT, {
      keys: [lease.globalKey, lease.tenantKey],
      arguments: [lease.token],
    }));
  } catch (error) {
    // The lease expires automatically; log release failures without masking the try-on response.
    console.error('Try-on concurrency release failed:', formatLogError(error));
  }
};

export const closeTryOnConcurrencyForTests = async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION');
  await redis.close();
};
