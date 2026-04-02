import type { Request, Response, NextFunction } from 'express';

type Entry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Entry>();

const getClientKey = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : req.ip || 'unknown';

  return `${ip}:${req.path}`;
};

export const createRateLimitMiddleware = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getClientKey(req);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'RATE_LIMITED' });
    }

    existing.count += 1;
    next();
  };
};
