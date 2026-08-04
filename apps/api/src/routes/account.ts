import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { parseCatalogFeed } from '../lib/catalog-feed';
import { upsertCatalogProductsForUser } from '../lib/catalog-matching';
import { normalizePublicDomain, safeFetchText } from '../lib/remote-fetch';
import { consumeVerificationCode, issueVerificationCode, normalizeEmail } from '../lib/verification';
import { sendOtpEmail } from '../services/emailer';
import { PASSWORD_HASH_ROUNDS, validatePasswordStrength } from '../lib/security';
import { hasPermission } from '../lib/authorization';

const router = Router();
const prisma = new PrismaClient();
const accountRateLimit = createRateLimitMiddleware(20, 15 * 60 * 1000);

const generateVerificationToken = () => `drapix_${crypto.randomBytes(18).toString('base64url')}`;
const normalizeDomainInput = (value: string) => normalizePublicDomain(value);
const allowInsecureStoreVerification = () =>
  process.env.NODE_ENV !== 'production' && process.env.DRAPIXAI_ALLOW_INSECURE_STORE_VERIFICATION === '1';

const normalizeFeedUrl = (value: string) => {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:') {
    throw new Error('FEED_URL_HTTPS_REQUIRED');
  }
  if (parsed.username || parsed.password) {
    throw new Error('FEED_URL_CREDENTIALS_NOT_ALLOWED');
  }
  return parsed.toString();
};

const buildVerificationMetaTag = (token: string) =>
  `<meta name="drapixai-domain-verification" content="${token}" />`;

const normalizeStoreSettingsError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'FEED_URL_HTTPS_REQUIRED' || message === 'FEED_URL_CREDENTIALS_NOT_ALLOWED') {
    return message;
  }
  return 'INVALID_STORE_SETTINGS';
};

const normalizeVerificationFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('timeout') || message.includes('aborted')) return 'STORE_VERIFICATION_TIMEOUT';
  if (message.includes('redirect')) return 'STORE_VERIFICATION_REDIRECT_BLOCKED';
  if (message.includes('protocol')) return 'STORE_VERIFICATION_PROTOCOL_BLOCKED';
  return 'STORE_VERIFICATION_REQUEST_FAILED';
};

const normalizeCatalogSyncFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Feed request failed with status ')) return 'CATALOG_FEED_REQUEST_FAILED';
  if (message.includes('timeout') || message.includes('aborted')) return 'CATALOG_FEED_TIMEOUT';
  if (message.includes('redirect')) return 'CATALOG_FEED_REDIRECT_BLOCKED';
  if (message.includes('protocol')) return 'CATALOG_FEED_PROTOCOL_BLOCKED';
  if (message.includes('parse') || message.includes('CSV') || message.includes('JSON')) return 'CATALOG_FEED_PARSE_FAILED';
  return 'CATALOG_SYNC_FAILED';
};

router.use(accountRateLimit);
router.use(requireDashboardProxy);

const resolveUser = async (authorizationHeader: string | undefined) => {
  const activeKey = await resolveActiveApiKey(prisma, authorizationHeader);
  if (!activeKey) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: activeKey.userId } });
  if (!user) {
    return null;
  }
  if (!hasPermission(user.role, 'tenant:manage')) {
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
    themePreference: user.themePreference || 'light',
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
      themePreference: nextTheme || resolved.user.themePreference || 'light',
    },
  });

  return res.json({
    ok: true,
    companyName: user.companyName || '',
    mobileNumber: user.mobileNumber || '',
    themePreference: user.themePreference || 'light',
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
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const matches = await bcrypt.compare(String(currentPassword), resolved.user.passwordHash);
  if (!matches) {
    return res.status(400).json({ error: 'CURRENT_PASSWORD_INCORRECT' });
  }

  const nextPasswordHash = await bcrypt.hash(String(newPassword), PASSWORD_HASH_ROUNDS);
  const revokedAt = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resolved.user.id },
      data: { passwordHash: nextPasswordHash, authVersion: { increment: 1 } },
    }),
    prisma.apiKey.updateMany({
      where: { userId: resolved.user.id, isActive: true },
      data: { isActive: false, revokedAt },
    }),
  ]);

  return res.json({ ok: true, sessionsRevoked: true });
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

  const revokedAt = new Date();
  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: resolved.user.id },
      data: {
        email: normalizedNewEmail,
        emailVerifiedAt: revokedAt,
        authVersion: { increment: 1 },
      },
    }),
    prisma.apiKey.updateMany({
      where: { userId: resolved.user.id, isActive: true },
      data: { isActive: false, revokedAt },
    }),
  ]);

  return res.json({ ok: true, email: user.email, sessionsRevoked: true });
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

  let normalizedDomain = resolved.activeKey.domainWhitelist;
  let normalizedFeedUrl: string | null = null;
  try {
    normalizedDomain = String(domain || '').trim() ? normalizeDomainInput(String(domain)) : resolved.activeKey.domainWhitelist;
    normalizedFeedUrl = normalizedSyncSource === 'feed_url' ? normalizeFeedUrl(String(feedUrl || '')) : null;
  } catch (error) {
    return res.status(400).json({ error: normalizeStoreSettingsError(error) });
  }
  const nextToken = resolved.user.storeVerificationToken || generateVerificationToken();
  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: {
      storeVerificationToken: nextToken,
      storeVerifiedAt: normalizedDomain !== resolved.activeKey.domainWhitelist ? null : resolved.user.storeVerifiedAt,
      catalogSyncSource: normalizedSyncSource,
      catalogFeedUrl: normalizedFeedUrl,
    },
  });

  const activeKey = await prisma.apiKey.update({
    where: { id: resolved.activeKey.id },
    data: { domainWhitelist: normalizedDomain || '*' },
  });
  await prisma.apiKey.updateMany({
    where: { userId: resolved.user.id, kind: 'manual', isActive: true },
    data: { domainWhitelist: activeKey.domainWhitelist },
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

  const allowInsecureVerification = allowInsecureStoreVerification();
  const allowedVerificationProtocols = allowInsecureVerification ? ['https:', 'http:'] : ['https:'];
  const urlsToCheck = allowInsecureVerification ? [`https://${domain}`, `http://${domain}`] : [`https://${domain}`];
  let matched = false;
  let lastError = '';
  for (const url of urlsToCheck) {
    try {
      const { response, text: html } = await safeFetchText(url, {
        allowedProtocols: allowedVerificationProtocols,
        maxBytes: 512 * 1024,
        timeoutMs: 8000,
      });
      if (!response.ok) {
        lastError = `Unable to fetch ${url}`;
        continue;
      }
      if (html.includes(buildVerificationMetaTag(token)) || html.includes(`content="${token}"`)) {
        matched = true;
        break;
      }
      lastError = 'Verification meta tag was not found on the homepage.';
    } catch (error) {
      lastError = normalizeVerificationFailure(error);
    }
  }

  if (!matched) {
    return res.status(400).json({
      error: 'STORE_VERIFICATION_FAILED',
      reason: lastError || (allowInsecureVerification ? 'STORE_VERIFICATION_FAILED' : 'STORE_VERIFICATION_HTTPS_FAILED'),
    });
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
    const { response, text: feedText } = await safeFetchText(feedUrl, {
      allowedProtocols: ['https:'],
      maxBytes: Number(process.env.DRAPIXAI_CATALOG_FEED_MAX_BYTES || 2 * 1024 * 1024),
      timeoutMs: 10000,
    });
    if (!response.ok) {
      throw new Error(`Feed request failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
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
    const failureCode = normalizeCatalogSyncFailure(error);
    await prisma.user.update({
      where: { id: resolved.user.id },
      data: { catalogLastSyncStatus: `FAILED:${failureCode}` },
    });
    return res.status(400).json({ error: failureCode });
  }
});

export default router;
