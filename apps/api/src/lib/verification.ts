import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const generateOtpCode = () =>
  Array.from({ length: OTP_LENGTH }, () => Math.floor(Math.random() * 10)).join('');

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
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return false;
  }

  const matches = await bcrypt.compare(String(params.code || '').trim(), record.codeHash);
  if (!matches) {
    return false;
  }

  await prisma.verificationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return true;
};
