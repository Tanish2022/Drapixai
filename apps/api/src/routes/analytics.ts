import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

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

  // Calculate quota based on plan
  let quota = 0;
  let planName = '';
  
  if (user?.planType === 'trial') {
    quota = 300;
    planName = 'Trial';
  } else if (user?.planType === 'basic') {
    quota = 1200;
    planName = 'Basic';
  } else {
    quota = 0;
    planName = 'No Plan';
  }
  
  res.json({
    planType: user?.planType || 'none',
    planName: planName,
    rendersUsed: usage?.renderCount || 0,
    quota: quota,
    quotaRemaining: quota - (usage?.renderCount || 0),
    email: user?.email || null,
    domain: validKey.domainWhitelist,
    dailyUsage: daily.map(d => ({ date: d.date.toISOString().slice(0, 10), count: d.count })),
    trialEndsAt: user?.trialExpiresAt ? user.trialExpiresAt.toISOString() : null,
    trialDaysLeft: user?.planType === 'trial' && user?.trialExpiresAt 
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

export default router;
