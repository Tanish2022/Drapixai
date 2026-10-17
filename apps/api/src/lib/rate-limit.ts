import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { formatLogError } from './security';

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();
// Expiry precedes increment: Redis scripts isolate operations but do not roll
// back earlier writes on a later command error. Repair old non-expiring buckets
// without resetting their count; never extend an already bounded bucket.
export const RATE_LIMIT_CONSUME_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl == -2 then
  redis.call('SET', KEYS[1], '0', 'PX', ARGV[1])
elseif ttl == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return redis.call('INCR', KEYS[1])
`;
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
let redisConnectPromise: Promise<unknown> | null = null;

redis.on('error', (error) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Rate-limit Redis error:', formatLogError(error));
  }
});

const ensureRedis = async () => {
  if (redis.isReady) return;
  if (!redisConnectPromise) {
    redisConnectPromise = redis.connect().finally(() => {
      redisConnectPromise = null;
    });
  }
  await redisConnectPromise;
};

// Matched templates keep identifier changes in one bucket. Before Express has
// matched a route, apply the mount-wide cap rather than attacker-chosen paths.
export const rateLimitRouteKey = (req: Request) =>
  `${req.baseUrl || ''}:${typeof req.route?.path === 'string' ? req.route.path : req.baseUrl || req.path}`;

const getClientKey = (req: Request) => `${req.ip || 'unknown'}:${rateLimitRouteKey(req)}`;

const applyHeaders = (res: Response, remaining: number, resetAt: number) => {
  res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
};

const consumeMemory = (key: string, maxRequests: number, windowMs: number) => {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const entry = { count: 1, resetAt: now + windowMs };
    buckets.set(key, entry);
    return entry;
  }
  existing.count += 1;
  return existing;
};

const consumeRedis = async (key: string, windowMs: number) => {
  await ensureRedis();
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const resetAt = (bucket + 1) * windowMs;
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  const redisKey = `drapixai:rate-limit:${digest}:${bucket}`;
  const count = await redis.eval(RATE_LIMIT_CONSUME_SCRIPT, {
    keys: [redisKey], arguments: [String(Math.max(1000, resetAt - now + 1000))],
  });
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('RATE_LIMIT_COUNTER_INVALID');
  }
  return { count, resetAt };
};

export const closeRateLimitForTests = async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION');
  if (redis.isOpen) await redis.quit();
};

export const createRateLimitMiddleware = (
  maxRequests: number,
  windowMs: number,
  keySelector: (req: Request) => string = getClientKey,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keySelector(req);
    let entry: Entry;
    try {
      entry = await consumeRedis(key, windowMs);
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Production rate limiter unavailable:', formatLogError(error));
        return res.status(503).json({ error: 'RATE_LIMITER_UNAVAILABLE' });
      }
      entry = consumeMemory(key, maxRequests, windowMs);
    }

    applyHeaders(res, maxRequests - entry.count, entry.resetAt);
    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'RATE_LIMITED' });
    }
    return next();
  };
};

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();
