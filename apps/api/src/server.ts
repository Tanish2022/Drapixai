import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import authRoutes from './routes/auth';
import sdkRoutes from './routes/sdk';
import analyticsRoutes from './routes/analytics';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import accountRoutes from './routes/account';
import cron from 'node-cron';
import { startTrialNotifications } from './services/trial_notifier';
import { getStorageSummary } from './lib/storage';
import { formatLogError } from './lib/security';
import { ensureAdminUser } from './services/admin-bootstrap';

const app = express();
const prisma = new PrismaClient();
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (error) => {
  console.error('Redis client error:', formatLogError(error));
});
redis.connect().catch((error) => {
  console.error('Redis connection error:', formatLogError(error));
});
const aiBaseUrl = (process.env.DRAPIXAI_AI_URL || '').trim();

const configuredOrigins = (process.env.DRAPIXAI_CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const requireProductionConfig = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  const weak: string[] = [];

  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.REDIS_URL) missing.push('REDIS_URL');
  const requireSecret = (name: string, minLength: number) => {
    const value = (process.env[name] || '').trim();
    if (!value) {
      missing.push(name);
      return;
    }
    if (value.length < minLength) {
      weak.push(`${name} must be at least ${minLength} characters`);
    }
  };

  requireSecret('JWT_SECRET', 32);
  requireSecret('DRAPIXAI_AUTH_SYNC_TOKEN', 32);
  requireSecret('DRAPIXAI_DASHBOARD_PROXY_TOKEN', 32);
  requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32);
  requireSecret('DRAPIXAI_ADMIN_TOKEN', 32);
  requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12);

  if (configuredOrigins.length === 0 || configuredOrigins.includes('*')) {
    weak.push('DRAPIXAI_CORS_ORIGINS must list explicit production origins');
  }

  if (missing.length > 0 || weak.length > 0) {
    throw new Error(`PRODUCTION_CONFIG_INVALID missing=${missing.join(',') || 'none'} weak=${weak.join(';') || 'none'}`);
  }
};

requireProductionConfig();

const localDevOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5055',
  'http://127.0.0.1:5055',
];

const allowedOrigins = Array.from(
  new Set(
    process.env.NODE_ENV === 'production'
      ? configuredOrigins
      : [...configuredOrigins, ...localDevOrigins]
  )
);

const allowAnyOrigin = allowedOrigins.includes('*');
const trustProxy = (process.env.DRAPIXAI_TRUST_PROXY || '').trim();
const exposeReadyDetails = process.env.NODE_ENV !== 'production' || process.env.DRAPIXAI_EXPOSE_READY_DETAILS === '1';
const aiServiceHeaders: Record<string, string> = {};
if (process.env.DRAPIXAI_AI_SERVICE_TOKEN) {
  aiServiceHeaders['x-drapixai-service-token'] = process.env.DRAPIXAI_AI_SERVICE_TOKEN;
}
const sdkExposedHeaders = [
  'x-drapixai-tryon-result-id',
  'x-drapixai-engine',
  'x-drapixai-quality-score',
  'x-drapixai-candidate-count',
  'x-drapixai-warnings',
  'x-drapixai-processing-ms',
  'x-drapixai-latency-ms',
  'x-drapixai-latency-target-ms',
  'x-drapixai-timing-json',
  'x-drapixai-quality-json',
  'x-drapixai-confidence-badge',
  'x-drapixai-product-accuracy-json',
  'x-drapixai-quality-mode',
  'x-drapixai-garment-source',
  'x-drapixai-garment-cache-status',
  'x-drapixai-garment-cache-version',
];

app.disable('x-powered-by');
if (trustProxy) {
  app.set('trust proxy', trustProxy === '1' ? 1 : trustProxy);
}
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (allowAnyOrigin || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
  },
  exposedHeaders: sdkExposedHeaders,
}));
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRoutes);
app.use('/sdk', sdkRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/account', accountRoutes);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', async (req, res) => {
  let databaseReady = false;
  let redisReady = false;
  let aiReady = !aiBaseUrl;
  let databaseError: string | null = null;
  let aiStatus: ({ status?: string } & Record<string, unknown>) | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch (error: any) {
    databaseError = error?.message || 'DATABASE_QUERY_FAILED';
  }

  try {
    redisReady = (await redis.ping()) === 'PONG';
  } catch {
    redisReady = false;
  }

  if (aiBaseUrl) {
    try {
      const response = await fetch(`${aiBaseUrl}/ready`, {
        headers: aiServiceHeaders,
        signal: AbortSignal.timeout(5000)
      });
      aiStatus = await response.json() as ({ status?: string } & Record<string, unknown>);
      aiReady = response.ok && aiStatus?.status === 'ready';
    } catch (error: any) {
      aiReady = false;
      aiStatus = {
        status: 'unreachable',
        error: error?.message || 'AI_READY_CHECK_FAILED',
      };
    }
  }

  const ready = databaseReady && redisReady && aiReady;
  const payload = exposeReadyDetails ? {
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database: {
        ready: databaseReady,
        error: databaseError,
      },
      redis: redisReady,
      ai: aiStatus,
      storage: getStorageSummary(),
    },
  } : {
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database: databaseReady,
      redis: redisReady,
      ai: aiReady,
    },
  };
  res.status(ready ? 200 : 503).json(payload);
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

app.use((error: Error & { status?: number; statusCode?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
  const rawStatus = Number(error.status || error.statusCode || 500);
  let status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  let code = status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED';
  if (error.message === 'CORS_ORIGIN_NOT_ALLOWED') {
    code = 'CORS_ORIGIN_NOT_ALLOWED';
    status = 403;
  }
  if (error.type === 'entity.parse.failed') code = 'INVALID_JSON';
  if (error.type === 'entity.too.large') code = 'REQUEST_TOO_LARGE';

  if (status >= 500) {
    console.error('API request failed:', {
      code,
      path: req.path,
      method: req.method,
      message: formatLogError(error),
    });
  }

  res.status(status).json({ error: code });
});

cron.schedule('0 0 * * *', async () => {
  const expired = await prisma.user.findMany({
    where: { trialExpiresAt: { lt: new Date() }, planType: 'trial' }
  });
  for (const u of expired) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        planType: 'expired',
        subscriptionStatus: u.subscriptionStatus === 'trialing' ? 'trial_expired' : u.subscriptionStatus,
      }
    });
  }
});

startTrialNotifications();
ensureAdminUser().catch((error) => {
  console.error('Admin bootstrap failed:', formatLogError(error));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
