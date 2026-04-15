import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getPlanName, getPlanQuota, normalizePlanKey } from '../lib/plans';

const router = Router();
const prisma = new PrismaClient();

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

router.get('/summary', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
  let validKey = null;
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) { validKey = key; break; }
  }
  if (!validKey) return res.status(401).json({ error: 'Invalid API key' });
  
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

  const normalizedPlan = normalizePlanKey(user?.planType);
  const quota = getPlanQuota(normalizedPlan);
  const planName = getPlanName(normalizedPlan);
  const normalizedDomain = (validKey.domainWhitelist || '').trim();
  
  res.json({
    planType: normalizedPlan,
    planName: planName,
    rendersUsed: usage?.renderCount || 0,
    quota: quota,
    quotaRemaining: Math.max(0, quota - (usage?.renderCount || 0)),
    email: user?.email || null,
    companyName: user?.companyName || null,
    selectedPlan: user?.selectedPlan || null,
    selectedPlanName: user?.selectedPlan ? getPlanName(user.selectedPlan) : null,
    subscriptionPlan: user?.subscriptionPlan || null,
    subscriptionPlanName: user?.subscriptionPlan ? getPlanName(user.subscriptionPlan) : null,
    subscriptionStatus: user?.subscriptionStatus || null,
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
    trialDaysLeft: normalizedPlan === 'trial' && user?.trialExpiresAt 
      ? Math.max(0, Math.ceil((user.trialExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) 
      : 0
  });
});

router.post('/domain', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  const { domain } = req.body || {};
  if (!apiKey || !domain) return res.status(400).json({ error: 'API key and domain required' });
  const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
  let validKey = null;
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) { validKey = key; break; }
  }
  if (!validKey) return res.status(401).json({ error: 'Invalid API key' });

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
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
  let validKey = null;
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) { validKey = key; break; }
  }
  if (!validKey) return res.status(401).json({ error: 'Invalid API key' });

  const logs = await prisma.emailLog.findMany({
    where: { userId: validKey.userId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  res.json({ logs });
});

router.post('/api-key/rotate', async (req, res) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
  let validKey = null;
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) { validKey = key; break; }
  }
  if (!validKey) return res.status(401).json({ error: 'Invalid API key' });

  const nextApiKey = await issueApiKeyForUser(validKey.userId);
  res.json({ ok: true, apiKey: nextApiKey });
});

export default router;
