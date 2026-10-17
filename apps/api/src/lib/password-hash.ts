import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

// OWASP's 32 MiB scrypt variant. Fixed parameters also bound untrusted stored
// encodings; a future cost change needs an explicitly reviewed format version.
export const PASSWORD_SCRYPT = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
export const PASSWORD_WORK_LIMIT = 2;
const HEADER = 'scrypt$v1$32768$8$3$';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
let activeWork = 0;

// Public, synthetic sentinel: never a real account credential. Unknown users
// still incur the current KDF work without generating a new hash on each login.
export const LOGIN_TIMING_SENTINEL_HASH = 'scrypt$v1$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$jkYjW94tK7FoYw1u-VH9hsnPLtCqv9Xf_NxyE7iSSh3YviqJL4L-Ti7xXtBEXPw4tw8Zbnxm17V50fyvfEgobQ';

export class PasswordHashBusyError extends Error {
  constructor() { super('AUTHENTICATION_BUSY'); this.name = 'PasswordHashBusyError'; }
}
export const isPasswordHashBusy = (error: unknown) => error instanceof PasswordHashBusyError;

export const isPasswordInput = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128
  && !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value;

const withWork = async <T>(work: () => Promise<T>): Promise<T> => {
  // No unbounded queue of passwords/requests or memory-hard jobs. This is a
  // per-process work cap, in addition to existing distributed request limits.
  if (activeWork >= PASSWORD_WORK_LIMIT) throw new PasswordHashBusyError();
  activeWork++;
  try { return await work(); } finally { activeWork--; }
};

const derive = async (password: string, salt: Buffer) => {
  const bytes = Buffer.from(password, 'utf8');
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(bytes, salt, KEY_BYTES, PASSWORD_SCRYPT, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { bytes.fill(0); }
};

const createHash = async (password: string) => {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  try { return HEADER + salt.toString('base64url') + '$' + key.toString('base64url'); }
  finally { key.fill(0); }
};

export const hashPassword = async (password: unknown) => {
  if (!isPasswordInput(password)) throw new Error('INVALID_PASSWORD');
  return withWork(() => createHash(password));
};

// Reserve capacity before consuming a one-time authorization code. Overload
// must not burn a valid OTP and force a merchant to request a replacement.
export const hashPasswordAfterAuthorization = async (
  password: unknown,
  authorize: () => Promise<boolean>,
) => {
  if (!isPasswordInput(password)) throw new Error('INVALID_PASSWORD');
  return withWork(async () => await authorize() ? createHash(password) : null);
};

export type PasswordVerification = { matches: boolean; needsUpgrade: boolean; resetRequired: boolean };
const denied = (): PasswordVerification => ({ matches: false, needsUpgrade: false, resetRequired: false });

export const verifyPassword = async (password: unknown, stored: unknown): Promise<PasswordVerification> => {
  if (!isPasswordInput(password) || typeof stored !== 'string') return denied();
  if (stored.startsWith(HEADER)) {
    const fields = stored.slice(HEADER.length).split('$');
    if (fields.length !== 2 || !/^[A-Za-z0-9_-]{22}$/.test(fields[0]) || !/^[A-Za-z0-9_-]{86}$/.test(fields[1])) return denied();
    const salt = Buffer.from(fields[0], 'base64url'), expected = Buffer.from(fields[1], 'base64url');
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES
      || salt.toString('base64url') !== fields[0] || expected.toString('base64url') !== fields[1]) return denied();
    return withWork(async () => {
      const actual = await derive(password, salt);
      try { return { matches: timingSafeEqual(actual, expected), needsUpgrade: false, resetRequired: false }; }
      finally { actual.fill(0); expected.fill(0); }
    });
  }
  const legacy = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(stored);
  if (!legacy || Number(legacy[1]) < 4 || Number(legacy[1]) > 14) return denied();
  return withWork(async () => {
    if (Buffer.byteLength(password, 'utf8') >= 72) {
      // A bcrypt record cannot tell an exact 72-byte password from a truncated
      // longer one. Do not authenticate or migrate an arbitrary shared prefix.
      // The caller returns its ordinary invalid-credential response, preserving
      // account-disclosure behavior. Recovery must prove mailbox ownership.
      const dummy = await derive(password, Buffer.alloc(SALT_BYTES)); dummy.fill(0);
      return { matches: false, needsUpgrade: false, resetRequired: true };
    }
    const matches = await bcrypt.compare(password, stored);
    return { matches, needsUpgrade: matches, resetRequired: false };
  });
};
