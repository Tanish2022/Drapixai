import crypto from 'crypto';

export const SHOPIFY_STATE_COOKIE = 'drapixai_shopify_state';

const getApiSecret = () => {
  const secret = (process.env.SHOPIFY_API_SECRET || '').trim();
  if (!secret) throw new Error('SHOPIFY_API_SECRET_NOT_CONFIGURED');
  return secret;
};

const getStateSecret = () => {
  const secret = (process.env.DRAPIXAI_SHOPIFY_STATE_SECRET || process.env.JWT_SECRET || '').trim();
  if (secret.length < 32) throw new Error('SHOPIFY_STATE_SECRET_NOT_CONFIGURED');
  return secret;
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const normalizeShopDomain = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase();
  const withoutProtocol = raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(withoutProtocol)) return null;
  return withoutProtocol;
};

export const normalizeOriginHost = (value: unknown) => {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const verifyShopifyQueryHmac = (rawQuery: string) => {
  const params = new URLSearchParams(rawQuery);
  const provided = params.get('hmac') || '';
  params.delete('hmac');
  params.delete('signature');
  const message = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const expected = crypto.createHmac('sha256', getApiSecret()).update(message).digest('hex');
  return Boolean(provided) && safeEqual(expected, provided);
};

export const verifyShopifyAppProxyQuery = (rawQuery: string, maxAgeSeconds = 300) => {
  const params = new URLSearchParams(rawQuery);
  const provided = params.get('signature') || '';
  params.delete('signature');

  const grouped = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }
  const message = Array.from(grouped.entries())
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');
  const expected = crypto.createHmac('sha256', getApiSecret()).update(message).digest('hex');
  const timestamp = Number(params.get('timestamp') || 0);
  const timestampValid = Number.isFinite(timestamp)
    && Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= maxAgeSeconds;
  return timestampValid && Boolean(provided) && safeEqual(expected, provided);
};

type ShopifyStatePayload = { shop: string; nonce: string; exp: number };

export const createShopifyState = (shop: string) => {
  const payload: ShopifyStatePayload = {
    shop,
    nonce: crypto.randomBytes(24).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url');
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
};

export const verifyShopifyState = (state: string): ShopifyStatePayload | null => {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url');
  if (!safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ShopifyStatePayload;
    if (!payload.shop || !payload.nonce || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const readCookie = (cookieHeader: string | undefined, name: string) => {
  const entry = String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
};

export const generateLinkToken = () => crypto.randomBytes(32).toString('base64url');
export const hashLinkToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

export const verifyShopifyWebhookHmac = (rawBody: Buffer, provided: unknown) => {
  const expected = crypto.createHmac('sha256', getApiSecret()).update(rawBody).digest('base64');
  return safeEqual(expected, String(provided || ''));
};
