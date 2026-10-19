import { Router, type Response } from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { formatLogError } from '../lib/security';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { issueApiKeyForUser, applyVerifiedPassword } from '../lib/api-key-auth';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { ADMIN_MFA_SCOPE, ADMIN_SESSION_KEY_MAX_AGE_MS, requiresAdminMfa, consumeAdminTotp } from '../lib/admin-mfa';
import { validatePasswordStrength } from '../lib/security';
import { hashPassword, hashPasswordAfterAuthorization, verifyPassword, isPasswordHashBusy, LOGIN_TIMING_SENTINEL_HASH } from '../lib/password-hash';
import { TRIAL_DAYS, normalizeSelectedPlan } from '../lib/plans';
import { issueVerificationCode, consumeVerificationCode, normalizeEmail } from '../lib/verification';
import { sendOtpEmail, sendWelcomeEmail } from '../services/emailer';
import { appendSecurityAudit } from '../lib/audit-log';
import { hasCurrentAccountTerms, recordAccountTermsAcceptance, validateTermsAcceptance, TERMS_PENDING_SCOPE, TERMS_PENDING_MAX_AGE_MS } from '../lib/account-terms';

const router = Router();
const prisma = new PrismaClient();
const authRateLimit = createRateLimitMiddleware(10, 15 * 60 * 1000);
const authIdentityRateLimit = createRateLimitMiddleware(5, 15 * 60 * 1000, (req) => {
  const identity = normalizeEmail(String(req.body?.email || 'missing'));
  const digest = crypto.createHash('sha256').update(identity).digest('hex');
  return `auth-identity:${digest}:${req.path}`;
});
const AUTH_SYNC_TOKEN = process.env.DRAPIXAI_AUTH_SYNC_TOKEN || '';

const isProduction = () => process.env.NODE_ENV === 'production';

const hasValidAuthSyncToken = (provided: unknown) => {
  if (!AUTH_SYNC_TOKEN) return false;
  const token = Array.isArray(provided) ? provided[0] : String(provided || '');
  const expected = Buffer.from(AUTH_SYNC_TOKEN);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const publicAuthFailure = (error: unknown, fallback: string, fallbackStatus = 500) => {
  if (isPasswordHashBusy(error)) return { status: 503, error: 'AUTHENTICATION_BUSY' };
  return { status: fallbackStatus, error: fallback };
};
const writeAuthFailure = (res: Response, error: unknown, fallback: string) => {
  const failure = publicAuthFailure(error, fallback);
  if (failure.status === 503) res.setHeader('Retry-After', '1');
  return res.status(failure.status).json({ error: failure.error });
};

router.use(authRateLimit);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

router.post('/register/request-otp', authIdentityRateLimit, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'EMAIL_REQUIRED' });
    }

    const normalizedEmail = normalizeEmail(String(email));
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });
    }

    const { code } = await issueVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'signup',
    });

    await sendOtpEmail(normalizedEmail, code, 'signup');
    return res.json({
      ok: true,
      debugOtp: !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production' ? code : undefined,
    });
  } catch (err: unknown) {
    return writeAuthFailure(res, err, 'OTP_REQUEST_FAILED');
  }
});

router.post('/password-reset/request-otp', authIdentityRateLimit, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'EMAIL_REQUIRED' });
    }

    const normalizedEmail = normalizeEmail(String(email));
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      return res.json({ ok: true });
    }

    const { code } = await issueVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'password_reset',
      userId: user.id,
    });

    await sendOtpEmail(normalizedEmail, code, 'password_reset', user.id);
    return res.json({
      ok: true,
      debugOtp: !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production' ? code : undefined,
    });
  } catch (err: unknown) {
    return writeAuthFailure(res, err, 'PASSWORD_RESET_OTP_REQUEST_FAILED');
  }
});

router.post('/password-reset/confirm', async (req, res) => {
  try {
    const { email, otp, password } = req.body || {};
    if (!email || !otp || !password) {
      return res.status(400).json({ error: 'EMAIL_OTP_AND_PASSWORD_REQUIRED' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const normalizedEmail = normalizeEmail(String(email));
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const passwordHash = await hashPasswordAfterAuthorization(password, async () => user ? consumeVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'password_reset',
      code: String(otp),
      userId: user.id,
    }) : false);
    if (!passwordHash || !user) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }

    const revokedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id, email: normalizedEmail, authVersion: user.authVersion, role: user.role },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt || revokedAt,
          authVersion: { increment: 1 },
        },
      }),
      prisma.apiKey.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false, revokedAt },
      }),
      prisma.verificationCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: revokedAt } }),
    ]);

    return res.json({ ok: true });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2025') return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    return writeAuthFailure(res, err, 'PASSWORD_RESET_FAILED');
  }
});
router.post('/register', async (req, res) => {
  try {
    const { email, password, companyName, selectedPlan, otp, mobileNumber, termsAcceptance } = req.body || {};
    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'EMAIL_PASSWORD_AND_OTP_REQUIRED' });
    }
    const termsError = validateTermsAcceptance(termsAcceptance);
    if (termsError) return res.status(400).json({ error: termsError });
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const normalizedEmail = normalizeEmail(String(email));
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });

    const passwordHash = await hashPasswordAfterAuthorization(password, () => consumeVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'signup',
      code: String(otp),
    }));
    if (!passwordHash) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }
    
    const normalizedSelectedPlan = normalizeSelectedPlan(selectedPlan);
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_DAYS);
    
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
      data: {
        email: normalizedEmail,
        emailVerifiedAt: new Date(),
        passwordHash,
        companyName: companyName || '',
        mobileNumber: mobileNumber ? String(mobileNumber).trim() : null,
        planType: 'trial',
        selectedPlan: normalizedSelectedPlan,
        subscriptionPlan: normalizedSelectedPlan,
        subscriptionStatus: 'trialing',
        trialExpiresAt,
        subscriptionCurrentPeriodEndsAt: trialExpiresAt,
      }
      });
      await recordAccountTermsAcceptance(tx, created.id, termsAcceptance, 'password_signup');
      return created;
    });

    const apiKey = await issueApiKeyForUser(prisma, user.id);
    void sendWelcomeEmail(user.id, user.email, user.companyName).catch(() => undefined);
    res.json({
      apiKey,
      user: {
        email: user.email,
        planType: user.planType,
        selectedPlan: user.selectedPlan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err: unknown) {
    return writeAuthFailure(res, err, 'REGISTER_FAILED');
  }
});

router.post('/login', authIdentityRateLimit, async (req, res) => {
  try {
    const { email, password, issueNewKey = true, mfaCode } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
    }
    const normalizedEmail = normalizeEmail(String(email));
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const verified = await verifyPassword(
      password,
      user?.passwordHash || LOGIN_TIMING_SENTINEL_HASH,
    );
    if (!user || !verified.matches) {
      await appendSecurityAudit(prisma, {
        actorRole: 'unknown',
        action: 'auth.login.denied',
        outcome: 'denied',
        ip: req.ip,
      }).catch(() => undefined);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Do any necessary KDF work before consuming a one-use operator TOTP.
    const upgradedHash = verified.needsUpgrade ? await hashPassword(password) : undefined;
    if (!await consumeAdminTotp(prisma, user, mfaCode)) {
      await appendSecurityAudit(prisma, {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.mfa.denied',
        outcome: 'denied',
        ip: req.ip,
      }).catch(() => undefined);
      return res.status(401).json({ error: 'MFA_REQUIRED_OR_INVALID' });
    }

    if (!user.emailVerifiedAt) {
      await appendSecurityAudit(prisma, {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.email_unverified.denied',
        outcome: 'denied',
        ip: req.ip,
      }).catch(() => undefined);
      return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
    }

    const termsRequired = !await hasCurrentAccountTerms(prisma, user.id);
    const apiKey = issueNewKey ? await issueApiKeyForUser(prisma, user.id, {
      ...(requiresAdminMfa(normalizedEmail, user.role) ? {
        scopes: ['dashboard', ADMIN_MFA_SCOPE], expiresAt: new Date(Date.now() + ADMIN_SESSION_KEY_MAX_AGE_MS),
      } : {}),
      ...(termsRequired ? {
        scopes: [TERMS_PENDING_SCOPE, ...(requiresAdminMfa(normalizedEmail, user.role) ? [ADMIN_MFA_SCOPE] : [])],
        expiresAt: new Date(Date.now() + TERMS_PENDING_MAX_AGE_MS),
      } : {}),
      passwordProof: { snapshot: user, upgradedHash },
    }) : null;
    if (!issueNewKey) await applyVerifiedPassword(prisma, user, upgradedHash);
    await appendSecurityAudit(prisma, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login.succeeded',
      targetType: 'user_session',
      ip: req.ip,
      metadata: { apiKeyIssued: Boolean(apiKey) },
    });
    res.json({
      apiKey,
      termsRequired,
      user: {
        email: user.email,
        planType: user.planType,
        selectedPlan: user.selectedPlan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2025') return res.status(401).json({ error: 'Invalid credentials' });
    return writeAuthFailure(res, err, 'LOGIN_FAILED');
  }
});

/**
 * POST /auth/oauth/google
 * Auto-create user on Google login
 */
router.post('/oauth/google', async (req, res) => {
  try {
    if (!AUTH_SYNC_TOKEN && isProduction()) {
      return res.status(503).json({ error: 'AUTH_SYNC_NOT_CONFIGURED' });
    }
    if (AUTH_SYNC_TOKEN && !hasValidAuthSyncToken(req.headers['x-drapixai-auth-sync-token'])) {
      return res.status(401).json({ error: 'AUTH_SYNC_TOKEN_REQUIRED' });
    }

    const { email, name, issueNewKey, selectedPlan } = req.body || {};
    if (!email) return res.status(400).json({ error: 'EMAIL_REQUIRED' });
    const normalizedEmail = normalizeEmail(String(email));
    const normalizedSelectedPlan = normalizeSelectedPlan(selectedPlan);

    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    // Google identity alone is not proof of the local operator TOTP challenge.
    // The existing password + MFA login remains the privileged entry point.
    if (requiresAdminMfa(normalizedEmail, user?.role)) {
      return res.status(403).json({ error: 'ADMIN_PASSWORD_MFA_REQUIRED' });
    }
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          emailVerifiedAt: new Date(),
          passwordHash: await hashPassword(crypto.randomBytes(32).toString('base64url')),
          companyName: name || null,
          planType: 'trial',
          selectedPlan: normalizedSelectedPlan,
          subscriptionPlan: normalizedSelectedPlan,
          subscriptionStatus: 'trialing',
          trialExpiresAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          subscriptionCurrentPeriodEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        }
      });
    } else if ((!user.companyName && name) || (!user.selectedPlan && normalizedSelectedPlan)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          companyName: user.companyName || name || null,
          selectedPlan: user.selectedPlan || normalizedSelectedPlan,
          subscriptionPlan: user.subscriptionPlan || normalizedSelectedPlan,
          subscriptionStatus: user.subscriptionStatus || 'trialing',
        },
      });
    }

    let apiKeyValue: string | null = null;
    const termsRequired = !await hasCurrentAccountTerms(prisma, user.id);
    if (issueNewKey) {
      apiKeyValue = await issueApiKeyForUser(prisma, user.id, termsRequired ? {
        scopes: [TERMS_PENDING_SCOPE], expiresAt: new Date(Date.now() + TERMS_PENDING_MAX_AGE_MS),
      } : {});
    }

    return res.json({ ok: true, userId: user.id, apiKey: apiKeyValue, termsRequired });
  } catch (error) {
    console.error('OAuth sync error:', formatLogError(error));
    return writeAuthFailure(res, error, 'OAUTH_SYNC_FAILED');
  }
});

router.post('/logout', async (req, res) => {
  try {
    const apiKey = await resolveActiveApiKey(prisma, req.headers.authorization, { allowUnacceptedTerms: true });
    if (!apiKey) return res.status(401).json({ error: 'INVALID_API_KEY' });
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { isActive: false, revokedAt: new Date() },
    });
    const user = await prisma.user.findUnique({ where: { id: apiKey.userId }, select: { role: true } });
    await appendSecurityAudit(prisma, {
      actorUserId: apiKey.userId,
      actorRole: user?.role || 'unknown',
      action: 'auth.logout.succeeded',
      targetType: 'api_key',
      targetId: apiKey.id,
      ip: req.ip,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', formatLogError(error));
    return res.status(500).json({ error: 'LOGOUT_FAILED' });
  }
});

export default router;
