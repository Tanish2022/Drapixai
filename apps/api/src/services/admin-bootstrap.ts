import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ensureAdminUser = async () => {
  const adminEmail = (process.env.DRAPIXAI_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = (process.env.DRAPIXAI_ADMIN_PASSWORD || '').trim();

  if (!adminEmail || !adminPassword) {
    console.warn('Admin bootstrap skipped because DRAPIXAI_ADMIN_EMAIL or DRAPIXAI_ADMIN_PASSWORD is missing.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        companyName: 'DrapixAI Admin',
        planType: 'pro',
        selectedPlan: 'pro',
        subscriptionPlan: 'pro',
        subscriptionStatus: 'active',
        subscriptionProvider: 'internal',
        trialExpiresAt: null,
        subscriptionCurrentPeriodEndsAt: null,
      },
    });
    return;
  }

  const passwordMatches = await bcrypt.compare(adminPassword, existing.passwordHash);
  if (
    !passwordMatches ||
    existing.companyName !== 'DrapixAI Admin' ||
    existing.planType !== 'pro' ||
    existing.subscriptionPlan !== 'pro' ||
    existing.subscriptionStatus !== 'active'
  ) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        companyName: 'DrapixAI Admin',
        planType: 'pro',
        selectedPlan: 'pro',
        subscriptionPlan: 'pro',
        subscriptionStatus: 'active',
        subscriptionProvider: 'internal',
        trialExpiresAt: null,
        subscriptionCurrentPeriodEndsAt: null,
      },
    });
  }
};
