import crypto from 'crypto';
import type { PrismaClient, User } from '@prisma/client';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
export const ADMIN_MFA_SCOPE = 'admin:mfa';
export const ADMIN_SESSION_KEY_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const decodeBase32 = (value: string) => {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('INVALID_TOTP_SECRET');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  if (bytes.length < 10) throw new Error('INVALID_TOTP_SECRET');
  return Buffer.from(bytes);
};

const codeForCounter = (secret: Buffer, counter: number) => {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % 1_000_000).padStart(6, '0');
};

const timingSafeCodeEqual = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

export const isSystemAdminEmail = (email: string) => {
  const adminEmail = (process.env.DRAPIXAI_ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(adminEmail) && email.trim().toLowerCase() === adminEmail;
};

export const requiresAdminMfa = (email: string, role: unknown) =>
  role === 'system_admin' || isSystemAdminEmail(email);

const matchingTotpCounters = (
  rawCode: unknown,
  now: number,
) => {
  const secretValue = (process.env.DRAPIXAI_ADMIN_TOTP_SECRET || '').trim();
  const code = String(rawCode || '').replace(/\s+/g, '');
  if (!secretValue || !/^\d{6}$/.test(code) || !Number.isFinite(now) || now < 0) return [];

  try {
    const secret = decodeBase32(secretValue);
    const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
    return [-1, 0, 1].map((offset) => counter + offset)
      .filter((step) => step >= 0 && timingSafeCodeEqual(code, codeForCounter(secret, step)));
  } catch {
    return [];
  }
};

// Cryptographic verification only; authentication must use consumeAdminTotp.
export const verifyAdminTotp = (email: string, rawCode: unknown, now = Date.now(), requireForRole = false) => {
  if (!requireForRole && !isSystemAdminEmail(email)) return true;
  if (!(process.env.DRAPIXAI_ADMIN_TOTP_SECRET || '').trim()) return process.env.NODE_ENV !== 'production';
  return matchingTotpCounters(rawCode, now).length > 0;
};

export const consumeAdminTotp = async (
  prisma: PrismaClient,
  user: Pick<User, 'id' | 'email' | 'role'>,
  rawCode: unknown,
  now = Date.now(),
) => {
  if (!requiresAdminMfa(user.email, user.role)) return true;
  if (!(process.env.DRAPIXAI_ADMIN_TOTP_SECRET || '').trim()) return process.env.NODE_ENV !== 'production';
  const counters = matchingTotpCounters(rawCode, now);
  if (!counters.length) return false;
  // Cover every matching step in the skew window, including rare code collisions.
  // The predicate and update are one DB operation across all API replicas.
  const result = await prisma.user.updateMany({
    where: {
      id: user.id, email: user.email, role: user.role,
      OR: [{ adminTotpLastCounter: null }, { adminTotpLastCounter: { lt: BigInt(counters[0]) } }],
    },
    data: { adminTotpLastCounter: BigInt(counters[counters.length - 1]) },
  });
  return result.count === 1;
};
