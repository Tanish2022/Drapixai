import sharp from 'sharp';
import { detectImageMimeType } from '../lib/security';

export const positiveIntegerSetting = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] || fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
};
export const MAX_IMAGE_BYTES = positiveIntegerSetting('DRAPIXAI_SHOPIFY_IMAGE_MAX_BYTES', 10 * 1024 * 1024, 50 * 1024 * 1024);
export const MAX_IMAGE_PIXELS = positiveIntegerSetting('DRAPIXAI_SHOPIFY_IMAGE_MAX_PIXELS', 40_000_000, 100_000_000);
export const MAX_ATTEMPTS = positiveIntegerSetting('DRAPIXAI_SHOPIFY_PREPARE_MAX_ATTEMPTS', 3, 10);
// Sharp 0.34 supports this constructor option, but its callable overload can lose the
// field when TypeScript resolves declarations from mixed CommonJS consumers.
const SHARP_INPUT_SAFETY_OPTIONS = {
  limitInputPixels: MAX_IMAGE_PIXELS,
} as unknown as NonNullable<Parameters<typeof sharp>[1]>;
const ALLOWED_IMAGE_HOSTS = (process.env.DRAPIXAI_SHOPIFY_IMAGE_HOSTS || 'cdn.shopify.com,*.shopifycdn.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);


const isAllowedHost = (hostname: string) => ALLOWED_IMAGE_HOSTS.some((rule) => {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === rule;
});

export const validateShopifyImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && isAllowedHost(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const readResponseBody = async (response: Response) => {
  if (!response.body) throw new Error('SHOPIFY_IMAGE_EMPTY');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('SHOPIFY_IMAGE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
};

export const downloadShopifyImage = async (imageUrl: string) => {
  if (!validateShopifyImageUrl(imageUrl)) throw new Error('SHOPIFY_IMAGE_HOST_NOT_ALLOWED');
  const response = await fetch(imageUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'image/jpeg,image/png,image/webp' },
  });
  if (!response.ok) throw new Error('SHOPIFY_IMAGE_DOWNLOAD_FAILED');
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('SHOPIFY_IMAGE_TOO_LARGE');
  const image = await readResponseBody(response);
  const mime = detectImageMimeType(image.subarray(0, 16));
  if (!mime) throw new Error('SHOPIFY_IMAGE_TYPE_UNSUPPORTED');
  const metadata = await sharp(image, SHARP_INPUT_SAFETY_OPTIONS).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512) {
    throw new Error('SHOPIFY_IMAGE_LOW_RESOLUTION');
  }
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error('SHOPIFY_IMAGE_PIXEL_LIMIT');
  return { image, mime };
};
