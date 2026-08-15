import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { createStorageClient, getStorageEncryptionParams, STORAGE_BUCKET, STORAGE_LOCAL_FALLBACK_ALLOWED } from '../lib/storage';
import { buildUploadPath, detectImageMimeType, sanitizePathSegment } from '../lib/security';
import { aiFetch } from '../lib/ai-client';
import { isTryOnIntakeEnabled } from '../lib/tryon-intake';

const AI_URL = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');
const AI_SERVICE_TOKEN = (process.env.DRAPIXAI_AI_SERVICE_TOKEN || '').trim();
const positiveIntegerSetting = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name] || fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
};
const MAX_IMAGE_BYTES = positiveIntegerSetting('DRAPIXAI_SHOPIFY_IMAGE_MAX_BYTES', 10 * 1024 * 1024, 50 * 1024 * 1024);
const MAX_IMAGE_PIXELS = positiveIntegerSetting('DRAPIXAI_SHOPIFY_IMAGE_MAX_PIXELS', 40_000_000, 100_000_000);
const MAX_ATTEMPTS = positiveIntegerSetting('DRAPIXAI_SHOPIFY_PREPARE_MAX_ATTEMPTS', 3, 10);
// Sharp 0.34 supports this constructor option, but its callable overload can lose the
// field when TypeScript resolves declarations from mixed CommonJS consumers.
const SHARP_INPUT_SAFETY_OPTIONS = {
  limitInputPixels: MAX_IMAGE_PIXELS,
} as unknown as NonNullable<Parameters<typeof sharp>[1]>;
const ALLOWED_IMAGE_HOSTS = (process.env.DRAPIXAI_SHOPIFY_IMAGE_HOSTS || 'cdn.shopify.com,*.shopifycdn.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const storage = createStorageClient();

type GarmentPreprocessResponse = {
  cache_key?: string;
  image_base64?: string;
  profile_label?: string;
  warnings?: string[];
};

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

const downloadShopifyImage = async (imageUrl: string) => {
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

const imageExtension = (mime: string) => mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';

const storeImage = async (
  userId: number,
  garmentId: string,
  kind: 'originals' | 'thumbs',
  bytes: Buffer,
  mime: string,
) => {
  const extension = imageExtension(mime);
  const safeGarmentId = sanitizePathSegment(garmentId, 'garment');
  const filename = `${crypto.randomUUID()}${extension}`;
  const key = `garments/${kind}/${userId}/${safeGarmentId}/${filename}`;
  try {
    await storage.send(new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: mime,
      ...getStorageEncryptionParams(),
    }));
    return `s3://${STORAGE_BUCKET}/${key}`;
  } catch (error) {
    if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;
    const directory = buildUploadPath('garments', userId, safeGarmentId, kind);
    fs.mkdirSync(directory, { recursive: true });
    const localPath = path.join(directory, filename);
    fs.writeFileSync(localPath, bytes);
    return `local:${localPath}`;
  }
};

export const queueShopifyCatalogPreparation = async (
  prisma: PrismaClient,
  userId: number,
  productIds: string[],
) => {
  const products = await prisma.catalogProduct.findMany({
    where: {
      userId,
      productId: { in: productIds },
      isVariant: false,
      status: { not: 'archived' },
    },
  });
  let queued = 0;
  let alreadyPrepared = 0;
  let missingImage = 0;

  for (const product of products) {
    if (!product.imageUrl) {
      missingImage += 1;
      continue;
    }
    const sourceChanged = Boolean(product.preparedImageUrl && product.preparedImageUrl !== product.imageUrl);
    const preparationCurrent = ['review_required', 'prepared', 'ready'].includes(product.preparationStatus)
      && product.preparedImageUrl === product.imageUrl;
    if (preparationCurrent) {
      alreadyPrepared += 1;
      continue;
    }

    await prisma.$transaction(async (transaction) => {
      if (sourceChanged && product.preparedGarmentId) {
        await transaction.garment.updateMany({
          where: { userId, garmentId: product.preparedGarmentId },
          data: { status: 'stale' },
        });
        await transaction.garmentMatch.updateMany({
          where: { userId, garmentId: product.preparedGarmentId },
          data: {
            confirmedProductId: null,
            suggestedProductId: product.productId,
            status: 'suggested',
            matchReason: 'Shopify product image changed; regenerate and review the garment cache.',
          },
        });
      }
      await transaction.catalogProduct.update({
        where: { id: product.id },
        data: {
          preparationStatus: 'queued',
          preparationAttempts: 0,
          preparationError: null,
          preparationWarnings: undefined,
          preparationQueuedAt: new Date(),
          preparationStartedAt: null,
          preparationNextAttemptAt: null,
          preparationCompletedAt: null,
        },
      });
    });
    queued += 1;
  }

  return { queued, alreadyPrepared, missingImage };
};

const preprocessProduct = async (prisma: PrismaClient, productId: number) => {
  const product = await prisma.catalogProduct.findUnique({ where: { id: productId } });
  if (!product?.imageUrl) throw new Error('SHOPIFY_PRODUCT_IMAGE_MISSING');
  const { image, mime } = await downloadShopifyImage(product.imageUrl);
  const garmentId = `shopify-${product.productId}`;
  const aiResponse = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AI_SERVICE_TOKEN ? { 'x-drapixai-service-token': AI_SERVICE_TOKEN } : {}),
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      cloth_image_base64: image.toString('base64'),
      brand_id: String(product.userId),
      garment_id: garmentId,
      category: product.category || undefined,
      product_name: product.productName || product.productId,
      garment_type: product.garmentType || 'upper',
      admin_bypass: false,
    }),
  });
  if (!aiResponse.ok) {
    throw new Error(aiResponse.status >= 400 && aiResponse.status < 500
      ? 'SHOPIFY_GARMENT_VALIDATION_FAILED'
      : 'SHOPIFY_AI_PREPROCESS_UNAVAILABLE');
  }
  const result = await aiResponse.json() as GarmentPreprocessResponse;
  if (!result.cache_key || !result.image_base64) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const processed = Buffer.from(result.image_base64, 'base64');
  const processedMime = detectImageMimeType(processed.subarray(0, 16));
  if (!processedMime) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const thumbnail = await sharp(processed, SHARP_INPUT_SAFETY_OPTIONS)
    .resize(256, 256, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
  const [originalUrl, thumbnailUrl] = await Promise.all([
    storeImage(product.userId, garmentId, 'originals', image, mime),
    storeImage(product.userId, garmentId, 'thumbs', thumbnail, 'image/png'),
  ]);
  const originalHash = crypto.createHash('sha256').update(image).digest('hex');

  await prisma.$transaction(async (transaction) => {
    await transaction.garment.upsert({
      where: { userId_garmentId: { userId: product.userId, garmentId } },
      update: {
        displayName: product.productName || product.productId,
        cacheKey: result.cache_key,
        originalHash,
        originalUrl,
        sourceImageUrl: product.imageUrl,
        thumbnailUrl,
        productName: product.productName,
        category: product.category,
        garmentType: product.garmentType || 'upper',
        status: 'pending',
        rejectedReason: null,
      },
      create: {
        userId: product.userId,
        garmentId,
        displayName: product.productName || product.productId,
        cacheKey: result.cache_key,
        originalHash,
        originalUrl,
        sourceImageUrl: product.imageUrl,
        thumbnailUrl,
        productName: product.productName,
        category: product.category,
        garmentType: product.garmentType || 'upper',
        status: 'pending',
      },
    });
    await transaction.garmentMatch.upsert({
      where: { userId_garmentId: { userId: product.userId, garmentId } },
      update: {
        suggestedProductId: product.productId,
        confirmedProductId: null,
        status: 'suggested',
        confidence: 1,
        matchReason: 'Prepared automatically from the synchronized Shopify product image; review before publishing.',
      },
      create: {
        userId: product.userId,
        garmentId,
        suggestedProductId: product.productId,
        status: 'suggested',
        confidence: 1,
        matchReason: 'Prepared automatically from the synchronized Shopify product image; review before publishing.',
      },
    });
    await transaction.catalogProduct.update({
      where: { id: product.id },
      data: {
        preparationStatus: 'review_required',
        preparationError: null,
        preparationWarnings: result.warnings || [],
        preparationCompletedAt: new Date(),
        preparationNextAttemptAt: null,
        preparedImageUrl: product.imageUrl,
        preparedGarmentId: garmentId,
      },
    });
  });
};

const failureCode = (error: unknown) => {
  const code = error instanceof Error ? error.message : 'SHOPIFY_PREPARATION_FAILED';
  return code.startsWith('SHOPIFY_') ? code : 'SHOPIFY_PREPARATION_FAILED';
};

const acquirePreparationLease = async (prisma: PrismaClient) => {
  const id = 'shopify-catalog-preparation';
  const ownerToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  try {
    await prisma.catalogPreparationLease.create({ data: { id, ownerToken, expiresAt } });
    return { id, ownerToken };
  } catch {
    const claimed = await prisma.catalogPreparationLease.updateMany({
      where: { id, expiresAt: { lte: new Date() } },
      data: { ownerToken, expiresAt },
    });
    return claimed.count === 1 ? { id, ownerToken } : null;
  }
};

const releasePreparationLease = async (prisma: PrismaClient, lease: { id: string; ownerToken: string }) => {
  await prisma.catalogPreparationLease.deleteMany({
    where: { id: lease.id, ownerToken: lease.ownerToken },
  });
};

export const processShopifyCatalogPreparationBatch = async (
  prisma: PrismaClient,
  limit = 3,
  userId?: number,
) => {
  if (!isTryOnIntakeEnabled()) {
    return { busy: false, paused: true, items: [] as Array<{ productId: string; status: string; error?: string }> };
  }
  const lease = await acquirePreparationLease(prisma);
  if (!lease) return { busy: true, items: [] as Array<{ productId: string; status: string; error?: string }> };
  try {
  const now = new Date();
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 10)) : 3;
  const candidates = await prisma.catalogProduct.findMany({
    where: {
      ...(userId !== undefined ? { userId } : {}),
      isVariant: false,
      status: { not: 'archived' },
      preparationAttempts: { lt: MAX_ATTEMPTS },
      OR: [
        { preparationStatus: 'queued' },
        { preparationStatus: 'retry', preparationNextAttemptAt: { lte: now } },
      ],
    },
    orderBy: { preparationQueuedAt: 'asc' },
    take: normalizedLimit,
  });
  const results: Array<{ productId: string; status: string; error?: string }> = [];

  for (const candidate of candidates) {
    const claimed = await prisma.catalogProduct.updateMany({
      where: { id: candidate.id, preparationStatus: candidate.preparationStatus },
      data: {
        preparationStatus: 'processing',
        preparationStartedAt: new Date(),
        preparationAttempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    try {
      await preprocessProduct(prisma, candidate.id);
      results.push({ productId: candidate.productId, status: 'review_required' });
    } catch (error) {
      const code = failureCode(error);
      const attempt = candidate.preparationAttempts + 1;
      const permanent = code === 'SHOPIFY_GARMENT_VALIDATION_FAILED'
        || code.includes('HOST_NOT_ALLOWED')
        || code.includes('TYPE_UNSUPPORTED')
        || code.includes('LOW_RESOLUTION')
        || code.includes('PIXEL_LIMIT')
        || code.includes('TOO_LARGE');
      const canRetry = !permanent && attempt < MAX_ATTEMPTS;
      await prisma.catalogProduct.update({
        where: { id: candidate.id },
        data: {
          preparationStatus: canRetry ? 'retry' : 'failed',
          preparationError: code,
          preparationNextAttemptAt: canRetry
            ? new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempt - 1)))
            : null,
        },
      });
      results.push({ productId: candidate.productId, status: canRetry ? 'retry' : 'failed', error: code });
    }
  }
    return { busy: false, items: results };
  } finally {
    await releasePreparationLease(prisma, lease);
  }
};
