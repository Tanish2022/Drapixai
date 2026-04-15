import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

export const resolveActiveApiKey = async (prisma: PrismaClient, rawApiKey: string | undefined) => {
  const apiKey = String(rawApiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) {
    return null;
  }

  const keys = await prisma.apiKey.findMany({ where: { isActive: true } });
  for (const key of keys) {
    if (await bcrypt.compare(apiKey, key.keyHash)) {
      return key;
    }
  }

  return null;
};
