import { Router } from 'express';
import { aiFetch } from '../lib/ai-client';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from 'redis';
import { sendGarmentApprovalEmail } from '../services/emailer';
import { createStorageClient, getStorageSummary } from '../lib/storage';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { formatPlanLabel } from '../lib/plans';
import { buildProductAccuracyReport, getTryOnConfidenceBadge, normalizeWarnings } from '../lib/tryon-quality';
import { formatLogError, readLocalUploadFile } from '../lib/security';
import { withOperationTimeout } from '../lib/operation-timeout';
import { appendSecurityAudit } from '../lib/audit-log';
import { hasPermission } from '../lib/authorization';

const router = Router();
const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.DRAPIXAI_ADMIN_EMAIL || '';
const ADMIN_USER_ID = Number(process.env.DRAPIXAI_ADMIN_USER_ID || 0);
const s3 = createStorageClient();
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (error) => {
  console.error('Admin Redis client error:', formatLogError(error));
});
redis.connect().catch(() => undefined);
const adminRateLimit = createRateLimitMiddleware(60, 15 * 60 * 1000);

const auditAdminAction = (req: any, input: {
  action: string;
  targetType?: string;
  targetId?: string | number;
  metadata?: Record<string, string | number | boolean | null>;
}) => appendSecurityAudit(prisma, {
  actorUserId: req.user.id,
  actorRole: req.user.role,
  action: input.action,
  targetType: input.targetType,
  targetId: input.targetId,
  requestId: String(req.headers['x-request-id'] || '') || null,
  ip: req.ip,
  metadata: input.metadata,
});

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const fetchStoredImage = async (storedUrl: string | null | undefined): Promise<Buffer | null> => {
  if (!storedUrl) return null;
  if (storedUrl.startsWith('local:')) {
    return readLocalUploadFile(storedUrl);
  }
  if (storedUrl.startsWith('s3://')) {
    const rest = storedUrl.replace('s3://', '');
    const [bucket, ...keyParts] = rest.split('/');
    const key = keyParts.join('/');
    try {
      const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  return null;
};

const getStoredImageContentType = (storedUrl: string | null | undefined) => {
  const lower = (storedUrl || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const sendStoredImage = async (res: any, storedUrl: string | null | undefined) => {
  const buffer = await fetchStoredImage(storedUrl);
  if (!buffer) {
    return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
  }
  res.setHeader('Content-Type', getStoredImageContentType(storedUrl));
  return res.send(buffer);
};

const adminAuth = async (req: any, res: any, next: any) => {
  const activeKey = await resolveActiveApiKey(prisma, req.headers.authorization);
  if (!activeKey) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const user = await prisma.user.findUnique({ where: { id: activeKey.userId } });
  const matchesConfiguredAdmin = Boolean(user && ((ADMIN_EMAIL && user.email === ADMIN_EMAIL) || (ADMIN_USER_ID && user.id === ADMIN_USER_ID)));
  const isAdmin = Boolean(user && hasPermission(user.role, 'system:admin') && matchesConfiguredAdmin);
  if (!user || !isAdmin) {
    return res.status(403).json({ error: 'ADMIN_REQUIRED' });
  }

  req.user = user;
  req.apiKey = activeKey;
  return next();
};

router.use(adminRateLimit);
router.use(adminAuth);

router.get('/verify', async (req: any, res) => {
  await auditAdminAction(req, { action: 'admin.session.verified', targetType: 'admin_session' });
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
    await withOperationTimeout(prisma.$queryRaw`SELECT 1`, 3000, 'DATABASE_OPS_TIMEOUT');
    database = true;
  } catch {
    database = false;
  }

  try {
    redisReady = (await withOperationTimeout(redis.ping(), 3000, 'REDIS_OPS_TIMEOUT')) === 'PONG';
    queueDepth = await withOperationTimeout(redis.lLen('render_queue'), 3000, 'REDIS_QUEUE_TIMEOUT');
  } catch {
    redisReady = false;
    queueDepth = 0;
  }

  if (aiBaseUrl) {
    try {
      const healthResponse = await aiFetch(`${aiBaseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      aiReachable = healthResponse.ok;
      const readyResponse = await aiFetch(`${aiBaseUrl}/ready`, { signal: AbortSignal.timeout(5000) });
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

  const [renderStats, recentFailures, dailyTraffic] = database
    ? await withOperationTimeout(Promise.all([
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
      ]), 5000, 'DATABASE_OPS_DETAILS_TIMEOUT')
    : [[], [], []];

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
  const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
  const garments = await prisma.garment.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(filter === 'cache_failed' ? { rejectedReason: { startsWith: 'CACHE_REGEN_FAILED' } } : {}),
      ...(filter === 'no_cache' ? { cacheKey: null } : {}),
      ...(filter === 'ready' ? { status: 'ready' } : {}),
      ...(filter === 'rejected' ? { status: 'rejected' } : {}),
      ...(filter === 'pending' ? { status: 'pending' } : {}),
    },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({
    items: garments.map((g) => ({
      id: g.id,
      userId: g.userId,
      garmentId: g.garmentId,
      displayName: g.displayName,
      productName: g.productName,
      category: g.category,
      status: g.status,
      cacheKey: g.cacheKey,
      thumbnailUrl: g.thumbnailUrl,
      updatedAt: g.updatedAt,
      rejectedReason: g.rejectedReason,
      certification: g.status === 'ready' && g.cacheKey ? 'DrapixAI-ready' : 'Not certified',
    }))
  });
});

/**
 * POST /admin/garments/:id/approve
 */
router.post('/garments/:id/approve', async (req: any, res) => {
  const id = Number(req.params.id);
  const garment = await prisma.$transaction(async (transaction) => {
    const approved = await transaction.garment.update({
      where: { id },
      data: { status: 'ready', rejectedReason: null },
      include: { user: true }
    });
    await transaction.catalogProduct.updateMany({
      where: { userId: approved.userId, preparedGarmentId: approved.garmentId },
      data: { preparationStatus: 'prepared' },
    });
    return approved;
  });
  if (garment.user?.email) {
    await sendGarmentApprovalEmail(garment.userId, garment.user.email, garment.garmentId, 'approved', null);
  }
  await auditAdminAction(req, {
    action: 'garment.approved',
    targetType: 'garment',
    targetId: garment.id,
    metadata: { ownerUserId: garment.userId, garmentId: garment.garmentId },
  });
  res.json({ id: garment.id, status: garment.status });
});

/**
 * POST /admin/garments/:id/reject
 */
router.post('/garments/:id/reject', async (req: any, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Rejected by admin';
  const garment = await prisma.$transaction(async (transaction) => {
    const rejected = await transaction.garment.update({
      where: { id },
      data: { status: 'rejected', rejectedReason: reason },
      include: { user: true }
    });
    await transaction.garmentMatch.updateMany({
      where: { userId: rejected.userId, garmentId: rejected.garmentId },
      data: { confirmedProductId: null, status: 'rejected' },
    });
    await transaction.catalogProduct.updateMany({
      where: { userId: rejected.userId, preparedGarmentId: rejected.garmentId },
      data: { preparationStatus: 'failed', preparationError: 'ADMIN_REJECTED' },
    });
    return rejected;
  });
  if (garment.user?.email) {
    await sendGarmentApprovalEmail(garment.userId, garment.user.email, garment.garmentId, 'rejected', reason);
  }
  await auditAdminAction(req, {
    action: 'garment.rejected',
    targetType: 'garment',
    targetId: garment.id,
    metadata: { ownerUserId: garment.userId, garmentId: garment.garmentId },
  });
  res.json({ id: garment.id, status: garment.status, reason });
});

/**
 * GET /admin/garments/:id/thumbnail
 */
router.get('/garments/:id/thumbnail', async (req: any, res) => {
  const id = Number(req.params.id);
  const garment = await prisma.garment.findUnique({ where: { id } });
  if (!garment || !garment.thumbnailUrl) {
    return res.status(404).json({ error: 'THUMBNAIL_NOT_READY' });
  }
  if (garment.thumbnailUrl.startsWith('local:')) {
    const buffer = readLocalUploadFile(garment.thumbnailUrl);
    if (!buffer) return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
    res.setHeader('Content-Type', 'image/png');
    return res.send(buffer);
  }
  await auditAdminAction(req, { action: 'garment.image.accessed', targetType: 'garment', targetId: id });
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

/**
 * GET /admin/tryon-results
 * Quality review queue for CatVTON result review and feedback learning.
 */
router.get('/tryon-results', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
  const minQuality = Number(req.query.minQuality || 0.9);
  const maxLatencyMs = Number(req.query.maxLatencyMs || 12000);
  const results = await prisma.tryOnResult.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(filter === 'approved' ? { status: 'approved' } : {}),
      ...(filter === 'rejected' ? { status: 'rejected' } : {}),
      ...(filter === 'generated' ? { status: 'generated' } : {}),
      ...(filter === 'low_quality' ? { qualityScore: { lt: minQuality } } : {}),
      ...(filter === 'high_latency' ? { latencyMs: { gt: maxLatencyMs } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter === 'warnings' ? 250 : 100,
    include: {
      user: { select: { email: true } },
      feedback: { orderBy: { createdAt: 'desc' }, take: 3 },
    },
  });

  const filteredResults = filter === 'warnings'
    ? results.filter((item) => normalizeWarnings(item.warnings).length > 0)
    : results;

  res.json({
    items: filteredResults.map((item) => ({
      id: item.id,
      userId: item.userId,
      userEmail: item.user.email,
      garmentId: item.garmentId,
      productId: item.productId,
      hasPersonImage: Boolean(item.personImageUrl),
      hasGarmentImage: Boolean(item.garmentImageUrl),
      hasResultImage: Boolean(item.resultImageUrl),
      engine: item.engine,
      qualityScore: item.qualityScore,
      candidateCount: item.candidateCount,
      processingMs: item.processingMs,
      latencyMs: item.latencyMs,
      timingJson: item.timingJson,
      warnings: normalizeWarnings(item.warnings),
      confidenceBadge: getTryOnConfidenceBadge({
        qualityScore: item.qualityScore,
        latencyMs: item.latencyMs,
        warnings: normalizeWarnings(item.warnings),
        timingJson: item.timingJson as Record<string, unknown> | null,
      }),
      productAccuracyReport: buildProductAccuracyReport({
        qualityScore: item.qualityScore,
        latencyMs: item.latencyMs,
        warnings: normalizeWarnings(item.warnings),
        timingJson: item.timingJson as Record<string, unknown> | null,
      }),
      status: item.status,
      feedback: item.feedback,
      createdAt: item.createdAt.toISOString(),
    })),
  });
});

router.get('/tryon-results/:id/person', async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.findUnique({ where: { id } });
  if (!result) return res.status(404).json({ error: 'TRYON_RESULT_NOT_FOUND' });
  await auditAdminAction(req, { action: 'tryon.person_image.accessed', targetType: 'tryon_result', targetId: id });
  return sendStoredImage(res, result.personImageUrl);
});

router.get('/tryon-results/:id/garment', async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.findUnique({ where: { id } });
  if (!result) return res.status(404).json({ error: 'TRYON_RESULT_NOT_FOUND' });
  await auditAdminAction(req, { action: 'tryon.garment_image.accessed', targetType: 'tryon_result', targetId: id });
  return sendStoredImage(res, result.garmentImageUrl);
});

router.get('/tryon-results/:id/result', async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.findUnique({ where: { id } });
  if (!result) return res.status(404).json({ error: 'TRYON_RESULT_NOT_FOUND' });
  await auditAdminAction(req, { action: 'tryon.result_image.accessed', targetType: 'tryon_result', targetId: id });
  return sendStoredImage(res, result.resultImageUrl);
});

router.post('/tryon-results/:id/approve', async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.update({
    where: { id },
    data: { status: 'approved', approvedAt: new Date(), rejectedAt: null },
  });
  await auditAdminAction(req, { action: 'tryon.approved', targetType: 'tryon_result', targetId: result.id });
  res.json({ id: result.id, status: result.status });
});

router.post('/tryon-results/:id/reject', async (req: any, res) => {
  const id = Number(req.params.id);
  const result = await prisma.tryOnResult.update({
    where: { id },
    data: { status: 'rejected', rejectedAt: new Date(), approvedAt: null },
  });
  await auditAdminAction(req, { action: 'tryon.rejected', targetType: 'tryon_result', targetId: result.id });
  res.json({ id: result.id, status: result.status });
});

export default router;
