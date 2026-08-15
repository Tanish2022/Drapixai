import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;

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

export const verifyAdminTotp = (
  email: string,
  rawCode: unknown,
  now = Date.now(),
  requireForRole = false,
) => {
  if (!requireForRole && !isSystemAdminEmail(email)) return true;

  const secretValue = (process.env.DRAPIXAI_ADMIN_TOTP_SECRET || '').trim();
  if (!secretValue) return process.env.NODE_ENV !== 'production';

  const code = String(rawCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return false;

  try {
    const secret = decodeBase32(secretValue);
    const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
    return [-1, 0, 1].some((offset) => timingSafeCodeEqual(code, codeForCounter(secret, counter + offset)));
  } catch {
    return false;
  }
};
