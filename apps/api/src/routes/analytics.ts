import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { getPlanAccessContext, getPlanName } from '../lib/plans';
import { getTryOnConfidenceBadge, normalizeWarnings } from '../lib/tryon-quality';

const router = Router();
const prisma = new PrismaClient();
const analyticsRateLimit = createRateLimitMiddleware(120, 15 * 60 * 1000);

const issueApiKeyForUser = async (userId: number) => {
  const apiKey = uuidv4().replace(/-/g, '');
  const keyHash = await bcrypt.hash(apiKey, 10);

  await prisma.$transaction([
    prisma.apiKey.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    }),
    prisma.apiKey.create({
      data: { userId, keyHash, domainWhitelist: '*' }
    }),
  ]);

  return apiKey;
};

router.use(analyticsRateLimit);
router.use(requireDashboardProxy);

const resolveAnalyticsKey = async (authorizationHeader: string | undefined, res: any) => {
  const activeKey = await resolveActiveApiKey(prisma, authorizationHeader);
  if (!activeKey) {
    res.status(401).json({ error: 'INVALID_API_KEY' });
    return null;
  }
  return activeKey;
};

router.get('/summary', async (req, res) => {
  const validKey = await resolveAnalyticsKey(req.headers.authorization, res);
  if (!validKey) return;
  
  const user = await prisma.user.findUnique({ where: { id: validKey.userId } });
  const now = new Date();
  const usage = await prisma.usage.findFirst({ where: { apiKeyId: validKey.id, month: now.getMonth() + 1, year: now.getFullYear() } });
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 13);
  const daily = await prisma.usageDaily.findMany({
    where: { apiKeyId: validKey.id, date: { gte: start } },
    orderBy: { date: 'asc' }
  });
  const recentRenders = await prisma.render.findMany({
    where: { apiKeyId: validKey.id },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  const recentTryOnResults = await prisma.tryOnResult.findMany({
    where: { userId: validKey.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const [
    uploadedGarmentCount,
    cacheReadyGarmentCount,
    discoveredProductCount,
    suggestedMatchCount,
    confirmedMatchCount,
    approvedTryOnResultCount,
  ] = await Promise.all([
    prisma.garment.count({
      where: {
        userId: validKey.userId,
        OR: [
          { originalUrl: { not: null } },
          { cacheKey: { not: null } },
          { thumbnailUrl: { not: null } },
        ],
      },
    }),
    prisma.garment.count({
      where: {
        userId: validKey.userId,
        status: 'ready',
        cacheKey: { not: null },
      },
    }),
    prisma.catalogProduct.count({ where: { userId: validKey.userId } }),
    prisma.garmentMatch.count({
      where: {
        userId: validKey.userId,
        suggestedProductId: { not: null },
      },
    }),
    prisma.garmentMatch.count({
      where: {
        userId: validKey.userId,
        status: 'confirmed',
        confirmedProductId: { not: null },
      },
    }),
    prisma.tryOnResult.count({
      where: {
        userId: validKey.userId,
        status: 'approved',
      },
    }),
  ]);

  const warningFreeTryOnCount = recentTryOnResults.filter((result) => normalizeWarnings(result.warnings).length === 0).length;
  const averageLatencyMs = recentTryOnResults.length
    ? Math.round(recentTryOnResults.reduce((sum, result) => sum + (result.latencyMs || 0), 0) / recentTryOnResults.length)
    : null;
  const averageQualityScore = recentTryOnResults.length
    ? Number((recentTryOnResults.reduce((sum, result) => sum + (result.qualityScore || 0), 0) / recentTryOnResults.length).toFixed(3))
    : null;
  const excellentTryOnCount = recentTryOnResults.filter((result) => getTryOnConfidenceBadge({
    qualityScore: result.qualityScore,
    latencyMs: result.latencyMs,
    warnings: normalizeWarnings(result.warnings),
    timingJson: result.timingJson as Record<string, unknown> | null,
  }) === 'Excellent').length;

  const plan = getPlanAccessContext({
    planType: user?.planType,
    subscriptionStatus: user?.subscriptionStatus,
    trialExpiresAt: user?.trialExpiresAt,
  });
  const normalizedDomain = (validKey.domainWhitelist || '').trim();
  
  res.json({
    planType: plan.normalizedPlan,
    planName: plan.planName,
    rendersUsed: usage?.renderCount || 0,
    quota: plan.quota,
    quotaRemaining: Math.max(0, plan.quota - (usage?.renderCount || 0)),
    email: user?.email || null,
    companyName: user?.companyName || null,
    selectedPlan: user?.selectedPlan || null,
    selectedPlanName: user?.selectedPlan ? getPlanName(user.selectedPlan) : null,
    subscriptionPlan: user?.subscriptionPlan || null,
    subscriptionPlanName: user?.subscriptionPlan ? getPlanName(user.subscriptionPlan) : null,
    subscriptionStatus: user?.subscriptionStatus || null,
    planAccessActive: plan.active,
    planBlockedReason: plan.blockedReason,
    subscriptionCurrentPeriodEndsAt: user?.subscriptionCurrentPeriodEndsAt
      ? user.subscriptionCurrentPeriodEndsAt.toISOString()
      : null,
    domain: normalizedDomain,
    storeConnected: Boolean(normalizedDomain && normalizedDomain !== '*' && user?.storeVerifiedAt),
    storeVerified: Boolean(user?.storeVerifiedAt),
    storeVerifiedAt: user?.storeVerifiedAt ? user.storeVerifiedAt.toISOString() : null,
    catalogSyncSource: user?.catalogSyncSource || 'manual',
    catalogFeedUrl: user?.catalogFeedUrl || '',
    catalogLastSyncedAt: user?.catalogLastSyncedAt ? user.catalogLastSyncedAt.toISOString() : null,
    catalogLastSyncStatus: user?.catalogLastSyncStatus || null,
    uploadedGarmentCount,
    cacheReadyGarmentCount,
    discoveredProductCount,
    suggestedMatchCount,
    confirmedMatchCount,
    approvedTryOnResultCount,
    warningFreeTryOnCount,
    excellentTryOnCount,
    averageLatencyMs,
    averageQualityScore,
    dailyUsage: daily.map(d => ({ date: d.date.toISOString().slice(0, 10), count: d.count })),
    recentRenders: recentRenders.map((render) => ({
      id: render.id,
      status: render.status,
      productId: render.productId,
      error: render.error,
      outputUrl: render.outputUrl,
      createdAt: render.createdAt.toISOString(),
    })),
    trialEndsAt: user?.trialExpiresAt ? user.trialExpiresAt.toISOString() : null,
    trialDaysLeft: plan.trialDaysLeft
  });
});

router.post('/domain', async (req, res) => {
  const { domain } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'DOMAIN_REQUIRED' });
  const validKey = await resolveAnalyticsKey(req.headers.authorization, res);
  if (!validKey) return;

  if (validKey.domainWhitelist !== '*' && validKey.domainWhitelist !== domain) {
    return res.status(403).json({ error: 'Domain already set', domain: validKey.domainWhitelist });
  }

  const updated = await prisma.apiKey.update({
    where: { id: validKey.id },
    data: { domainWhitelist: domain.toLowerCase() }
  });

  res.json({ success: true, domain: updated.domainWhitelist });
});

router.get('/emails', async (req, res) => {
  const validKey = await resolveAnalyticsKey(req.headers.authorization, res);
  if (!validKey) return;

  const logs = await prisma.emailLog.findMany({
    where: { userId: validKey.userId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  res.json({ logs });
});

router.post('/api-key/rotate', async (req, res) => {
  const validKey = await resolveAnalyticsKey(req.headers.authorization, res);
  if (!validKey) return;

  const nextApiKey = await issueApiKeyForUser(validKey.userId);
  res.json({ ok: true, apiKey: nextApiKey });
});

export default router;
