import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import authRoutes from './routes/auth';
import sdkRoutes from './routes/sdk';
import analyticsRoutes from './routes/analytics';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import cron from 'node-cron';
import { startTrialNotifications } from './services/trial_notifier';
import { getStorageSummary } from './lib/storage';
import { ensureAdminUser } from './services/admin-bootstrap';

const app = express();
const prisma = new PrismaClient();
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch((error) => {
  console.error('Redis connection error:', error);
});
const aiBaseUrl = (process.env.DRAPIXAI_AI_URL || '').trim();

const allowedOrigins = (process.env.DRAPIXAI_CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAnyOrigin = allowedOrigins.includes('*');
const trustProxy = (process.env.DRAPIXAI_TRUST_PROXY || '').trim();

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
}));
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRoutes);
app.use('/sdk', sdkRoutes);
app.use('/analytics', analyticsRoutes);
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
      const response = await fetch(`${aiBaseUrl}/ready`, { signal: AbortSignal.timeout(5000) });
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
  res.status(ready ? 200 : 503).json({
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
  });
});

cron.schedule('0 0 * * *', async () => {
  const expired = await prisma.user.findMany({
    where: { trialExpiresAt: { lt: new Date() }, planType: 'trial' }
  });
  for (const u of expired) {
    await prisma.user.update({ where: { id: u.id }, data: { planType: 'expired' } });
  }
});

startTrialNotifications();
ensureAdminUser().catch((error) => {
  console.error('Admin bootstrap failed:', error);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
