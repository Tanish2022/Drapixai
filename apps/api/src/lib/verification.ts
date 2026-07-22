import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const generateOtpCode = () =>
  crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

export const issueVerificationCode = async (
  prisma: PrismaClient,
  params: {
    email: string;
    purpose: string;
    userId?: number | null;
  }
) => {
  const email = normalizeEmail(params.email);
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.verificationCode.updateMany({
    where: {
      email,
      purpose: params.purpose,
      userId: params.userId ?? null,
      consumedAt: null,
    },
    data: {
      consumedAt: new Date(),
    },
  });

  await prisma.verificationCode.create({
    data: {
      userId: params.userId ?? null,
      email,
      purpose: params.purpose,
      codeHash,
      expiresAt,
    },
  });

  return { code, expiresAt };
};

export const consumeVerificationCode = async (
  prisma: PrismaClient,
  params: {
    email: string;
    purpose: string;
    code: string;
    userId?: number | null;
  }
) => {
  const email = normalizeEmail(params.email);
  const record = await prisma.verificationCode.findFirst({
    where: {
      email,
      purpose: params.purpose,
      userId: params.userId ?? null,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      attemptCount: { lt: OTP_MAX_ATTEMPTS },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return false;
  }

  const attempt = await prisma.verificationCode.updateMany({
    where: {
      id: record.id,
      consumedAt: null,
      attemptCount: { lt: OTP_MAX_ATTEMPTS },
    },
    data: { attemptCount: { increment: 1 } },
  });
  if (attempt.count !== 1) {
    return false;
  }

  const matches = await bcrypt.compare(String(params.code || '').trim(), record.codeHash);
  if (!matches) {
    return false;
  }

  const consumed = await prisma.verificationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  return consumed.count === 1;
};
