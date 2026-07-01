export const ADMIN_SESSION_COOKIE = 'drapixai_admin_session';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const getAdminSessionSecret = () => {
  const explicitSecret = process.env.ADMIN_SESSION_SECRET || '';
  const fallbackSecret = process.env.NODE_ENV === 'production' ? '' : process.env.NEXTAUTH_SECRET || '';
  const secret = explicitSecret || fallbackSecret;

  if (process.env.NODE_ENV === 'production' && explicitSecret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET_WEAK_OR_MISSING');
  }

  return secret;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const encodeBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return fromBase64(`${normalized}${padding}`);
};

const getEncryptionKey = async () => {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET_NOT_CONFIGURED');
  }

  const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey(
    'raw',
    hashed,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
};

type AdminSessionPayload = {
  scope: 'admin';
  apiKey: string;
  expiresAt: number;
};

export const createAdminSessionToken = async (apiKey: string) => {
  const payload: AdminSessionPayload = {
    scope: 'admin',
    apiKey,
    expiresAt: Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getEncryptionKey(),
    encoder.encode(JSON.stringify(payload))
  );

  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(cipherBuffer))}`;
};

export const readAdminSessionToken = async (token: string | undefined) => {
  if (!token) {
    return null;
  }

  const secret = getAdminSessionSecret();
  if (!secret) {
    return null;
  }

  const [ivPart, cipherPart] = token.split('.');
  if (!ivPart || !cipherPart) {
    return null;
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64Url(ivPart) },
      await getEncryptionKey(),
      decodeBase64Url(cipherPart)
    );
    const parsed = JSON.parse(decoder.decode(decrypted)) as AdminSessionPayload;

    if (parsed.scope !== 'admin' || parsed.expiresAt <= Date.now() || !parsed.apiKey) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const verifyAdminSessionToken = async (token: string | undefined) => {
  return Boolean(await readAdminSessionToken(token));
};
