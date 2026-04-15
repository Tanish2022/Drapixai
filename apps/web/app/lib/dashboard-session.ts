export const DASHBOARD_SESSION_COOKIE = 'drapixai_dashboard_session';
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const getDashboardSessionSecret = () => process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || '';

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
  const secret = getDashboardSessionSecret();
  if (!secret) {
    throw new Error('DASHBOARD_SESSION_SECRET_NOT_CONFIGURED');
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

type DashboardSessionPayload = {
  scope: 'dashboard';
  apiKey: string;
  expiresAt: number;
};

export const createDashboardSessionToken = async (apiKey: string) => {
  const payload: DashboardSessionPayload = {
    scope: 'dashboard',
    apiKey,
    expiresAt: Date.now() + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000,
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getEncryptionKey(),
    encoder.encode(JSON.stringify(payload))
  );

  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(cipherBuffer))}`;
};

export const readDashboardSessionToken = async (token: string | undefined) => {
  if (!token) {
    return null;
  }

  const secret = getDashboardSessionSecret();
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
    const parsed = JSON.parse(decoder.decode(decrypted)) as DashboardSessionPayload;

    if (parsed.scope !== 'dashboard' || parsed.expiresAt <= Date.now() || !parsed.apiKey) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const verifyDashboardSessionToken = async (token: string | undefined) => {
  return Boolean(await readDashboardSessionToken(token));
};
