import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { formatLogError } from '../lib/security';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { issueApiKeyForUser } from '../lib/api-key-auth';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import { verifyAdminTotp } from '../lib/admin-mfa';
import { PASSWORD_HASH_ROUNDS, validatePasswordStrength } from '../lib/security';
import { TRIAL_DAYS, normalizeSelectedPlan } from '../lib/plans';
import { issueVerificationCode, consumeVerificationCode, normalizeEmail } from '../lib/verification';
import { sendOtpEmail } from '../services/emailer';
import { appendSecurityAudit } from '../lib/audit-log';

const router = Router();
const prisma = new PrismaClient();
const authRateLimit = createRateLimitMiddleware(10, 15 * 60 * 1000);
const authIdentityRateLimit = createRateLimitMiddleware(5, 15 * 60 * 1000, (req) => {
  const identity = normalizeEmail(String(req.body?.email || 'missing'));
  const digest = crypto.createHash('sha256').update(identity).digest('hex');
  return `auth-identity:${digest}:${req.path}`;
});
const AUTH_SYNC_TOKEN = process.env.DRAPIXAI_AUTH_SYNC_TOKEN || '';

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET_NOT_CONFIGURED');
  }
  return secret;
};

const issueJwt = (userId: number) =>
  jwt.sign({ userId }, getJwtSecret(), {
    expiresIn: '7d',
    issuer: 'drapixai',
  });

const isProduction = () => process.env.NODE_ENV === 'production';

const hasValidAuthSyncToken = (provided: unknown) => {
  if (!AUTH_SYNC_TOKEN) return false;
  const token = Array.isArray(provided) ? provided[0] : String(provided || '');
  const expected = Buffer.from(AUTH_SYNC_TOKEN);
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const publicAuthFailure = (error: unknown, fallback: string, fallbackStatus = 400) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'JWT_SECRET_NOT_CONFIGURED') {
    return { status: 500, error: 'AUTH_CONFIGURATION_ERROR' };
  }

  return { status: fallbackStatus, error: fallback };
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
    const failure = publicAuthFailure(err, 'OTP_REQUEST_FAILED');
    return res.status(failure.status).json({ error: failure.error });
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
    const failure = publicAuthFailure(err, 'PASSWORD_RESET_OTP_REQUEST_FAILED');
    return res.status(failure.status).json({ error: failure.error });
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
    if (!user) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }

    const otpValid = await consumeVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'password_reset',
      code: String(otp),
      userId: user.id,
    });
    if (!otpValid) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }

    const revokedAt = new Date();
    const passwordHash = await bcrypt.hash(String(password), PASSWORD_HASH_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
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
    ]);

    return res.json({ ok: true });
  } catch (err: unknown) {
    const failure = publicAuthFailure(err, 'PASSWORD_RESET_FAILED');
    return res.status(failure.status).json({ error: failure.error });
  }
});
router.post('/register', async (req, res) => {
  try {
    const { email, password, companyName, selectedPlan, otp, mobileNumber } = req.body;
    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'EMAIL_PASSWORD_AND_OTP_REQUIRED' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const normalizedEmail = normalizeEmail(String(email));
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });

    const otpValid = await consumeVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'signup',
      code: String(otp),
    });
    if (!otpValid) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }
    
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    const normalizedSelectedPlan = normalizeSelectedPlan(selectedPlan);
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + TRIAL_DAYS);
    
    const user = await prisma.user.create({
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

    const apiKey = await issueApiKeyForUser(prisma, user.id);
    const token = issueJwt(user.id);
    res.json({
      token,
      apiKey,
      user: {
        email: user.email,
        planType: user.planType,
        selectedPlan: user.selectedPlan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err: unknown) {
    const failure = publicAuthFailure(err, 'REGISTER_FAILED');
    res.status(failure.status).json({ error: failure.error });
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
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await appendSecurityAudit(prisma, {
        actorRole: 'unknown',
        action: 'auth.login.denied',
        outcome: 'denied',
        ip: req.ip,
      }).catch(() => undefined);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!verifyAdminTotp(normalizedEmail, mfaCode)) {
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

    const apiKey = issueNewKey ? await issueApiKeyForUser(prisma, user.id) : null;
    const token = issueJwt(user.id);
    await appendSecurityAudit(prisma, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login.succeeded',
      targetType: 'user_session',
      ip: req.ip,
      metadata: { apiKeyIssued: Boolean(apiKey) },
    });
    res.json({
      token,
      apiKey,
      user: {
        email: user.email,
        planType: user.planType,
        selectedPlan: user.selectedPlan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err: unknown) {
    const failure = publicAuthFailure(err, 'LOGIN_FAILED');
    res.status(failure.status).json({ error: failure.error });
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
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          emailVerifiedAt: new Date(),
          passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), PASSWORD_HASH_ROUNDS),
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
    if (issueNewKey) {
      apiKeyValue = await issueApiKeyForUser(prisma, user.id);
    }

    return res.json({ ok: true, userId: user.id, apiKey: apiKeyValue });
  } catch (error) {
    console.error('OAuth sync error:', formatLogError(error));
    return res.status(500).json({ error: 'OAUTH_SYNC_FAILED' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const apiKey = await resolveActiveApiKey(prisma, req.headers.authorization);
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
