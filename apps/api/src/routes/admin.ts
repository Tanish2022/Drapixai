import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { createClient } from 'redis';
import { sendGarmentApprovalEmail } from '../services/emailer';
import { createStorageClient, getStorageSummary } from '../lib/storage';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { formatPlanLabel } from '../lib/plans';

const router = Router();
const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.DRAPIXAI_ADMIN_EMAIL || '';
const ADMIN_USER_ID = Number(process.env.DRAPIXAI_ADMIN_USER_ID || 0);
const s3 = createStorageClient();
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch(() => undefined);
const adminRateLimit = createRateLimitMiddleware(60, 15 * 60 * 1000);

const adminAuth = async (req: any, res: any, next: any) => {
  const apiKeyHeader = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKeyHeader) {
    return res.status(401).json({ error: 'API_KEY_REQUIRED' });
  }

  const keys = await prisma.apiKey.findMany({
    where: { isActive: true },
    include: { user: true }
  });

  for (const key of keys) {
    if (await bcrypt.compare(apiKeyHeader, key.keyHash)) {
      const user = key.user;
      const isAdmin = (ADMIN_EMAIL && user.email === ADMIN_EMAIL) || (ADMIN_USER_ID && user.id === ADMIN_USER_ID);
      if (!isAdmin) {
        return res.status(403).json({ error: 'ADMIN_REQUIRED' });
      }
      req.user = user;
      req.apiKey = key;
      return next();
    }
  }

  return res.status(401).json({ error: 'INVALID_API_KEY' });
};

router.use(adminRateLimit);
router.use(adminAuth);

router.get('/verify', async (req, res) => {
  res.json({ ok: true });
});

router.get('/overview', async (req, res) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 13);

  const [users, activeApiKeys, rendersThisMonth, pendingGarments, emailStats, planGroups, recentUsers, dailyUsage, recentSignups] = await Promise.all([
    prisma.user.count(),
    prisma.apiKey.count({ where: { isActive: true } }),
    prisma.usage.aggregate({ _sum: { renderCount: true }, where: { month, year } }),
    prisma.garment.count({ where: { status: 'pending' } }),
    prisma.emailLog.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.groupBy({ by: ['planType'], _count: { _all: true } }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { email: true, planType: true, createdAt: true },
    }),
    prisma.usageDaily.groupBy({
      by: ['date'],
      _sum: { count: true },
      where: { date: { gte: start } },
      orderBy: { date: 'asc' },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: start } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const sent = emailStats.find((item) => item.status === 'sent')?._count._all || 0;
  const failed = emailStats.find((item) => item.status === 'failed')?._count._all || 0;

  const signupsByDay = new Map<string, number>();
  for (const signup of recentSignups) {
    const date = signup.createdAt.toISOString().slice(0, 10);
    signupsByDay.set(date, (signupsByDay.get(date) || 0) + 1);
  }

  res.json({
    totals: {
      users,
      activeApiKeys,
      rendersThisMonth: rendersThisMonth._sum.renderCount || 0,
      pendingGarments,
      emailsSent: sent,
      emailsFailed: failed,
    },
    plans: planGroups.map((group) => ({
      planType: group.planType,
      planName: formatPlanLabel(group.planType),
      count: group._count._all,
    })),
    recentUsers: recentUsers.map((user) => ({
      email: user.email,
      planType: user.planType,
      planName: formatPlanLabel(user.planType),
      createdAt: user.createdAt.toISOString(),
    })),
    dailyUsage: dailyUsage.map((item) => ({
      date: item.date.toISOString().slice(0, 10),
      count: item._sum.count || 0,
    })),
    signups: Array.from(signupsByDay.entries()).map(([date, count]) => ({ date, count })),
  });
});

router.get('/website', async (_req, res) => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 29);

  const [pageViews, demoStarts, demoSuccess, ctaClicks, rawEvents] = await Promise.all([
    prisma.websiteEvent.count({ where: { event: 'page_view', createdAt: { gte: start } } }),
    prisma.websiteEvent.count({ where: { event: 'demo_tryon_started', createdAt: { gte: start } } }),
    prisma.websiteEvent.count({ where: { event: 'demo_tryon_succeeded', createdAt: { gte: start } } }),
    prisma.websiteEvent.count({ where: { event: 'cta_click', createdAt: { gte: start } } }),
    prisma.websiteEvent.findMany({
      where: { createdAt: { gte: start } },
      orderBy: { createdAt: 'asc' },
      select: { event: true, createdAt: true, path: true },
    }),
  ]);

  const eventsByDay = new Map<string, { date: string; pageViews: number; demoStarts: number; demoSuccess: number; ctaClicks: number }>();
  const topPagesMap = new Map<string, number>();
  for (const event of rawEvents) {
    const date = event.createdAt.toISOString().slice(0, 10);
    const bucket = eventsByDay.get(date) || { date, pageViews: 0, demoStarts: 0, demoSuccess: 0, ctaClicks: 0 };
    if (event.event === 'page_view') {
      bucket.pageViews += 1;
      const path = event.path || '(unknown)';
      topPagesMap.set(path, (topPagesMap.get(path) || 0) + 1);
    }
    if (event.event === 'demo_tryon_started') bucket.demoStarts += 1;
    if (event.event === 'demo_tryon_succeeded') bucket.demoSuccess += 1;
    if (event.event === 'cta_click') bucket.ctaClicks += 1;
    eventsByDay.set(date, bucket);
  }

  res.json({
    pageViewsLast30Days: pageViews,
    demoStartsLast30Days: demoStarts,
    demoSuccessLast30Days: demoSuccess,
    ctaClicksLast30Days: ctaClicks,
    topPages: Array.from(topPagesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([path, count]) => ({ path, count })),
    eventsByDay: Array.from(eventsByDay.values()),
  });
});

router.get('/ops', async (_req, res) => {
  let database = false;
  let redisReady = false;
  let queueDepth = 0;
  let aiReachable = false;
  let aiReady = false;
  let aiStatus = 'not_configured';
  const aiBaseUrl = (process.env.DRAPIXAI_AI_URL || '').trim();

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  try {
    redisReady = (await redis.ping()) === 'PONG';
    queueDepth = await redis.lLen('render_queue');
  } catch {
    redisReady = false;
    queueDepth = 0;
  }

  if (aiBaseUrl) {
    try {
      const healthResponse = await fetch(`${aiBaseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      aiReachable = healthResponse.ok;
      const readyResponse = await fetch(`${aiBaseUrl}/ready`, { signal: AbortSignal.timeout(5000) });
      const readyPayload = await readyResponse.json().catch(() => null);
      const readyJson: { status?: string } =
        readyPayload && typeof readyPayload === 'object' ? (readyPayload as { status?: string }) : {};
      aiReady = readyResponse.ok && readyJson?.status === 'ready';
      aiStatus = readyJson?.status || (readyResponse.ok ? 'ok' : 'not_ready');
    } catch {
      aiReachable = false;
      aiReady = false;
      aiStatus = 'unreachable';
    }
  }

  const [renderStats, recentFailures, dailyTraffic] = await Promise.all([
    prisma.render.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.render.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, error: true, createdAt: true },
    }),
    prisma.usageDaily.groupBy({
      by: ['date'],
      _sum: { count: true },
      orderBy: { date: 'asc' },
      take: 14,
    }),
  ]);

  const statusMap = new Map(renderStats.map((item) => [item.status, item._count._all]));
  res.json({
    health: {
      database,
      redis: redisReady,
      aiReachable,
      aiReady,
      aiStatus,
      queueDepth,
      storage: getStorageSummary(),
    },
    renderStats: {
      total: Array.from(statusMap.values()).reduce((sum, value) => sum + value, 0),
      pending: statusMap.get('pending') || 0,
      complete: statusMap.get('complete') || 0,
      failed: statusMap.get('failed') || 0,
    },
    recentFailures: recentFailures.map((failure) => ({
      id: failure.id,
      error: failure.error,
      createdAt: failure.createdAt.toISOString(),
    })),
    dailyTraffic: dailyTraffic.map((item) => ({
      date: item.date.toISOString().slice(0, 10),
      count: item._sum.count || 0,
    })),
  });
});

/**
 * GET /admin/garments
 */
router.get('/garments', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const garments = await prisma.garment.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: 'desc' }
  });
  res.json({
    items: garments.map((g) => ({
      id: g.id,
      userId: g.userId,
      garmentId: g.garmentId,
      status: g.status,
      thumbnailUrl: g.thumbnailUrl,
      updatedAt: g.updatedAt,
      rejectedReason: g.rejectedReason
    }))
  });
});

/**
 * POST /admin/garments/:id/approve
 */
router.post('/garments/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const garment = await prisma.garment.update({
    where: { id },
    data: { status: 'ready', rejectedReason: null },
    include: { user: true }
  });
  if (garment.user?.email) {
    await sendGarmentApprovalEmail(garment.userId, garment.user.email, garment.garmentId, 'approved', null);
  }
  res.json({ id: garment.id, status: garment.status });
});

/**
 * POST /admin/garments/:id/reject
 */
router.post('/garments/:id/reject', async (req, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Rejected by admin';
  const garment = await prisma.garment.update({
    where: { id },
    data: { status: 'rejected', rejectedReason: reason },
    include: { user: true }
  });
  if (garment.user?.email) {
    await sendGarmentApprovalEmail(garment.userId, garment.user.email, garment.garmentId, 'rejected', reason);
  }
  res.json({ id: garment.id, status: garment.status, reason });
});

/**
 * GET /admin/garments/:id/thumbnail
 */
router.get('/garments/:id/thumbnail', async (req, res) => {
  const id = Number(req.params.id);
  const garment = await prisma.garment.findUnique({ where: { id } });
  if (!garment || !garment.thumbnailUrl) {
    return res.status(404).json({ error: 'THUMBNAIL_NOT_READY' });
  }
  if (garment.thumbnailUrl.startsWith('local:')) {
    const localPath = garment.thumbnailUrl.replace('local:', '');
    if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
    const buffer = fs.readFileSync(localPath);
    res.setHeader('Content-Type', 'image/png');
    return res.send(buffer);
  }
  if (garment.thumbnailUrl.startsWith('s3://')) {
    const rest = garment.thumbnailUrl.replace('s3://', '');
    const [bucket, ...keyParts] = rest.split('/');
    const key = keyParts.join('/');
    const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    res.setHeader('Content-Type', 'image/png');
    return res.send(Buffer.concat(chunks));
  }
  return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
});

export default router;
