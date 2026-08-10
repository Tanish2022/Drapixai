import 'dotenv/config';
import crypto from 'crypto';
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
import shopifyRoutes from './routes/shopify';
import shopifyStorefrontRoutes from './routes/shopify-storefront';
import shopifyWebhookRoutes from './routes/shopify-webhooks';
import v1Routes from './routes/v1';
import cron from 'node-cron';
import { startTrialNotifications } from './services/trial_notifier';
import { getStorageSummary } from './lib/storage';
import { cleanupExpiredUploadFiles, formatLogError } from './lib/security';
import { ensureAdminUser } from './services/admin-bootstrap';
import { syncShopifyCatalog } from './services/shopify';
import { processShopifyCatalogPreparationBatch } from './services/catalog-preparation';
import { withOperationTimeout } from './lib/operation-timeout';
import { runTryOnReviewRetention } from './services/review-retention';
import { createVerifiedStorefrontOriginCache } from './lib/cors-origin-cache';
import { processPendingWebhookDeliveries } from './services/webhooks';
import { observeHttpResponse, renderOperationalMetrics } from './lib/operational-metrics';
import { inputValidationMiddleware } from './lib/input-validation';
import { assertAiMtlsConfiguration } from './lib/ai-client';

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
const shopifyEnabled = process.env.DRAPIXAI_SHOPIFY_ENABLED === '1';
const shopifyAutoPrepare = process.env.DRAPIXAI_SHOPIFY_AUTO_PREPARE === '1';
const shopifyPreparationBatchSize = Number(process.env.DRAPIXAI_SHOPIFY_PREPARE_BATCH_SIZE || 3);
const reviewRetentionDays = Number(process.env.DRAPIXAI_REVIEW_RETENTION_DAYS || 0);
const reviewRetentionBatchSize = Number(process.env.DRAPIXAI_REVIEW_RETENTION_BATCH_SIZE || 200);

const configuredOrigins = (process.env.DRAPIXAI_CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const requireProductionConfig = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  const weak: string[] = [];

  const requireValue = (name: string) => {
    const value = (process.env[name] || '').trim();
    if (!value) {
      missing.push(name);
      return '';
    }
    if (/replace-with|RUNPOD_POD_IP|USERNAME:PASSWORD/i.test(value)) {
      weak.push(`${name} contains a placeholder value`);
    }
    return value;
  };
  const requireSecret = (name: string, minLength: number) => {
    const value = requireValue(name);
    if (!value) return;
    if (value.length < minLength) {
      weak.push(`${name} must be at least ${minLength} characters`);
    }
  };
  const requireExact = (name: string, expected: string) => {
    const value = requireValue(name);
    if (value && value !== expected) {
      weak.push(`${name} must equal ${expected}`);
    }
  };
  const requireNumberAtLeast = (name: string, minimum: number) => {
    const value = requireValue(name);
    if (!value) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum) {
      weak.push(`${name} must be at least ${minimum}`);
    }
  };
  const requireHttpsUrl = (name: string) => {
    const value = requireValue(name);
    if (!value) return;
    try {
      const parsed = new URL(value);
      const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
      if (parsed.protocol !== 'https:' || localHost) {
        weak.push(`${name} must use a non-local HTTPS URL`);
      }
    } catch {
      weak.push(`${name} must be a valid URL`);
    }
  };

  for (const name of [
    'DATABASE_URL',
    'REDIS_URL',
    'DRAPIXAI_AI_URL',
    'DRAPIXAI_WEB_BASE_URL',
    'S3_BUCKET',
    'AWS_REGION',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
  ]) {
    requireValue(name);
  }

  requireSecret('JWT_SECRET', 32);
  requireSecret('DRAPIXAI_AUTH_SYNC_TOKEN', 32);
  requireSecret('DRAPIXAI_DASHBOARD_PROXY_TOKEN', 32);
  requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32);
  requireSecret('DRAPIXAI_ADMIN_TOKEN', 32);
  requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12);
  requireSecret('DRAPIXAI_ADMIN_TOTP_SECRET', 16);
  requireSecret('DRAPIXAI_STOREFRONT_TOKEN_SECRET', 32);
  requireSecret('DRAPIXAI_AUDIT_LOG_SECRET', 32);
  requireSecret('DRAPIXAI_METRICS_TOKEN', 32);
  const webhookEncryptionKey = requireValue('DRAPIXAI_WEBHOOK_ENCRYPTION_KEY');
  if (webhookEncryptionKey) {
    try {
      if (Buffer.from(webhookEncryptionKey, 'base64').length !== 32) {
        weak.push('DRAPIXAI_WEBHOOK_ENCRYPTION_KEY must decode to exactly 32 bytes');
      }
    } catch {
      weak.push('DRAPIXAI_WEBHOOK_ENCRYPTION_KEY must be valid base64');
    }
  }
  const apiEnvironment = requireValue('DRAPIXAI_API_ENVIRONMENT');
  if (apiEnvironment && !['live', 'sandbox'].includes(apiEnvironment)) {
    weak.push('DRAPIXAI_API_ENVIRONMENT must equal live or sandbox');
  }
  const secretsProvider = requireValue('DRAPIXAI_SECRETS_PROVIDER');
  if (secretsProvider && !['aws-secrets-manager', 'mounted-file'].includes(secretsProvider)) {
    weak.push('DRAPIXAI_SECRETS_PROVIDER must use aws-secrets-manager or mounted-file in production');
  }
  requireExact('DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY', '1');
  if (secretsProvider === 'aws-secrets-manager' && process.env.DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY !== '1') {
    weak.push('AWS Secrets Manager must be bootstrapped with workload identity');
  }
  if (apiEnvironment === 'live' && ((process.env.AWS_ACCESS_KEY_ID || '').trim() || (process.env.AWS_SECRET_ACCESS_KEY || '').trim())) {
    weak.push('Production live API must not configure AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY; use workload identity');
  }
  requireHttpsUrl('DRAPIXAI_AI_URL');
  requireExact('DRAPIXAI_AI_PRIVATE_NETWORK', '1');
  requireExact('DRAPIXAI_AI_MTLS_ENABLED', '1');
  requireValue('DRAPIXAI_AI_MTLS_CERT_FILE');
  requireValue('DRAPIXAI_AI_MTLS_KEY_FILE');
  const allowedAiHosts = requireValue('DRAPIXAI_AI_ALLOWED_HOSTS')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  try {
    const configuredAiHost = new URL(process.env.DRAPIXAI_AI_URL || '').hostname.toLowerCase();
    if (!allowedAiHosts.includes(configuredAiHost)) {
      weak.push('DRAPIXAI_AI_URL hostname must be listed in DRAPIXAI_AI_ALLOWED_HOSTS');
    }
  } catch {
    // The URL format failure is reported by requireHttpsUrl.
  }
  requireHttpsUrl('DRAPIXAI_WEB_BASE_URL');
  const databaseUrl = process.env.DATABASE_URL || '';
  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (parsedDatabaseUrl.searchParams.get('sslmode') !== 'verify-full') {
      weak.push('DATABASE_URL must set sslmode=verify-full');
    }
  } catch {
    weak.push('DATABASE_URL must be a valid PostgreSQL URL');
  }
  const storageEndpoint = (process.env.S3_ENDPOINT || '').trim();
  if (storageEndpoint) requireHttpsUrl('S3_ENDPOINT');
  const storageEncryption = requireValue('DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION');
  if (storageEncryption && !['AES256', 'aws:kms'].includes(storageEncryption)) {
    weak.push('DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION must equal AES256 or aws:kms');
  }
  if (storageEncryption === 'aws:kms') requireValue('DRAPIXAI_S3_KMS_KEY_ID');
  requireExact('DRAPIXAI_REQUIRE_GARMENT_CACHE', '1');
  requireExact('DRAPIXAI_GARMENT_APPROVAL_REQUIRED', '1');
  requireExact('DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON', '0');
  requireExact('DRAPIXAI_SDK_GENERATION_SOURCE', 'original_verified');
  requireExact('DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER', '0');
  requireExact('DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK', '0');
  requireExact('DRAPIXAI_AUTO_REJECT_BAD_RESULTS', '1');
  requireExact('DRAPIXAI_ENABLE_LOWER_BODY', '0');
  requireExact('DRAPIXAI_EXCELLENT_LATENCY_MS', '10000');
  requireExact('DRAPIXAI_MAX_PUBLISHABLE_LATENCY_MS', '12000');
  requireNumberAtLeast('DRAPIXAI_EXCELLENT_QUALITY_SCORE', 0.95);
  requireNumberAtLeast('DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE', 0.95);
  if (shopifyEnabled) {
    requireSecret('SHOPIFY_API_KEY', 16);
    requireSecret('SHOPIFY_API_SECRET', 32);
    requireSecret('DRAPIXAI_SHOPIFY_STATE_SECRET', 32);
    requireHttpsUrl('DRAPIXAI_PUBLIC_API_BASE_URL');
    requireHttpsUrl('DRAPIXAI_WEB_BASE_URL');
    const encryptionKey = Buffer.from(process.env.DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY || '', 'base64');
    if (encryptionKey.length !== 32) weak.push('DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  if (configuredOrigins.length === 0 || configuredOrigins.includes('*')) {
    weak.push('DRAPIXAI_CORS_ORIGINS must list explicit production origins');
  }
  for (const origin of configuredOrigins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin.replace(/\/+$/, '')) {
        weak.push(`DRAPIXAI_CORS_ORIGINS contains an insecure or invalid origin: ${origin}`);
      }
    } catch {
      weak.push(`DRAPIXAI_CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }
  if ((process.env.DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND || '0') === '1') {
    weak.push('DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND must be disabled in production');
  }
  if ((process.env.DRAPIXAI_ALLOW_LEGACY_API_KEYS || '0') === '1') {
    weak.push('DRAPIXAI_ALLOW_LEGACY_API_KEYS must be disabled in production');
  }
  if (missing.length > 0 || weak.length > 0) {
    throw new Error(`PRODUCTION_CONFIG_INVALID missing=${missing.join(',') || 'none'} weak=${weak.join(';') || 'none'}`);
  }
};

requireProductionConfig();
assertAiMtlsConfiguration();

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
const verifiedStorefrontOrigins = createVerifiedStorefrontOriginCache(prisma, {
  shopifyEnabled,
  ttlMs: Number(process.env.DRAPIXAI_CORS_CACHE_TTL_MS || 30_000),
});

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
  'x-drapixai-quality-profile',
  'x-drapixai-garment-source',
  'x-drapixai-garment-cache-status',
  'x-drapixai-garment-cache-version',
  'x-drapixai-media-retention',
  'x-drapixai-training-use',
];

app.disable('x-powered-by');
if (trustProxy) {
  app.set('trust proxy', trustProxy === '1' ? 1 : trustProxy);
}
app.use((req, res, next) => {
  res.on('finish', () => observeHttpResponse(req.method, req.path, res.statusCode));
  next();
});
app.use(helmet());
if (shopifyEnabled) {
  app.use('/shopify', shopifyStorefrontRoutes);
  app.use('/shopify/webhooks', express.raw({ type: 'application/json', limit: '2mb' }), shopifyWebhookRoutes);
}
app.use(cors({
  async origin(origin, callback) {
    if (allowAnyOrigin || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    try {
      const parsedOrigin = new URL(origin);
      if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
        callback(new Error('CORS_HTTPS_REQUIRED'));
        return;
      }
      if (await verifiedStorefrontOrigins.allows(parsedOrigin.origin)) {
        callback(null, true);
        return;
      }
    } catch {
      // Reject invalid or unverified origins below.
    }
    callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
  },
  exposedHeaders: sdkExposedHeaders,
}));
app.use('/events', express.json({ limit: '16kb' }));
app.use(express.json({ limit: '10mb' }));
app.use(inputValidationMiddleware);

app.use('/auth', authRoutes);
app.use('/v1', v1Routes);
app.use('/sdk', sdkRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/account', accountRoutes);
app.use('/admin', adminRoutes);
if (shopifyEnabled) app.use('/shopify', shopifyRoutes);
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

  await Promise.all([
    (async () => {
      try {
        await withOperationTimeout(
          Promise.all([
            prisma.$queryRaw`SELECT 1`,
            prisma.apiKey.findFirst({ select: { kind: true } }),
            prisma.verificationCode.findFirst({ select: { attemptCount: true } }),
          ]),
          3000,
          'DATABASE_READY_TIMEOUT',
        );
        databaseReady = true;
      } catch (error: any) {
        databaseError = error?.message || 'DATABASE_QUERY_FAILED';
      }
    })(),
    (async () => {
      try {
        redisReady = (await withOperationTimeout(redis.ping(), 3000, 'REDIS_READY_TIMEOUT')) === 'PONG';
      } catch {
        redisReady = false;
      }
    })(),
    (async () => {
      if (!aiBaseUrl) return;
      try {
        const response = await fetch(`${aiBaseUrl}/ready`, {
          headers: aiServiceHeaders,
          signal: AbortSignal.timeout(3000),
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
    })(),
  ]);

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

app.get('/internal/metrics', async (req, res) => {
  const expected = Buffer.from(process.env.DRAPIXAI_METRICS_TOKEN || '');
  const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  try {
    const metrics = await renderOperationalMetrics(prisma, redis);
    res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics);
  } catch (error) {
    console.error('Operational metrics collection failed:', formatLogError(error));
    res.status(503).json({ error: 'METRICS_UNAVAILABLE' });
  }
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
  if (error.message === 'CORS_HTTPS_REQUIRED') {
    code = 'CORS_HTTPS_REQUIRED';
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

cron.schedule('*/15 * * * *', async () => {
  const summary = await runTryOnReviewRetention(prisma, {
    retentionDays: reviewRetentionDays,
    batchSize: reviewRetentionBatchSize,
  }).catch((error) => {
    console.error('Scheduled try-on review retention failed:', formatLogError(error));
    return null;
  });
  if (summary?.failures.length) {
    console.error('Scheduled try-on review retention completed with failures:', summary.failures.length);
  }
});

cron.schedule('*/5 * * * *', () => {
  try {
    cleanupExpiredUploadFiles();
  } catch (error) {
    console.error('Transient upload cleanup failed:', formatLogError(error));
  }
});

cron.schedule('* * * * *', async () => {
  await processPendingWebhookDeliveries(prisma).catch((error) => {
    console.error('Scheduled webhook delivery failed:', formatLogError(error));
  });
});

cron.schedule('35 2 * * *', async () => {
  await prisma.apiIdempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch((error) => {
    console.error('Scheduled idempotency cleanup failed:', formatLogError(error));
  });
});

if (shopifyEnabled) {
  cron.schedule('*/15 * * * *', async () => {
    const installations = await prisma.shopifyInstallation.findMany({
      where: {
        status: 'active',
        OR: [
          { lastSyncedAt: null },
          { lastSyncStatus: { startsWith: 'WEBHOOK_' } },
        ],
      },
      select: { id: true },
      take: 20,
    });
    for (const installation of installations) {
      await syncShopifyCatalog(prisma, installation.id, 'scheduled').catch((error) => {
        console.error('Scheduled Shopify sync failed:', formatLogError(error));
      });
    }
  });
  if (shopifyAutoPrepare) {
    cron.schedule('* * * * *', async () => {
      await processShopifyCatalogPreparationBatch(prisma, shopifyPreparationBatchSize).catch((error) => {
        console.error('Scheduled Shopify preparation failed:', formatLogError(error));
      });
    });
  }
}

startTrialNotifications();
ensureAdminUser().catch((error) => {
  console.error('Admin bootstrap failed:', formatLogError(error));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
