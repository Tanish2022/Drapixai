import crypto from 'crypto';
import type { createClient } from 'redis';
import { createRequestRedis } from './request-redis';

export const ADMISSION_KEYS = {
  global: 'drapixai:tryon-concurrency:global',
  guard: 'drapixai:tryon-concurrency:worker-idle-ack',
  work: 'drapixai:tryon-concurrency:dispatched',
  uncertain: 'drapixai:tryon-concurrency:uncertain',
};
type Client = ReturnType<typeof createClient>;
export type TryOnLease = {
  token: string; tenantKey: string; globalKey: string; guard: string;
  signal: AbortSignal; phase: 'reserved' | 'dispatched' | 'terminal' | 'uncertain' | 'expired';
};
type AcquireResult =
  | { ok: true; lease: TryOnLease }
  | { ok: false; reason: 'TENANT_CONCURRENCY_LIMIT' | 'GLOBAL_CAPACITY_BUSY' | 'CONCURRENCY_CONTROL_UNAVAILABLE' };
const redis = createRequestRedis('Try-on concurrency');
const heartbeats = new Map<string, { stop: () => void }>();
const NOW = `local t = redis.call('TIME'); local now = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000)`;
const TTL = `
local function refresh(key)
  local last = redis.call('ZRANGE', key, -1, -1, 'WITHSCORES')
  if #last == 0 then return end
  if last[2] == 'inf' then redis.call('PERSIST', key)
  else redis.call('PEXPIRE', key, math.max(1, tonumber(last[2])-now+5000)) end
end`;
const ACQUIRE_SCRIPT = `
if redis.call('GET', KEYS[3]) ~= ARGV[5] then return 3 end
${NOW}
${TTL}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 1 end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 2 end
redis.call('ZADD', KEYS[1], now+tonumber(ARGV[1]), ARGV[4])
redis.call('ZADD', KEYS[2], now+tonumber(ARGV[1]), ARGV[4])
refresh(KEYS[1]); refresh(KEYS[2]); return 0`;
const RENEW_SCRIPT = `
if redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
${NOW}
${TTL}
for i=1,2 do
 local score=redis.call('ZSCORE', KEYS[i], ARGV[1])
 if not score or score=='inf' or tonumber(score)<=now then return 0 end
end
for i=1,2 do redis.call('ZADD', KEYS[i], now+tonumber(ARGV[2]), ARGV[1]); refresh(KEYS[i]) end
return 1`;
const DISPATCH_SCRIPT = `
if redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
${NOW}
for i=1,2 do
 local score=redis.call('ZSCORE', KEYS[i], ARGV[1])
 if not score or score=='inf' or tonumber(score)<=now then return 0 end
end
-- No automatic expiry after dispatch: transport termination is not GPU proof.
for i=1,2 do redis.call('ZADD', KEYS[i], '+inf', ARGV[1]); redis.call('PERSIST', KEYS[i]) end
redis.call('HSET', KEYS[4], ARGV[1], ARGV[3]); return 1`;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
${NOW}
${TTL}
local dispatched=redis.call('HEXISTS', KEYS[4], ARGV[1])==1 or redis.call('ZSCORE', KEYS[1], ARGV[1])=='inf' or redis.call('ZSCORE', KEYS[2], ARGV[1])=='inf'
if dispatched and ARGV[3]~='terminal' then redis.call('HSET', KEYS[5], ARGV[1], 'completion-unconfirmed'); return 0 end
for i=1,2 do redis.call('ZREM', KEYS[i], ARGV[1]); refresh(KEYS[i]) end
redis.call('HDEL', KEYS[4], ARGV[1]); redis.call('HDEL', KEYS[5], ARGV[1]); return 1`;

export const admissionEpoch = () => {
  const epoch = process.env.DRAPIXAI_TRYON_ADMISSION_EPOCH || '';
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(epoch)) throw new Error('TRYON_ADMISSION_EPOCH_REQUIRED');
  return epoch;
};
export const redisRunId = async (client: Client) => {
  const id = /^run_id:([a-f0-9]{40})\r?$/m.exec(await client.info('server'))?.[1];
  if (!id) throw new Error('TRYON_REDIS_IDENTITY_UNAVAILABLE');
  return id;
};
const currentGuard = async (client: Client) => `${admissionEpoch()}:${await redisRunId(client)}`;
export const isTryOnAdmissionAcknowledged = async (client: Client) => await client.get(ADMISSION_KEYS.guard) === await currentGuard(client);
const positiveInteger = (value: string | undefined, fallback: number) => {
  const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};
const stopHeartbeat = (lease: TryOnLease) => { heartbeats.get(lease.token)?.stop(); heartbeats.delete(lease.token); };

export const acquireTryOnSlot = async (tenantId: number, requestSignal?: AbortSignal): Promise<AcquireResult> => {
  if (!Number.isSafeInteger(tenantId) || tenantId < 0) return { ok: false, reason: 'CONCURRENCY_CONTROL_UNAVAILABLE' };
  const globalLimit = positiveInteger(process.env.DRAPIXAI_MAX_CONCURRENT_TRYONS, 3);
  const tenantLimit = Math.min(positiveInteger(process.env.DRAPIXAI_TENANT_MAX_CONCURRENT_TRYONS, 1), globalLimit);
  const leaseMs = positiveInteger(process.env.DRAPIXAI_TRYON_SLOT_LEASE_MS, 120_000);
  const reservationMs = positiveInteger(process.env.DRAPIXAI_TRYON_RESERVATION_MAX_MS, 420_000);
  if (reservationMs > 3_600_000 || requestSignal?.aborted) return { ok: false, reason: 'CONCURRENCY_CONTROL_UNAVAILABLE' };
  if (leaseMs > 300_000 || (process.env.NODE_ENV !== 'test' && leaseMs < 10_000)) return { ok: false, reason: 'CONCURRENCY_CONTROL_UNAVAILABLE' };
  const controller = new AbortController();
  const token = crypto.randomUUID(), globalKey = ADMISSION_KEYS.global;
  const tenantKey = `drapixai:tryon-concurrency:tenant:${tenantId}`;
  try {
    const result = await redis.run(async client => {
      const guard = await currentGuard(client);
      const code = await client.eval(ACQUIRE_SCRIPT, { keys: [globalKey, tenantKey, ADMISSION_KEYS.guard], arguments: [String(leaseMs), String(globalLimit), String(tenantLimit), token, guard] });
      return { code, guard };
    });
    if (result.code === 1) return { ok: false, reason: 'TENANT_CONCURRENCY_LIMIT' };
    if (result.code === 2) return { ok: false, reason: 'GLOBAL_CAPACITY_BUSY' };
    if (result.code !== 0) throw new Error('TRYON_ADMISSION_NOT_ACKNOWLEDGED');
    const lease: TryOnLease = { token, tenantKey, globalKey, guard: result.guard, signal: controller.signal, phase: 'reserved' };
    let stopped = false, renewing = false;
    const expire = () => {
      if (lease.phase !== 'reserved') return;
      lease.phase = 'expired'; stopHeartbeat(lease);
      controller.abort(new Error('TRYON_ADMISSION_LEASE_LOST'));
      void releaseTryOnSlot(lease);
    };
    const deadline = setTimeout(expire, reservationMs); deadline.unref();
    const timer = setInterval(() => {
      if (stopped || renewing || lease.phase !== 'reserved') return; renewing = true;
      void redis.run(async client => {
        if (await currentGuard(client) !== lease.guard) return 0;
        return client.eval(RENEW_SCRIPT, { keys: [globalKey, tenantKey, ADMISSION_KEYS.guard], arguments: [token, String(leaseMs), lease.guard] });
      }).then(code => {
        if (!stopped && lease.phase === 'reserved' && code !== 1) { stopHeartbeat(lease); controller.abort(new Error('TRYON_ADMISSION_LEASE_LOST')); }
      }, () => { if (!stopped && lease.phase === 'reserved') { stopHeartbeat(lease); controller.abort(new Error('TRYON_ADMISSION_LEASE_LOST')); } })
        .finally(() => { renewing = false; });
    }, Math.max(5, Math.floor(leaseMs / 3)));
    timer.unref(); heartbeats.set(token, { stop: () => { stopped = true; clearInterval(timer); clearTimeout(deadline); requestSignal?.removeEventListener('abort', expire); } });
    requestSignal?.addEventListener('abort', expire, { once: true });
    if (requestSignal?.aborted) expire();
    return { ok: true, lease };
  } catch {
    console.error('TRYON_CONCURRENCY_CONTROL_UNAVAILABLE');
    return { ok: false, reason: 'CONCURRENCY_CONTROL_UNAVAILABLE' };
  }
};

export const dispatchTryOnSlot = async (lease: TryOnLease) => {
  if (lease.phase !== 'reserved' || lease.signal.aborted) throw new Error('TRYON_ADMISSION_LEASE_LOST');
  stopHeartbeat(lease); lease.phase = 'uncertain';
  const result = await redis.run(async client => {
    if (await currentGuard(client) !== lease.guard) return 0;
    return client.eval(DISPATCH_SCRIPT, { keys: [lease.globalKey, lease.tenantKey, ADMISSION_KEYS.guard, ADMISSION_KEYS.work], arguments: [lease.token, lease.guard, JSON.stringify({ tenantKey: lease.tenantKey, dispatchedAt: new Date().toISOString() })] });
  });
  if (result !== 1) throw new Error('TRYON_ADMISSION_LEASE_LOST');
  lease.phase = 'dispatched';
};

export const observeTryOnTerminalResponse = (lease: TryOnLease, response: Response) => {
  // Only an authenticated, fully buffered, request-bound lifecycle receipt is
  // proof. A timeout or an old server's bare HTTP status never frees GPU work.
  if (response.headers.get('x-drapixai-admission-protocol') !== '1'
      || response.headers.get('x-request-id') !== lease.token) return;
  const state = response.headers.get('x-drapixai-work-state');
  if (state === 'terminal' && (response.ok || response.status === 500)
      || state === 'not-dispatched' && response.status >= 400 && response.status < 500) lease.phase = 'terminal';
};

export const releaseTryOnSlot = async (lease: TryOnLease) => {
  stopHeartbeat(lease);
  try {
    const result = await redis.run(async client => {
      if (await currentGuard(client) !== lease.guard) return 0;
      return client.eval(RELEASE_SCRIPT, { keys: [lease.globalKey, lease.tenantKey, ADMISSION_KEYS.guard, ADMISSION_KEYS.work, ADMISSION_KEYS.uncertain], arguments: [lease.token, lease.guard, lease.phase === 'terminal' ? 'terminal' : 'unknown'] });
    });
    if (result !== 1) console.warn('TRYON_ADMISSION_RECONCILIATION_REQUIRED', lease.token);
  } catch { console.error('TRYON_ADMISSION_RELEASE_UNCONFIRMED', lease.token); }
};

// Operator-only helpers: no HTTP route calls these. Reconciliation does not
// cancel work or establish termination; the operator must first prove it idle.
export const acknowledgeTryOnWorkersIdle = async (client: Client, expectedRunId: string, reference: string) => {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(reference) || await redisRunId(client) !== expectedRunId) throw new Error('TRYON_RECONCILIATION_IDENTITY_INVALID');
  const guard = `${admissionEpoch()}:${expectedRunId}`;
  await client.set(ADMISSION_KEYS.guard, guard);
  return { acknowledged: true, dispatchedStillHeld: await client.hLen(ADMISSION_KEYS.work) };
};
export const reconcileTerminalTryOn = async (client: Client, token: string, expectedRunId: string, reference: string) => {
  if (!/^[a-f0-9-]{36}$/.test(token) || !/^[A-Za-z0-9._:-]{8,128}$/.test(reference) || await redisRunId(client) !== expectedRunId) throw new Error('TRYON_RECONCILIATION_IDENTITY_INVALID');
  const raw = await client.hGet(ADMISSION_KEYS.work, token);
  if (!raw) return { released: false };
  const value = JSON.parse(raw) as { tenantKey?: string };
  if (!/^drapixai:tryon-concurrency:tenant:\d+$/.test(value.tenantKey || '')) throw new Error('TRYON_RECONCILIATION_RECORD_INVALID');
  const result = await client.eval(RELEASE_SCRIPT, { keys: [ADMISSION_KEYS.global, value.tenantKey!, ADMISSION_KEYS.guard, ADMISSION_KEYS.work, ADMISSION_KEYS.uncertain], arguments: [token, `${admissionEpoch()}:${expectedRunId}`, 'terminal'] });
  return { released: result === 1 };
};
export const stopTryOnHeartbeatForTests = (lease: TryOnLease) => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION'); stopHeartbeat(lease);
};
export const closeTryOnConcurrencyForTests = async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION');
  for (const heartbeat of heartbeats.values()) heartbeat.stop(); heartbeats.clear(); await redis.close();
};
