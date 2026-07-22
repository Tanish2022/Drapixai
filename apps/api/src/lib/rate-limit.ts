import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { formatLogError } from './security';

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();
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

const getClientKey = (req: Request) => `${req.ip || 'unknown'}:${req.path}`;

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
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.pExpire(redisKey, Math.max(1000, resetAt - now + 1000));
  return { count, resetAt };
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
