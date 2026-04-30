import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { parseCatalogFeed } from '../lib/catalog-feed';
import { upsertCatalogProductsForUser } from '../lib/catalog-matching';
import { consumeVerificationCode, issueVerificationCode, normalizeEmail } from '../lib/verification';
import { sendOtpEmail } from '../services/emailer';

const router = Router();
const prisma = new PrismaClient();
const accountRateLimit = createRateLimitMiddleware(20, 15 * 60 * 1000);

const generateVerificationToken = () => `drapix_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const normalizeDomainInput = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const buildVerificationMetaTag = (token: string) =>
  `<meta name="drapixai-domain-verification" content="${token}" />`;

router.use(accountRateLimit);

const resolveUser = async (authorizationHeader: string | undefined) => {
  const activeKey = await resolveActiveApiKey(prisma, authorizationHeader);
  if (!activeKey) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: activeKey.userId } });
  if (!user) {
    return null;
  }

  return { activeKey, user };
};

router.get('/profile', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { user, activeKey } = resolved;
  return res.json({
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
    companyName: user.companyName || '',
    mobileNumber: user.mobileNumber || '',
    themePreference: user.themePreference || 'dark',
    storeConnected: Boolean(activeKey.domainWhitelist && activeKey.domainWhitelist !== '*' && user.storeVerifiedAt),
    storeVerified: Boolean(user.storeVerifiedAt),
    domain: activeKey.domainWhitelist,
    storeVerificationToken: user.storeVerificationToken || null,
    storeVerificationMetaTag: user.storeVerificationToken ? buildVerificationMetaTag(user.storeVerificationToken) : null,
    storeVerifiedAt: user.storeVerifiedAt?.toISOString() || null,
    catalogSyncSource: user.catalogSyncSource || 'manual',
    catalogFeedUrl: user.catalogFeedUrl || '',
    catalogLastSyncedAt: user.catalogLastSyncedAt?.toISOString() || null,
    catalogLastSyncStatus: user.catalogLastSyncStatus || null,
  });
});

router.post('/profile', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { companyName, mobileNumber, themePreference } = req.body || {};
  const nextTheme = String(themePreference || '').trim().toLowerCase();
  if (nextTheme && !['dark', 'light'].includes(nextTheme)) {
    return res.status(400).json({ error: 'INVALID_THEME_PREFERENCE' });
  }

  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: {
      companyName: typeof companyName === 'string' ? companyName.trim() : resolved.user.companyName,
      mobileNumber: typeof mobileNumber === 'string' ? mobileNumber.trim() || null : resolved.user.mobileNumber,
      themePreference: nextTheme || resolved.user.themePreference || 'dark',
    },
  });

  return res.json({
    ok: true,
    companyName: user.companyName || '',
    mobileNumber: user.mobileNumber || '',
    themePreference: user.themePreference || 'dark',
  });
});

router.post('/password', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'CURRENT_AND_NEW_PASSWORD_REQUIRED' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
  }

  const matches = await bcrypt.compare(String(currentPassword), resolved.user.passwordHash);
  if (!matches) {
    return res.status(400).json({ error: 'CURRENT_PASSWORD_INCORRECT' });
  }

  const nextPasswordHash = await bcrypt.hash(String(newPassword), 10);
  await prisma.user.update({
    where: { id: resolved.user.id },
    data: { passwordHash: nextPasswordHash },
  });

  return res.json({ ok: true });
});

router.post('/email/request-change', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { newEmail } = req.body || {};
  if (!newEmail) {
    return res.status(400).json({ error: 'NEW_EMAIL_REQUIRED' });
  }

  const normalizedNewEmail = normalizeEmail(String(newEmail));
  if (normalizedNewEmail === resolved.user.email) {
    return res.status(400).json({ error: 'EMAIL_ALREADY_IN_USE_BY_ACCOUNT' });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedNewEmail } });
  if (existing) {
    return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });
  }

  const [currentEmailCode, newEmailCode] = await Promise.all([
    issueVerificationCode(prisma, {
      userId: resolved.user.id,
      email: resolved.user.email,
      purpose: 'email_change_current',
    }),
    issueVerificationCode(prisma, {
      userId: resolved.user.id,
      email: normalizedNewEmail,
      purpose: 'email_change_new',
    }),
  ]);

  await Promise.all([
    sendOtpEmail(resolved.user.email, currentEmailCode.code, 'email_change_current', resolved.user.id),
    sendOtpEmail(normalizedNewEmail, newEmailCode.code, 'email_change_new', resolved.user.id),
  ]);

  return res.json({
    ok: true,
    debugCurrentEmailOtp: !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production' ? currentEmailCode.code : undefined,
    debugNewEmailOtp: !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production' ? newEmailCode.code : undefined,
  });
});

router.post('/email/verify-change', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { newEmail, currentEmailOtp, newEmailOtp } = req.body || {};
  if (!newEmail || !currentEmailOtp || !newEmailOtp) {
    return res.status(400).json({ error: 'EMAIL_AND_BOTH_OTPS_REQUIRED' });
  }

  const normalizedNewEmail = normalizeEmail(String(newEmail));
  if (normalizedNewEmail === resolved.user.email) {
    return res.status(400).json({ error: 'EMAIL_ALREADY_IN_USE_BY_ACCOUNT' });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedNewEmail } });
  if (existing) {
    return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });
  }

  const currentEmailVerified = await consumeVerificationCode(prisma, {
    userId: resolved.user.id,
    email: resolved.user.email,
    purpose: 'email_change_current',
    code: String(currentEmailOtp),
  });
  if (!currentEmailVerified) {
    return res.status(400).json({ error: 'INVALID_CURRENT_EMAIL_OTP' });
  }

  const newEmailVerified = await consumeVerificationCode(prisma, {
    userId: resolved.user.id,
    email: normalizedNewEmail,
    purpose: 'email_change_new',
    code: String(newEmailOtp),
  });
  if (!newEmailVerified) {
    return res.status(400).json({ error: 'INVALID_NEW_EMAIL_OTP' });
  }

  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: {
      email: normalizedNewEmail,
      emailVerifiedAt: new Date(),
    },
  });

  return res.json({ ok: true, email: user.email });
});

router.post('/store', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const { domain, syncSource, feedUrl } = req.body || {};
  const normalizedSyncSource = String(syncSource || 'manual').trim().toLowerCase();
  if (!['manual', 'feed_url', 'shopify', 'woocommerce'].includes(normalizedSyncSource)) {
    return res.status(400).json({ error: 'INVALID_SYNC_SOURCE' });
  }
  if (normalizedSyncSource === 'feed_url' && !String(feedUrl || '').trim()) {
    return res.status(400).json({ error: 'FEED_URL_REQUIRED' });
  }

  const normalizedDomain = String(domain || '').trim() ? normalizeDomainInput(String(domain)) : resolved.activeKey.domainWhitelist;
  const nextToken = resolved.user.storeVerificationToken || generateVerificationToken();
  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: {
      storeVerificationToken: nextToken,
      storeVerifiedAt: normalizedDomain !== resolved.activeKey.domainWhitelist ? null : resolved.user.storeVerifiedAt,
      catalogSyncSource: normalizedSyncSource,
      catalogFeedUrl: normalizedSyncSource === 'feed_url' ? String(feedUrl || '').trim() : null,
    },
  });

  const activeKey = await prisma.apiKey.update({
    where: { id: resolved.activeKey.id },
    data: { domainWhitelist: normalizedDomain || '*' },
  });

  return res.json({
    ok: true,
    domain: activeKey.domainWhitelist,
    storeVerificationToken: user.storeVerificationToken,
    storeVerificationMetaTag: buildVerificationMetaTag(user.storeVerificationToken || nextToken),
    storeVerified: Boolean(user.storeVerifiedAt),
    storeVerifiedAt: user.storeVerifiedAt?.toISOString() || null,
    catalogSyncSource: user.catalogSyncSource || 'manual',
    catalogFeedUrl: user.catalogFeedUrl || '',
  });
});

router.post('/store/verify', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const domain = normalizeDomainInput(String(resolved.activeKey.domainWhitelist || ''));
  const token = resolved.user.storeVerificationToken;
  if (!domain || domain === '*' || !token) {
    return res.status(400).json({ error: 'STORE_DOMAIN_NOT_CONFIGURED' });
  }

  const urlsToCheck = [`https://${domain}`, `http://${domain}`];
  let matched = false;
  let lastError = '';
  for (const url of urlsToCheck) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        lastError = `Unable to fetch ${url}`;
        continue;
      }
      const html = await response.text();
      if (html.includes(buildVerificationMetaTag(token)) || html.includes(`content="${token}"`)) {
        matched = true;
        break;
      }
      lastError = 'Verification meta tag was not found on the homepage.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Verification request failed.';
    }
  }

  if (!matched) {
    return res.status(400).json({ error: 'STORE_VERIFICATION_FAILED', message: lastError || 'Verification failed.' });
  }

  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: { storeVerifiedAt: new Date() },
  });

  return res.json({
    ok: true,
    storeVerified: true,
    storeVerifiedAt: user.storeVerifiedAt?.toISOString() || null,
  });
});

router.post('/store/resync', async (req, res) => {
  const resolved = await resolveUser(req.headers.authorization);
  if (!resolved) {
    return res.status(401).json({ error: 'INVALID_API_KEY' });
  }

  const feedUrl = String(resolved.user.catalogFeedUrl || '').trim();
  if (!feedUrl) {
    return res.status(400).json({ error: 'FEED_URL_REQUIRED' });
  }

  try {
    const response = await fetch(feedUrl, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Feed request failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const feedText = await response.text();
    const parsedItems = parseCatalogFeed(feedText, contentType, resolved.user.catalogSyncSource || 'feed_url');
    const { discovered, skipped } = await upsertCatalogProductsForUser(
      prisma,
      resolved.user.id,
      parsedItems,
      resolved.user.catalogSyncSource || 'feed_url'
    );

    await prisma.user.update({
      where: { id: resolved.user.id },
      data: {
        catalogLastSyncedAt: new Date(),
        catalogLastSyncStatus: `SYNCED_${discovered.length}_SKIPPED_${skipped.length}`,
      },
    });

    return res.json({
      ok: true,
      items: discovered,
      skipped,
      syncedCount: discovered.length,
      skippedCount: skipped.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Feed sync failed.';
    await prisma.user.update({
      where: { id: resolved.user.id },
      data: { catalogLastSyncStatus: `FAILED:${message}` },
    });
    return res.status(400).json({ error: 'CATALOG_SYNC_FAILED', message });
  }
});

export default router;
