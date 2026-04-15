import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { TRIAL_DAYS, normalizeSelectedPlan } from '../lib/plans';
import { issueVerificationCode, consumeVerificationCode, normalizeEmail } from '../lib/verification';
import { sendOtpEmail } from '../services/emailer';

const router = Router();
const prisma = new PrismaClient();
const authRateLimit = createRateLimitMiddleware(10, 15 * 60 * 1000);

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

router.use(authRateLimit);

router.post('/register/request-otp', async (req, res) => {
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
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'OTP_REQUEST_FAILED' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, companyName, selectedPlan, otp, mobileNumber } = req.body;
    if (!email || !password || !otp) {
      return res.status(400).json({ error: 'EMAIL_PASSWORD_AND_OTP_REQUIRED' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    }
    const normalizedEmail = normalizeEmail(String(email));
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const otpValid = await consumeVerificationCode(prisma, {
      email: normalizedEmail,
      purpose: 'signup',
      code: String(otp),
    });
    if (!otpValid) {
      return res.status(400).json({ error: 'INVALID_OR_EXPIRED_OTP' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
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

    const apiKey = await issueApiKeyForUser(user.id);
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
  } catch (err: any) {
    const status = err?.message === 'JWT_SECRET_NOT_CONFIGURED' ? 500 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, issueNewKey = true } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
    }
    const normalizedEmail = normalizeEmail(String(email));
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.emailVerifiedAt) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const apiKey = issueNewKey ? await issueApiKeyForUser(user.id) : null;
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
  } catch (err: any) {
    const status = err?.message === 'JWT_SECRET_NOT_CONFIGURED' ? 500 : 400;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /auth/oauth/google
 * Auto-create user on Google login
 */
router.post('/oauth/google', async (req, res) => {
  try {
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
          passwordHash: await bcrypt.hash(Math.random().toString(36).slice(2), 10),
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
      apiKeyValue = await issueApiKeyForUser(user.id);
    }

    return res.json({ ok: true, userId: user.id, apiKey: apiKeyValue });
  } catch (error) {
    console.error('OAuth sync error:', error);
    return res.status(500).json({ error: 'OAUTH_SYNC_FAILED' });
  }
});

export default router;
