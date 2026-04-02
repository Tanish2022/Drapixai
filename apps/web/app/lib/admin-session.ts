export const ADMIN_SESSION_COOKIE = 'drapixai_admin_session';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const getAdminSessionSecret = () => process.env.ADMIN_SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encodeBase64Url = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
};

const getSigningKey = async () => {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(getAdminSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const sign = async (payload: string) => {
  const signature = await crypto.subtle.sign('HMAC', await getSigningKey(), encoder.encode(payload));
  return toHex(signature);
};

export const createAdminSessionToken = async () => {
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = encodeBase64Url(JSON.stringify({ scope: 'admin', expiresAt }));
  return `${payload}.${await sign(payload)}`;
};

export const verifyAdminSessionToken = async (token: string | undefined) => {
  if (!token) {
    return false;
  }

  const secret = getAdminSessionSecret();
  if (!secret) {
    return false;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = await sign(payload);
  if (signature !== expectedSignature) {
    return false;
  }

  try {
    const parsed = JSON.parse(decoder.decode(Uint8Array.from(decodeBase64Url(payload), (char) => char.charCodeAt(0)))) as {
      scope?: string;
      expiresAt?: number;
    };
    return parsed.scope === 'admin' && typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
};
