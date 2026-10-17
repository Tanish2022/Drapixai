import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, isPasswordInput } from '../lib/password-hash';
import { passwordCredentialWhere } from '../lib/api-key-auth';

const bootstrapPrisma = new PrismaClient();

export const ensureAdminUser = async (prisma: PrismaClient = bootstrapPrisma) => {
  const adminEmail = (process.env.DRAPIXAI_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.DRAPIXAI_ADMIN_PASSWORD || '';

  if (!adminEmail || !adminPassword) {
    console.warn('Admin bootstrap skipped because DRAPIXAI_ADMIN_EMAIL or DRAPIXAI_ADMIN_PASSWORD is missing.');
    return;
  }
  if (!isPasswordInput(adminPassword)) throw new Error('ADMIN_BOOTSTRAP_PASSWORD_INVALID');

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        role: 'system_admin',
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

  const verified = await verifyPassword(adminPassword, existing.passwordHash);
  const credentialChanged = !verified.matches || existing.role !== 'system_admin';
  if (
    !verified.matches || verified.needsUpgrade ||
    existing.companyName !== 'DrapixAI Admin' ||
    existing.role !== 'system_admin' ||
    existing.planType !== 'pro' ||
    existing.subscriptionPlan !== 'pro' ||
    existing.subscriptionStatus !== 'active'
  ) {
    const passwordHash = !verified.matches || verified.needsUpgrade ? await hashPassword(adminPassword) : existing.passwordHash;
    const revokedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: passwordCredentialWhere(existing),
        data: {
          passwordHash,
          ...(credentialChanged ? { authVersion: { increment: 1 } } : {}),
          role: 'system_admin',
          companyName: 'DrapixAI Admin',
          planType: 'pro',
          selectedPlan: 'pro',
          subscriptionPlan: 'pro',
          subscriptionStatus: 'active',
          subscriptionProvider: 'internal',
          trialExpiresAt: null,
          subscriptionCurrentPeriodEndsAt: null,
        },
      }),
      ...(credentialChanged ? [
        prisma.apiKey.updateMany({ where: { userId: existing.id, isActive: true }, data: { isActive: false, revokedAt } }),
        prisma.verificationCode.updateMany({ where: { userId: existing.id, consumedAt: null }, data: { consumedAt: revokedAt } }),
      ] : []),
    ]);
  }
};
