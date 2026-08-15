/**
 * SDK Routes for DrapixAI Virtual Try-On API
 */

import { Router } from 'express';
import { aiFetch } from '../lib/ai-client';
import { Prisma, PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { acquireTryOnSlot, releaseTryOnSlot } from '../lib/tryon-concurrency';
import { requireTryOnIntake } from '../lib/tryon-intake';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { processWithWatermark } from '../services/watermark';
import { createStorageClient, getStorageEncryptionParams, STORAGE_BUCKET, STORAGE_LOCAL_FALLBACK_ALLOWED } from '../lib/storage';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import {
  issueGenericStorefrontToken,
  isStorefrontProductAllowed,
  resolveActiveApiKey,
  resolveSdkApiKey,
  StorefrontCredentialContext,
} from '../lib/api-key-auth';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { CatalogSyncInputItem, isSupportedUpperBodyItem, normalizeCatalogItem } from '../lib/catalog-feed';
import {
  buildGarmentAssetId,
  clearConfirmedGarmentMatch,
  confirmGarmentMatch,
  humanizeIdentifier,
  recomputeGarmentMatchesForUser,
  resolveConfirmedGarmentForProduct,
  upsertCatalogProductsForUser,
} from '../lib/catalog-matching';
import { getPlanAccessContext } from '../lib/plans';
import {
  buildProductAccuracyReport,
  getTryOnConfidenceBadge,
  shouldAutoRejectTryOn,
} from '../lib/tryon-quality';
import {
  buildUploadPath,
  getUploadRoot,
  isAllowedImageFileContent,
  isAllowedImageUpload,
  readLocalUploadFile,
  removeUploadedFile,
  sanitizePathSegment,
  sanitizeUpstreamError,
  formatLogError,
} from '../lib/security';
import { getUserMonthlyUsage, incrementApiKeyUsage } from '../lib/usage';
import { hasPermission, ownsTenantResource } from '../lib/authorization';
import { appendSecurityAudit } from '../lib/audit-log';
import { validateMultipartFields } from '../lib/input-validation';
import {
  SHOPPER_MEDIA_RETENTION,
  SHOPPER_PRIVACY_POLICY_VERSION,
  SHOPPER_TRAINING_USE,
} from '../lib/privacy';

const router = Router();
const prisma = new PrismaClient();

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});
type GarmentPreprocessResponse = {
  cache_key: string;
  image_base64: string;
  did_process: boolean;
  reason: string;
  profile_key?: string;
  profile_label?: string;
  support_level?: string;
  warnings?: string[];
};

const parseJsonSafe = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const getGarmentValidationCode = (raw: string) => {
  const parsed = parseJsonSafe<{ detail?: string; error?: string }>(raw);
  const detail = parsed?.detail || parsed?.error || raw;
  return detail.startsWith('GARMENT_INVALID:') ? detail.replace('GARMENT_INVALID:', '') : detail;
};

const getGarmentValidationMessage = (code: string) => {
  switch (code) {
    case 'LOW_RESOLUTION':
      return 'Use a higher-resolution garment image. Uploads should be at least 512x512.';
    case 'IMAGE_BLURRY':
      return 'The garment image is too blurry. Upload a sharper source image.';
    case 'SUBJECT_TOO_SMALL':
      return 'The garment is too small in frame. Upload one centered garment that fills more of the image.';
    case 'NO_BACKGROUND_REMOVAL':
      return 'The background is too dominant. Use a plain background or a transparent garment image.';
    case 'MODEL_WORN_GARMENT':
      return 'Upload a garment-only image. Photos with a person wearing the garment are rejected because they reduce try-on realism.';
    case 'GARMENT_TOO_LONG':
      return 'This garment is too long for the current upper-body launch scope. Use tops, shirts, blouses, or short kurtis with tighter framing.';
    case 'GARMENT_CATEGORY_UNSUPPORTED':
      return 'This garment category is not in the current realism-focused launch scope. Use shirts, t-shirts, polos, tops, blouses, or short upper-body kurtis.';
    case 'LOWER_BODY_NOT_ENABLED':
      return 'Lower-body try-on is not enabled for this environment yet.';
    default:
      return 'Garment upload failed validation. Use one isolated upper-body garment on a clean background.';
  }
};

// Initialize Redis client
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (error) => {
  console.error('SDK Redis client error:', formatLogError(error));
});
redis.connect().catch((error) => {
  console.error('Redis connection error:', formatLogError(error));
});

// Initialize S3 client (MinIO)
const s3 = createStorageClient();
const BUCKET = STORAGE_BUCKET;
const SINGLE_DOMAIN_REQUIRED = true;
const ALLOW_SDK_DOMAIN_AUTO_BIND =
  process.env.NODE_ENV !== 'production' &&
  (process.env.DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND || '0') === '1';
const MAX_UPLOAD_BYTES = Number(process.env.DRAPIXAI_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const AI_SERVICE_TOKEN = process.env.DRAPIXAI_AI_SERVICE_TOKEN || '';
const LEGACY_ASYNC_RENDER_ENABLED = (process.env.DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER || '0') === '1';

const requireLegacyAsyncRender = (_req: any, res: any, next: any) => {
  if (!LEGACY_ASYNC_RENDER_ENABLED) {
    return res.status(410).json({
      error: 'LEGACY_ASYNC_RENDER_DISABLED',
      message: 'Use POST /sdk/tryon for the supported Standard try-on flow.',
    });
  }
  next();
};

// Configure multer for file uploads
const UPLOAD_ROOT = getUploadRoot();
const upload = multer({
  dest: UPLOAD_ROOT,
  limits: { fileSize: MAX_UPLOAD_BYTES, fieldSize: 8 * 1024, fields: 20 },
  fileFilter: (_req, file, callback) => {
    callback(null, isAllowedImageUpload(file));
  }
});
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const rejectInvalidMultipartFields = (req: any, res: any) => {
  const failure = validateMultipartFields(req.body);
  if (!failure) return false;
  const uploaded = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat() as Express.Multer.File[];
  for (const file of [...uploaded, ...(req.file ? [req.file] : [])]) removeUploadedFile(file);
  res.status(400).json({ error: failure.code });
  return true;
};
const AI_URL = process.env.DRAPIXAI_AI_URL || 'http://localhost:8080';
const ADMIN_TOKEN = process.env.DRAPIXAI_ADMIN_TOKEN || '';
const REQUIRE_GARMENT_CACHE = (process.env.DRAPIXAI_REQUIRE_GARMENT_CACHE || '1') === '1';
const GARMENT_APPROVAL_REQUIRED = (process.env.DRAPIXAI_GARMENT_APPROVAL_REQUIRED || '0') === '1';
const TRYON_LATENCY_TARGET_MS = Number(process.env.DRAPIXAI_TARGET_TRYON_MS || 12000);
const AUTO_REJECT_BAD_RESULTS = (process.env.DRAPIXAI_AUTO_REJECT_BAD_RESULTS || '1') === '1';
const SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON = (process.env.DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON || '0') === '1';
const SDK_GENERATION_SOURCE = (process.env.DRAPIXAI_SDK_GENERATION_SOURCE || 'original_verified').toLowerCase();
const EXPECTED_GARMENT_CACHE_VERSION = process.env.DRAPIXAI_GARMENT_CACHE_VERSION || 'v3-1024x1365';
const ENABLE_LOWER_BODY = (process.env.DRAPIXAI_ENABLE_LOWER_BODY || '0') === '1';
const LOWER_BODY_ADMIN_REVIEW_REQUIRED = (process.env.DRAPIXAI_LOWER_BODY_ADMIN_REVIEW_REQUIRED || '1') === '1';
const EXPECTED_LOWER_BODY_CACHE_VERSION = process.env.DRAPIXAI_LOWER_BODY_CACHE_VERSION || 'lower-v1-1024x1365';
const LOWER_BODY_ALLOWED_CATEGORIES = new Set(
  (process.env.DRAPIXAI_LOWER_BODY_ALLOWED_CATEGORIES || 'jeans,pants,trousers,shorts,skirt,leggings,joggers')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const EXPECTED_GARMENT_CACHE_WIDTH = Number(process.env.DRAPIXAI_GARMENT_TARGET_WIDTH || 1024);
const EXPECTED_GARMENT_CACHE_HEIGHT = Number(process.env.DRAPIXAI_GARMENT_TARGET_HEIGHT || 1365);

const parseNumberHeader = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseWarningsHeader = (value: string | null): string[] => {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
};

const normalizeSdkQuality = (value: unknown) => {
  const requested = String(value || 'standard').trim().toLowerCase();
  if (!requested || requested === 'standard') return 'standard';
  return null;
};

const normalizeGarmentType = (value: unknown) => {
  const normalized = String(value || 'upper').trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'upper' || normalized === 'upper_body') return 'upper';
  if (normalized === 'lower' || normalized === 'lower_body') return 'lower';
  return '';
};

const getExpectedCacheVersion = (garmentType: string) =>
  garmentType === 'lower' ? EXPECTED_LOWER_BODY_CACHE_VERSION : EXPECTED_GARMENT_CACHE_VERSION;

const isLowerCategoryAllowed = (category: string | undefined | null, profile?: string | undefined | null) => {
  const haystack = `${category || ''} ${profile || ''}`.toLowerCase();
  if (!haystack.trim()) return true;
  return Array.from(LOWER_BODY_ALLOWED_CATEGORIES).some((categoryKey) => haystack.includes(categoryKey));
};

const resolveLowerCategory = (category: string | undefined | null, profile?: string | undefined | null) => {
  const haystack = `${category || ''} ${profile || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const paddedHaystack = ` ${haystack.replace(/\s+/g, ' ').trim()} `;
  const aliases: Record<string, string[]> = {
    jeans: ['jeans', 'denim jeans', 'denim pants'],
    pants: ['pants', 'pant', 'chinos', 'slacks', 'bottoms'],
    trousers: ['trousers', 'trouser'],
    shorts: ['shorts', 'short', 'denim shorts'],
    skirt: ['skirt', 'mini skirt', 'pencil skirt', 'a line skirt'],
    leggings: ['leggings', 'legging', 'tights', 'yoga pants'],
    joggers: ['joggers', 'jogger', 'sweatpants', 'track pants'],
  };
  for (const [categoryKey, terms] of Object.entries(aliases)) {
    if (!LOWER_BODY_ALLOWED_CATEGORIES.has(categoryKey)) continue;
    if (terms.some((term) => paddedHaystack.includes(` ${term} `))) return categoryKey;
  }
  return undefined;
};

const isExpectedCacheKey = (cacheKey: string | undefined | null, garmentType = 'upper') => {
  const version = getExpectedCacheVersion(garmentType);
  return Boolean(cacheKey && cacheKey.startsWith(`${version}:`));
};

const getCacheImageInfo = async (cacheKey: string, garmentType = 'upper') => {
  const response = await aiFetch(`${AI_URL}/ai/garment/cache?cache_key=${encodeURIComponent(cacheKey)}`, {
    headers: getAiHeaders()
  });
  const width = Number(response.headers.get('x-drapixai-cache-width') || 0);
  const height = Number(response.headers.get('x-drapixai-cache-height') || 0);
  const version = response.headers.get('x-drapixai-cache-version') || '';
  return {
    ok: response.ok,
    width,
    height,
    version,
    matchesExpectedSize: width === EXPECTED_GARMENT_CACHE_WIDTH && height === EXPECTED_GARMENT_CACHE_HEIGHT,
    matchesExpectedVersion: version === getExpectedCacheVersion(garmentType) || isExpectedCacheKey(cacheKey, garmentType),
  };
};

const getAiHeaders = (headers: Record<string, string> = {}) => ({
  ...headers,
  ...(AI_SERVICE_TOKEN ? { 'x-drapixai-service-token': AI_SERVICE_TOKEN } : {}),
});

const getImageExtension = (contentType: string) => {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  return '.png';
};

const uploadReviewImage = async (
  userId: number,
  requestId: string,
  kind: 'person' | 'garment' | 'result',
  imageBytes: Buffer,
  contentType: string
): Promise<string> => {
  const extension = getImageExtension(contentType);
  const key = `tryon-review/${userId}/${requestId}/${kind}${extension}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: imageBytes,
      ContentType: contentType,
      ...getStorageEncryptionParams(),
    }));
    return `s3://${BUCKET}/${key}`;
  } catch (error) {
    if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;
    const localDir = buildUploadPath('tryon-review', userId, requestId);
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, `${kind}${extension}`);
    fs.writeFileSync(localPath, imageBytes);
    return `local:${localPath}`;
  }
};

const getUserPlanContext = (user: {
  planType?: string | null;
  subscriptionStatus?: string | null;
  subscriptionProvider?: string | null;
  subscriptionCurrentPeriodEndsAt?: Date | null;
  trialExpiresAt?: Date | null;
}) => getPlanAccessContext({
  planType: user.planType,
  subscriptionStatus: user.subscriptionStatus,
  subscriptionProvider: user.subscriptionProvider,
  subscriptionCurrentPeriodEndsAt: user.subscriptionCurrentPeriodEndsAt,
  trialExpiresAt: user.trialExpiresAt,
});

const uploadOriginalGarment = async (
  userId: number,
  garmentId: string,
  filePath: string,
  mime: string
): Promise<string> => {
  const fileContent = fs.readFileSync(filePath);
  const fileExtension = path.extname(filePath) || '.png';
  const storageGarmentId = sanitizePathSegment(garmentId, 'garment');
  const key = `garments/originals/${userId}/${storageGarmentId}/${crypto.randomUUID()}${fileExtension}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: mime,
      ...getStorageEncryptionParams(),
    }));
    return `s3://${BUCKET}/${key}`;
  } catch (error) {
    if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;
    const localDir = buildUploadPath('garments', userId, storageGarmentId);
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, `${crypto.randomUUID()}${fileExtension}`);
    fs.writeFileSync(localPath, fileContent);
    return `local:${localPath}`;
  }
};

const fetchOriginalGarment = async (originalUrl: string): Promise<Buffer | null> => {
  if (originalUrl.startsWith('local:')) {
    return readLocalUploadFile(originalUrl);
  }
  if (originalUrl.startsWith('s3://')) {
    const rest = originalUrl.replace('s3://', '');
    const [bucket, ...keyParts] = rest.split('/');
    const key = keyParts.join('/');
    try {
      const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  return null;
};

const uploadThumbnail = async (
  userId: number,
  garmentId: string,
  imageBytes: Buffer
): Promise<string> => {
  const thumb = await sharp(imageBytes).resize(256, 256, { fit: 'contain', background: '#00000000' }).png().toBuffer();
  const storageGarmentId = sanitizePathSegment(garmentId, 'garment');
  const key = `garments/thumbs/${userId}/${storageGarmentId}/${crypto.randomUUID()}.png`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: thumb,
      ContentType: 'image/png',
      ...getStorageEncryptionParams(),
    }));
    return `s3://${BUCKET}/${key}`;
  } catch (error) {
    if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;
    const localDir = buildUploadPath('garments', userId, storageGarmentId, 'thumbs');
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, `${crypto.randomUUID()}.png`);
    fs.writeFileSync(localPath, thumb);
    return `local:${localPath}`;
  }
};

const listGarmentsWithMatchState = async (userId: number) => {
  const [garments, matches, products] = await Promise.all([
    prisma.garment.findMany({
      where: {
        userId,
        OR: [
          { originalUrl: { not: null } },
          { cacheKey: { not: null } },
          { thumbnailUrl: { not: null } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.garmentMatch.findMany({ where: { userId } }),
    prisma.catalogProduct.findMany({ where: { userId } }),
  ]);

  const matchByGarmentId = new Map(matches.map((match) => [match.garmentId, match]));
  const productById = new Map(products.map((product) => [product.productId, product]));

  return garments.map((garment) => {
    const match = matchByGarmentId.get(garment.garmentId);
    const suggestedProduct = match?.suggestedProductId ? productById.get(match.suggestedProductId) : null;
    const confirmedProduct = match?.confirmedProductId ? productById.get(match.confirmedProductId) : null;
    return {
      garmentId: garment.garmentId,
      displayName: garment.displayName,
      cacheKey: garment.cacheKey,
      status: garment.status,
      productName: garment.productName,
      category: garment.category,
      garmentType: garment.garmentType,
      sourceImageUrl: garment.sourceImageUrl,
      updatedAt: garment.updatedAt,
      matchStatus: match?.status || 'unmatched',
      suggestedProductId: match?.suggestedProductId || null,
      suggestedProductName: suggestedProduct?.productName || null,
      confirmedProductId: match?.confirmedProductId || null,
      confirmedProductName: confirmedProduct?.productName || null,
      matchConfidence: match?.confidence ?? null,
      matchReason: match?.matchReason || null,
    };
  });
};

/**
 * Authentication Middleware
 */
const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    const resolvedCredential = await resolveSdkApiKey(prisma, req.headers.authorization);
    if (!resolvedCredential) {
      return res.status(401).json({ 
        error: 'Invalid API key',
        message: 'The provided API key is invalid or has been revoked'
      });
    }

    const validKey = resolvedCredential.apiKey;
    const validUser = await prisma.user.findUnique({ where: { id: validKey.userId } });
    if (!validUser) {
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'The API key is not attached to an active DrapixAI account'
      });
    }

    req.apiKey = validKey;
    req.user = validUser;
    req.isDashboardPreview = resolvedCredential.dashboardPreview;
    req.storefrontContext = resolvedCredential.storefront;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', formatLogError(error));
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const serverApiKeyMiddleware = async (req: any, res: any, next: any) => {
  try {
    const apiKey = await resolveActiveApiKey(prisma, req.headers.authorization);
    if (!apiKey || apiKey.kind !== 'manual' || !String(apiKey.scopes || '').split(',').includes('storefront:tryon')) {
      return res.status(401).json({
        error: 'SERVER_API_KEY_REQUIRED',
        message: 'Use an active server-side DrapixAI storefront key for this operation.',
      });
    }
    const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
    if (!user) return res.status(401).json({ error: 'SERVER_API_KEY_REQUIRED' });
    if (!hasPermission(user.role, 'tenant:manage')) {
      return res.status(403).json({ error: 'TENANT_MANAGER_REQUIRED' });
    }
    req.apiKey = apiKey;
    req.user = user;
    next();
  } catch (error) {
    console.error('Server API key middleware error:', formatLogError(error));
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const getRequestDomain = (req: any): string | null => {
  const origin = req.headers.origin || req.headers.referer;
  if (origin && typeof origin === 'string') {
    try {
      const url = new URL(origin);
      return url.hostname.toLowerCase();
    } catch {
      // ignore
    }
  }
  if (process.env.NODE_ENV === 'production') return null;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && typeof host === 'string') {
    return host.split(':')[0].toLowerCase();
  }
  return null;
};

const normalizeDomain = (domain: string) => domain.trim().toLowerCase();

const isDomainAllowed = (domainWhitelist: string, domain: string | null) => {
  if (!domain) return false;
  if (domainWhitelist === '*') return true;
  return normalizeDomain(domainWhitelist) === normalizeDomain(domain);
};

const enforceSingleDomain = async (apiKeyId: number, current: string | null, domainWhitelist: string) => {
  if (!current) return domainWhitelist;
  if (domainWhitelist === '*' && ALLOW_SDK_DOMAIN_AUTO_BIND) {
    const updated = await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { domainWhitelist: normalizeDomain(current) }
    });
    return updated.domainWhitelist;
  }
  return domainWhitelist;
};

const enforceSdkRequestDomain = async (req: any, res: any) => {
  const apiKey = req.apiKey;
  const storefront = req.storefrontContext as StorefrontCredentialContext | null;
  if (storefront?.channel === 'api') {
    req.sdkDomainWhitelist = 'server-to-server';
    return true;
  }
  if (storefront?.channel === 'mobile') {
    const requestAppId = String(req.headers['x-drapixai-app-id'] || '').trim();
    if (!requestAppId || requestAppId !== storefront.appId) {
      res.status(403).json({
        error: 'MOBILE_APP_NOT_ALLOWED',
        message: 'This shopper token is not authorized for the requesting mobile application.',
      });
      return false;
    }
    req.sdkDomainWhitelist = `mobile:${storefront.appId}`;
    return true;
  }
  if (process.env.NODE_ENV === 'production' && !req.user?.storeVerifiedAt && !req.isDashboardPreview) {
    res.status(403).json({
      error: 'STOREFRONT_NOT_VERIFIED',
      message: 'Verify storefront ownership in the DrapixAI dashboard before enabling shopper try-on.'
    });
    return false;
  }
  const requestDomain = getRequestDomain(req);
  const finalWhitelist = storefront?.allowedDomain
    || await enforceSingleDomain(apiKey.id, requestDomain, apiKey.domainWhitelist);
  if (SINGLE_DOMAIN_REQUIRED && finalWhitelist === '*') {
    res.status(403).json({
      error: 'SDK_DOMAIN_NOT_CONFIGURED',
      message: 'Configure and verify the storefront domain in the DrapixAI dashboard before using this API key.'
    });
    return false;
  }
  if (SINGLE_DOMAIN_REQUIRED && !isDomainAllowed(finalWhitelist, requestDomain)) {
    res.status(403).json({
      error: 'Domain not allowed',
      message: `This API key is not authorized for domain: ${requestDomain || 'unknown'}`
    });
    return false;
  }
  req.sdkDomainWhitelist = finalWhitelist;
  return true;
};

const requireShopperCredential = (req: any, res: any) => {
  const storefront = req.storefrontContext as StorefrontCredentialContext | null;
  if (storefront?.channel === 'api' && !storefront.scopes?.includes('api:tryon')) {
    res.status(403).json({
      error: 'API_SCOPE_DENIED',
      message: 'This public API access token does not include api:tryon.',
    });
    return false;
  }
  if (process.env.NODE_ENV === 'production' && !req.storefrontContext && !req.isDashboardPreview) {
    res.status(403).json({
      error: 'SHORT_LIVED_STOREFRONT_TOKEN_REQUIRED',
      message: 'Shopper try-on requests require a short-lived, product-scoped DrapixAI token.',
    });
    return false;
  }
  return true;
};

const enforceStorefrontProductScope = (req: any, res: any, productId: unknown) => {
  const storefront = req.storefrontContext as StorefrontCredentialContext | null;
  if (!storefront) return true;
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId || !isStorefrontProductAllowed(storefront, normalizedProductId)) {
    res.status(403).json({
      error: 'TOKEN_PRODUCT_SCOPE_DENIED',
      message: 'This shopper token is not authorized for the requested product.',
    });
    return false;
  }
  return true;
};
router.use(createRateLimitMiddleware(600, 15 * 60 * 1000));

/**
 * POST /sdk/storefront-token
 * Server-to-server token exchange. Permanent keys must never be exposed to shoppers.
 */
router.post('/storefront-token', serverApiKeyMiddleware, async (req: any, res: any) => {
  try {
    const apiKey = req.apiKey;
    const user = req.user;
    const channel = req.body?.channel === 'mobile' ? 'mobile' : req.body?.channel === 'web' ? 'web' : null;
    const requestedProductIds: unknown[] = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const productIds: string[] = [...new Set<string>(
      requestedProductIds.map((value: unknown) => String(value || '').trim()),
    )];
    if (!channel || productIds.length === 0 || productIds.length > 50 || productIds.some((id) => !id || id.length > 160)) {
      return res.status(400).json({ error: 'INVALID_STOREFRONT_TOKEN_REQUEST' });
    }

    let allowedDomain: string | null = null;
    let appId: string | null = null;
    if (channel === 'web') {
      allowedDomain = String(apiKey.domainWhitelist || '').trim().toLowerCase();
      if (!user.storeVerifiedAt || !allowedDomain || allowedDomain === '*') {
        return res.status(403).json({ error: 'STOREFRONT_NOT_VERIFIED' });
      }
    } else {
      appId = String(req.body?.appId || '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(appId)) {
        return res.status(400).json({ error: 'INVALID_MOBILE_APP_ID' });
      }
    }

    const unavailableProducts: string[] = [];
    for (const productId of productIds) {
      const garment = await resolveConfirmedGarmentForProduct(prisma, user.id, productId);
      if (!garment) unavailableProducts.push(productId);
    }
    if (unavailableProducts.length > 0) {
      return res.status(409).json({
        error: 'PRODUCT_NOT_DRAPIXAI_READY',
        productIds: unavailableProducts,
      });
    }

    const token = issueGenericStorefrontToken({
      apiKeyId: apiKey.id,
      userId: user.id,
      channel,
      allowedDomain,
      appId,
      productIds,
    });
    return res.json({ token, tokenType: 'Bearer', expiresInSeconds: 300, productIds, channel });
  } catch (error) {
    console.error('Storefront token exchange error:', formatLogError(error));
    return res.status(500).json({ error: 'STOREFRONT_TOKEN_ISSUE_FAILED' });
  }
});

/**
 * POST /sdk/validate
 * Validate API key and domain
 */
router.post('/validate', authMiddleware, async (req: any, res: any) => {
  try {
    const user = req.user;
    const apiKey = req.apiKey;
    if (!requireShopperCredential(req, res)) return;
    if (!(await enforceSdkRequestDomain(req, res))) return;
    if (!enforceStorefrontProductScope(req, res, req.body?.productId)) return;
    const finalWhitelist = req.sdkDomainWhitelist as string;

    // Check subscription status
    const plan = getUserPlanContext(user);
    if (plan.inactive) {
      return res.status(403).json({
        valid: false,
        error: 'Subscription expired',
        reason: plan.blockedReason,
        message: plan.blockedReason === 'TRIAL_EXPIRED'
          ? 'Your DrapixAI trial has expired. Please upgrade your plan to continue.'
          : 'Your subscription has expired. Please renew to continue using DrapixAI.'
      });
    }

    // Get usage stats
    const now = new Date();
    const rendersUsed = await getUserMonthlyUsage(prisma, user.id, now);

    res.json({ 
      valid: true,
      plan: plan.normalizedPlan,
      planName: plan.planName,
      rendersUsed,
      quotaRemaining: Math.max(0, plan.quota - rendersUsed),
      quota: plan.quota,
      domain: finalWhitelist,
      selectedPlan: user.selectedPlan || null,
      subscriptionPlan: user.subscriptionPlan || null,
      subscriptionStatus: user.subscriptionStatus || null,
      trialDaysLeft: plan.trialDaysLeft
    });
  } catch (error) {
    console.error('Validation error:', formatLogError(error));
    res.status(500).json({ error: 'Validation failed' });
  }
});

/**
 * POST /sdk/render
 * Submit a new render job
 */
router.post('/render', authMiddleware, requireLegacyAsyncRender, requireTryOnIntake, upload.single('image'), async (req: any, res: any) => {
  if (rejectInvalidMultipartFields(req, res)) return;
  try {
    const apiKey = req.apiKey;
    const user = req.user;
    if (!(await enforceSdkRequestDomain(req, res))) {
      removeUploadedFile(req.file);
      return;
    }
    const { productId } = req.body;

    if (!req.file) {
      return res.status(400).json({ 
        error: 'Image required',
        message: 'Please upload a user photo for the virtual try-on'
      });
    }

    if (!(await isAllowedImageFileContent(req.file))) {
      removeUploadedFile(req.file);
      return res.status(400).json({ error: 'INVALID_IMAGE_CONTENT' });
    }

    if (productId) {
      const mappedGarment = await resolveConfirmedGarmentForProduct(prisma, user.id, String(productId));
      if (!mappedGarment?.cacheKey) {
        return res.status(409).json({
          error: 'GARMENT_MAPPING_NOT_CONFIRMED',
          message: 'This product does not have a confirmed garment mapping yet. Confirm the pairing in the dashboard before using the storefront SDK.'
        });
      }
    }

    const plan = getUserPlanContext(user);
    if (!plan.active) {
      removeUploadedFile(req.file);
      return res.status(403).json({ 
        error: 'No active subscription',
        reason: plan.blockedReason,
        message: plan.blockedReason === 'TRIAL_EXPIRED'
          ? 'Your DrapixAI trial has expired. Please upgrade your plan to continue.'
          : 'Please upgrade your plan to continue using DrapixAI'
      });
    }

    const now = new Date();
    const rendersUsed = await getUserMonthlyUsage(prisma, user.id, now);

    if (rendersUsed >= plan.quota) {
      return res.status(403).json({ 
        error: 'Quota exceeded',
        message: `You've reached your monthly limit of ${plan.quota} renders. Please upgrade your plan.`
      });
    }

    // Read uploaded file
    const fileContent = fs.readFileSync(req.file.path);
    const fileExtension = path.extname(req.file.originalname) || '.jpg';
    
    // Session-based storage
    const inputKey = `session/${crypto.randomUUID()}-${Date.now()}${fileExtension}`;

    // Upload to S3/MinIO
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: inputKey,
        Body: fileContent,
        ContentType: req.file.mimetype,
        ...getStorageEncryptionParams(),
      }));
      console.log('Uploaded encrypted session image');
    } catch (s3Error) {
      if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw s3Error;
      console.log('S3 not available, using local temp storage');
    }

    // Create render job
    const render = await prisma.render.create({ 
      data: { 
        apiKeyId: apiKey.id, 
        status: 'pending', 
        progress: 0, 
        inputUrl: inputKey, 
        productId: productId || 'default' 
      } 
    });

    // Add job to Redis queue
    await redis.lPush('render_queue', JSON.stringify({ 
      jobId: render.id,
      inputKey: inputKey,
      productId: productId || 'default',
      quality: plan.quality,
      userPlan: plan.normalizedPlan,
      userId: user.id,
      apiKeyId: apiKey.id
    }));

    // Update usage count
    await incrementApiKeyUsage(prisma, apiKey.id, now);

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json({ 
      jobId: render.id, 
      status: 'pending',
      quality: plan.quality,
      plan: plan.normalizedPlan,
      planName: plan.planName,
      message: 'Your render job has been queued. Check status using the job ID.'
    });
  } catch (error) {
    console.error('Render error:', formatLogError(error));
    res.status(500).json({ 
      error: 'Render failed',
      message: 'Failed to process your request. Please try again.'
    });
  } finally {
    removeUploadedFile(req.file);
  }
});

/**
 * POST /sdk/tryon
 * Direct binary try-on (person + cloth) via AI service
 */
router.post('/tryon', authMiddleware, requireTryOnIntake, upload.fields([
  { name: 'person_image', maxCount: 1 },
  { name: 'cloth_image', maxCount: 1 }
]), async (req: any, res: any) => {
  if (rejectInvalidMultipartFields(req, res)) return;
  try {
    const apiKey = req.apiKey;
    const user = req.user;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const personFile = files?.person_image?.[0];
    const clothFile = files?.cloth_image?.[0];
    const cleanupTryOnUploadFiles = () => {
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
    };
    if (!requireShopperCredential(req, res)) {
      cleanupTryOnUploadFiles();
      return;
    }
    if (!(await enforceSdkRequestDomain(req, res))) {
      cleanupTryOnUploadFiles();
      return;
    }

    const explicitGarmentId = req.body.garment_id as string | undefined;
    const requestedProductId = req.body.productId as string | undefined;
    const garmentId = explicitGarmentId || requestedProductId;
    const clothCacheKey = req.body.cloth_cache_key as string | undefined;
    if (!enforceStorefrontProductScope(req, res, requestedProductId)) {
      cleanupTryOnUploadFiles();
      return;
    }

    if (!personFile) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({
        error: 'Person image required',
        message: 'Please upload a person image'
      });
    }

    const shopperConsent = String(req.body?.shopper_consent || '').trim().toLowerCase();
    const privacyPolicyVersion = String(req.body?.privacy_policy_version || '').trim();
    if (shopperConsent !== 'true' || privacyPolicyVersion !== SHOPPER_PRIVACY_POLICY_VERSION) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({
        error: 'SHOPPER_CONSENT_REQUIRED',
        message: 'Explicit consent to transient try-on processing is required.',
        privacyPolicyVersion: SHOPPER_PRIVACY_POLICY_VERSION,
      });
    }
    res.setHeader('x-drapixai-media-retention', SHOPPER_MEDIA_RETENTION);
    res.setHeader('x-drapixai-training-use', SHOPPER_TRAINING_USE);

    if (!(await isAllowedImageFileContent(personFile)) || (clothFile && !(await isAllowedImageFileContent(clothFile)))) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({
        error: 'INVALID_IMAGE_CONTENT',
        message: 'Uploaded image content must match a supported JPEG, PNG, or WebP file.'
      });
    }

    if (REQUIRE_GARMENT_CACHE && !garmentId && !clothCacheKey) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({
        error: 'GARMENT_CACHE_REQUIRED',
        message: 'Provide garment_id or cloth_cache_key'
      });
    }

    if (!clothFile && !garmentId && !clothCacheKey) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({
        error: 'Cloth image required',
        message: 'Provide cloth_image or garment_id or cloth_cache_key'
      });
    }

    const now = new Date();
    const plan = getUserPlanContext(user);
    if (!plan.active) {
      cleanupTryOnUploadFiles();
      return res.status(403).json({
        error: 'No active subscription',
        reason: plan.blockedReason,
        message: plan.blockedReason === 'TRIAL_EXPIRED'
          ? 'Your DrapixAI trial has expired. Please upgrade your plan to continue.'
          : 'Please upgrade your plan to continue using DrapixAI'
      });
    }
    const rendersUsed = await getUserMonthlyUsage(prisma, user.id, now);

    if (rendersUsed >= plan.quota) {
      cleanupTryOnUploadFiles();
      return res.status(429).json({ error: 'TRY_ON_LIMIT_EXCEEDED' });
    }

    const garmentType = normalizeGarmentType(req.body.garment_type || 'upper');
    if (!garmentType) {
      cleanupTryOnUploadFiles();
      return res.status(400).json({ error: 'UNSUPPORTED_GARMENT_TYPE' });
    }
    if (garmentType === 'lower' && !ENABLE_LOWER_BODY) {
      cleanupTryOnUploadFiles();
      return res.status(403).json({ error: 'LOWER_BODY_NOT_ENABLED' });
    }

    const requestStartedAt = Date.now();
    const requestId = crypto.randomUUID();

    await appendSecurityAudit(prisma, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'privacy.tryon_consent.accepted',
      targetType: 'tryon_request',
      targetId: requestId,
      requestId,
      ip: req.ip,
      metadata: {
        privacyPolicyVersion,
        productId: requestedProductId || null,
        mediaRetention: SHOPPER_MEDIA_RETENTION,
        modelTrainingUse: SHOPPER_TRAINING_USE,
      },
    });

    try {
      const personBytes = fs.readFileSync(personFile.path);
      let clothBase64 = '';
      let cacheKey = clothCacheKey;
      let garmentRecord: any = null;
      let garmentReviewUrl: string | undefined;
      let originalGarmentBytes: Buffer | null = null;
      const resolvedGarmentId = garmentId ?? '';
      let actualGarmentId = resolvedGarmentId;
      if (garmentId) {
        const garment = explicitGarmentId
          ? await prisma.garment.findUnique({
              where: { userId_garmentId: { userId: user.id, garmentId: resolvedGarmentId } }
            })
          : await resolveConfirmedGarmentForProduct(prisma, user.id, resolvedGarmentId);
        if (!garment) {
          return res.status(409).json({
            error: 'GARMENT_MAPPING_NOT_CONFIRMED',
            message: 'This product does not have a confirmed garment mapping yet. Confirm the product pairing in the dashboard first.'
          });
        }
        garmentRecord = garment;
        actualGarmentId = garment.garmentId;
        const storedGarmentType = normalizeGarmentType(garment.garmentType || 'upper');
        if (storedGarmentType !== garmentType) {
          return res.status(409).json({
            error: 'GARMENT_TYPE_MISMATCH',
            message: `This garment is stored as ${storedGarmentType || 'unknown'}, but the request asked for ${garmentType}.`
          });
        }
        garmentReviewUrl = garment.thumbnailUrl || garment.originalUrl || undefined;
        if (!garment.cacheKey) {
          return res.status(409).json({ error: 'GARMENT_NOT_READY' });
        }
        const approvalRequiredForType = GARMENT_APPROVAL_REQUIRED || (garmentType === 'lower' && LOWER_BODY_ADMIN_REVIEW_REQUIRED);
        if (approvalRequiredForType && garment.status === 'pending') {
          return res.status(403).json({ error: 'GARMENT_PENDING_APPROVAL' });
        }
        if (garment.status === 'rejected') {
          return res.status(403).json({ error: 'GARMENT_REJECTED', reason: garment.rejectedReason || '' });
        }
        cacheKey = garment.cacheKey;
        if (SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON && garment.originalUrl) {
          originalGarmentBytes = await fetchOriginalGarment(garment.originalUrl);
          if (originalGarmentBytes && originalGarmentBytes.length <= MAX_UPLOAD_BYTES) {
            clothBase64 = originalGarmentBytes.toString('base64');
            cacheKey = undefined;
          }
        }
      }
      if (!cacheKey && !clothBase64) {
        if (!clothFile) {
          return res.status(400).json({ error: 'CLOTH_IMAGE_REQUIRED' });
        }
        const clothBytes = fs.readFileSync(clothFile.path);
        clothBase64 = clothBytes.toString('base64');
        garmentReviewUrl = await uploadReviewImage(
          user.id,
          requestId,
          'garment',
          clothBytes,
          clothFile.mimetype || 'image/png'
        );
      }
      const selectedQuality = normalizeSdkQuality(req.body.quality || plan.quality);
      if (!selectedQuality) {
        return res.status(400).json({
          error: 'INVALID_QUALITY',
          message: 'DrapixAI storefront SDK supports Standard quality for production try-on.'
        });
      }

      let finalCacheKey = cacheKey || undefined;
      let garmentCacheStatus = finalCacheKey ? 'verified' : 'direct_upload';
      const sdkOperationalWarnings: string[] = [];
      let generationGarmentSource = finalCacheKey ? 'cache' : 'direct_upload';

      const regenerateCacheFromOriginal = async (reason: string) => {
        if (!garmentRecord?.originalUrl || !actualGarmentId) return false;
        const originalBytes = await fetchOriginalGarment(garmentRecord.originalUrl);
        if (!originalBytes) return false;
        const regenPayload = {
          cloth_image_base64: originalBytes.toString('base64'),
          brand_id: String(user.id),
          garment_id: actualGarmentId,
          category: garmentRecord.category || undefined,
          product_name: garmentRecord.productName || garmentRecord.displayName || undefined,
          garment_type: garmentType,
          admin_bypass: false
        };
        const regenRes = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {
          method: 'POST',
          headers: getAiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(regenPayload)
        });
        if (!regenRes.ok) return false;
        const regen = await regenRes.json() as GarmentPreprocessResponse;
        if (!regen.cache_key || !isExpectedCacheKey(regen.cache_key, garmentType)) return false;
        finalCacheKey = regen.cache_key as string;
        garmentCacheStatus = reason;
        sdkOperationalWarnings.push(reason.toUpperCase());
        await prisma.garment.update({
          where: { userId_garmentId: { userId: user.id, garmentId: actualGarmentId } },
          data: { cacheKey: finalCacheKey, status: garmentType === 'lower' ? garmentRecord.status : 'ready' }
        });
        return true;
      };

      if (finalCacheKey) {
        if (!isExpectedCacheKey(finalCacheKey, garmentType)) {
          const regenerated = await regenerateCacheFromOriginal('garment_cache_regenerated_stale_version');
          if (!regenerated) {
            return res.status(409).json({
              error: 'GARMENT_CACHE_STALE',
              message: `Regenerate this garment cache with ${getExpectedCacheVersion(garmentType)} before storefront try-on.`
            });
          }
        }

        const cacheInfo = await getCacheImageInfo(finalCacheKey, garmentType);
        if (!cacheInfo.ok) {
          const regenerated = await regenerateCacheFromOriginal('garment_cache_regenerated_miss');
          if (!regenerated) {
            return res.status(409).json({
              error: 'GARMENT_CACHE_MISS',
              message: 'The cached garment asset is missing. Regenerate this product cache before storefront try-on.'
            });
          }
        } else if (!cacheInfo.matchesExpectedSize || !cacheInfo.matchesExpectedVersion) {
          const regenerated = await regenerateCacheFromOriginal('garment_cache_regenerated_quality_mismatch');
          if (!regenerated) {
            return res.status(409).json({
              error: 'GARMENT_CACHE_QUALITY_MISMATCH',
              message: `Regenerate this garment cache at ${EXPECTED_GARMENT_CACHE_WIDTH}x${EXPECTED_GARMENT_CACHE_HEIGHT} before storefront try-on.`
            });
          }
        }
      }

      if (
        finalCacheKey
        && SDK_GENERATION_SOURCE === 'original_verified'
        && garmentRecord?.originalUrl
      ) {
        const originalBytes = originalGarmentBytes || await fetchOriginalGarment(garmentRecord.originalUrl);
        if (originalBytes && originalBytes.length <= MAX_UPLOAD_BYTES) {
          clothBase64 = originalBytes.toString('base64');
          generationGarmentSource = 'original_verified_cache_gate';
        } else {
          generationGarmentSource = 'cache';
          sdkOperationalWarnings.push('ORIGINAL_GENERATION_SOURCE_UNAVAILABLE');
        }
      }

      const payload = {
        user_id: String(user.id),
        person_image_base64: personBytes.toString('base64'),
        cloth_image_base64: clothBase64,
        quality: selectedQuality,
        garment_type: garmentType,
        garment_category: garmentType === 'lower'
          ? resolveLowerCategory(garmentRecord?.category || req.body.garment_category, garmentRecord?.productName || garmentRecord?.displayName)
          : undefined,
        cloth_cache_key: generationGarmentSource === 'cache' ? finalCacheKey : undefined
      };

      const slot = await acquireTryOnSlot(user.id);
      if (!slot.ok) {
        const unavailable = slot.reason === 'CONCURRENCY_CONTROL_UNAVAILABLE';
        res.setHeader('Retry-After', '2');
        return res.status(unavailable ? 503 : 429).json({
          error: slot.reason,
          message: slot.reason === 'TENANT_CONCURRENCY_LIMIT'
            ? 'This brand already has the maximum number of active try-ons. Retry shortly.'
            : slot.reason === 'GLOBAL_CAPACITY_BUSY'
              ? 'DrapixAI is processing the current GPU capacity. Retry shortly.'
              : 'Try-on capacity control is temporarily unavailable.',
        });
      }

      let aiResponse: Response;
      try {
        aiResponse = await aiFetch(`${AI_URL}/ai/tryon/base64`, {
          method: 'POST',
          headers: getAiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
      } finally {
        await releaseTryOnSlot(slot.lease);
      }

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        const safeError = sanitizeUpstreamError('AI_TRYON_FAILED', errText);
        return res.status(aiResponse.status).json({
          error: safeError,
          message: 'DrapixAI could not complete this try-on. Please retry with a clearer front-facing photo and a ready garment.',
        });
      }

      const buffer = Buffer.from(await aiResponse.arrayBuffer());
      const contentType = aiResponse.headers.get('content-type') || 'image/png';
      const engine = aiResponse.headers.get('x-drapixai-engine') || '';
      const qualityScore = aiResponse.headers.get('x-drapixai-quality-score') || '';
      const candidateCount = aiResponse.headers.get('x-drapixai-candidate-count') || '';
      const warnings = aiResponse.headers.get('x-drapixai-warnings') || '';
      const processingMs = aiResponse.headers.get('x-drapixai-processing-ms') || '';
      const timingJson = aiResponse.headers.get('x-drapixai-timing-json') || '';
      const qualityJson = aiResponse.headers.get('x-drapixai-quality-json') || '';
      const qualityMode = aiResponse.headers.get('x-drapixai-quality-mode') || selectedQuality;
      const qualityProfile = aiResponse.headers.get('x-drapixai-quality-profile') || '';
      const garmentSource = generationGarmentSource || aiResponse.headers.get('x-drapixai-garment-source') || (finalCacheKey ? 'cache' : 'direct_upload');
      const parsedTimingJson = parseJsonSafe<Record<string, unknown>>(timingJson);
      const parsedQualityJson = parseJsonSafe<Record<string, unknown>>(qualityJson);
      const storedTimingJson = {
        ...(parsedTimingJson || {}),
        ...(parsedQualityJson ? { metrics: parsedQualityJson } : {}),
      };
      const latencyMs = Date.now() - requestStartedAt;
      const combinedWarnings = parseWarningsHeader(warnings);
      const latencyWarnings = latencyMs > TRYON_LATENCY_TARGET_MS
        ? [...combinedWarnings, `LATENCY_OVER_${TRYON_LATENCY_TARGET_MS}MS`]
        : combinedWarnings;
      const storedWarnings = [...latencyWarnings, ...sdkOperationalWarnings];
      const parsedQualityScore = parseNumberHeader(qualityScore);
      const confidenceBadge = getTryOnConfidenceBadge({
        qualityScore: parsedQualityScore,
        latencyMs,
        warnings: latencyWarnings,
        timingJson: storedTimingJson,
      });
      const productAccuracyReport = buildProductAccuracyReport({
        qualityScore: parsedQualityScore,
        latencyMs,
        warnings: latencyWarnings,
        timingJson: storedTimingJson,
      });
      const resultStatus = AUTO_REJECT_BAD_RESULTS && shouldAutoRejectTryOn({
        qualityScore: parsedQualityScore,
        latencyMs,
        warnings: latencyWarnings,
        timingJson: storedTimingJson,
      })
        ? 'rejected'
        : 'generated';

      const tryOnResult = await prisma.tryOnResult.create({
        data: {
          userId: user.id,
          apiKeyId: apiKey.id,
          requestId,
          garmentId: actualGarmentId || undefined,
          productId: requestedProductId || undefined,
          personImageUrl: null,
          garmentImageUrl: garmentReviewUrl,
          resultImageUrl: null,
          engine: engine || 'unknown',
          qualityScore: parsedQualityScore,
          candidateCount: parseNumberHeader(candidateCount) || 1,
          timingJson: Object.keys(storedTimingJson).length > 0 ? storedTimingJson as Prisma.InputJsonValue : undefined,
          processingMs: parseNumberHeader(processingMs),
          latencyMs,
          warnings: storedWarnings,
          status: resultStatus,
          rejectedAt: resultStatus === 'rejected' ? new Date() : undefined,
        }
      });

      await appendSecurityAudit(prisma, {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'privacy.tryon_media.not_retained',
        targetType: 'tryon_result',
        targetId: String(tryOnResult.id),
        requestId,
        ip: req.ip,
        metadata: {
          personImageStored: false,
          resultImageStored: false,
          modelTrainingUse: 'none',
          garmentAssetStored: Boolean(garmentReviewUrl),
        },
      });

      if (resultStatus === 'rejected') {
        return res.status(422).json({
          error: 'TRYON_RESULT_NOT_PUBLISHABLE',
          message: 'DrapixAI could not produce a storefront-safe try-on for this photo and product. Please retry with a clearer front-facing photo.',
          tryOnResultId: tryOnResult.id,
          confidenceBadge,
          qualityScore: parsedQualityScore,
          latencyMs,
          warnings: latencyWarnings,
          productAccuracyReport,
        });
      }

      await incrementApiKeyUsage(prisma, apiKey.id, now);

      res.setHeader('Content-Type', contentType);
      res.setHeader('x-drapixai-tryon-result-id', String(tryOnResult.id));
      if (engine) res.setHeader('x-drapixai-engine', engine);
      if (qualityScore) res.setHeader('x-drapixai-quality-score', qualityScore);
      if (candidateCount) res.setHeader('x-drapixai-candidate-count', candidateCount);
      if (latencyWarnings.length > 0) res.setHeader('x-drapixai-warnings', latencyWarnings.join(','));
      if (processingMs) res.setHeader('x-drapixai-processing-ms', processingMs);
      res.setHeader('x-drapixai-latency-ms', String(latencyMs));
      res.setHeader('x-drapixai-latency-target-ms', String(TRYON_LATENCY_TARGET_MS));
      if (timingJson) res.setHeader('x-drapixai-timing-json', timingJson);
      if (qualityJson) res.setHeader('x-drapixai-quality-json', qualityJson);
      res.setHeader('x-drapixai-confidence-badge', confidenceBadge);
      res.setHeader('x-drapixai-product-accuracy-json', JSON.stringify(productAccuracyReport));
      res.setHeader('x-drapixai-quality-mode', qualityMode);
      if (qualityProfile) res.setHeader('x-drapixai-quality-profile', qualityProfile);
      res.setHeader('x-drapixai-garment-source', garmentSource);
      res.setHeader('x-drapixai-garment-cache-status', garmentCacheStatus);
      res.setHeader('x-drapixai-garment-cache-version', getExpectedCacheVersion(garmentType));
      res.send(buffer);
    } finally {
      cleanupTryOnUploadFiles();
    }
  } catch (error) {
    console.error('Try-on error:', formatLogError(error));
    res.status(500).json({ error: 'Try-on failed' });
  }
});

/**
 * POST /sdk/tryon-feedback
 * Store metadata-only storefront feedback for quality and reliability analytics.
 * Shopper photos and generated previews are never attached or used for training.
 */
router.post('/tryon-feedback', authMiddleware, async (req: any, res: any) => {
  try {
    if (!requireShopperCredential(req, res)) return;
    if (!(await enforceSdkRequestDomain(req, res))) return;
    const user = req.user;
    const tryOnResultId = Number(req.body?.tryOnResultId || req.body?.try_on_result_id || 0);
    if (!tryOnResultId) {
      return res.status(400).json({ error: 'TRYON_RESULT_ID_REQUIRED' });
    }

    const result = await prisma.tryOnResult.findUnique({ where: { id: tryOnResultId } });
    if (!result || !ownsTenantResource(user.id, result.userId)) {
      return res.status(404).json({ error: 'TRYON_RESULT_NOT_FOUND' });
    }
    if (!enforceStorefrontProductScope(req, res, result.productId)) return;

    const feedback = await prisma.tryOnFeedback.create({
      data: {
        tryOnResultId,
        userId: user.id,
        looksReal: typeof req.body?.looksReal === 'boolean' ? req.body.looksReal : undefined,
        bodyChanged: Boolean(req.body?.bodyChanged),
        garmentChanged: Boolean(req.body?.garmentChanged),
        faceChanged: Boolean(req.body?.faceChanged),
        badHands: Boolean(req.body?.badHands),
        badNeck: Boolean(req.body?.badNeck),
        badSleeves: Boolean(req.body?.badSleeves),
        regenerateReason: typeof req.body?.regenerateReason === 'string' ? req.body.regenerateReason : undefined,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      }
    });

    res.json({ ok: true, feedbackId: feedback.id });
  } catch (error) {
    console.error('Try-on feedback error:', formatLogError(error));
    res.status(500).json({ error: 'TRYON_FEEDBACK_FAILED' });
  }
});

/**
 * POST /sdk/garments
 * Upload + preprocess garment, store cache key
 */
router.post('/garments', authMiddleware, requireDashboardProxy, requireTryOnIntake, upload.single('cloth_image'), async (req: any, res: any) => {
  if (rejectInvalidMultipartFields(req, res)) return;
  try {
    const user = req.user;
    const requestedGarmentId = String(req.body.garment_id || req.body.productId || '').trim();
    const requestedCategory = String(req.body.category || '').trim();
    const requestedProductName = String(req.body.product_name || req.body.display_name || '').trim();
    const requestedProfile = String(req.body.garment_profile || '').trim();
    const requestedGarmentType = normalizeGarmentType(req.body.garment_type || 'upper');
    const adminBypass = String(req.body.admin_bypass || '').toLowerCase() === 'true';

    if (!requestedGarmentType) {
      return res.status(400).json({ error: 'UNSUPPORTED_GARMENT_TYPE' });
    }
    if (requestedGarmentType === 'lower') {
      if (!ENABLE_LOWER_BODY) {
        return res.status(403).json({ error: 'LOWER_BODY_NOT_ENABLED', message: getGarmentValidationMessage('LOWER_BODY_NOT_ENABLED') });
      }
      if (!isLowerCategoryAllowed(requestedCategory, requestedProfile)) {
        return res.status(422).json({ error: 'UNSUPPORTED_LOWER_CATEGORY' });
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: 'CLOTH_IMAGE_REQUIRED' });
    }

    if (!(await isAllowedImageFileContent(req.file))) {
      return res.status(400).json({ error: 'INVALID_IMAGE_CONTENT' });
    }

    const fileLabel = path.parse(req.file.originalname || '').name || 'garment';
    const garmentId = requestedGarmentId || buildGarmentAssetId(fileLabel);
    const displayName = humanizeIdentifier(requestedGarmentId || fileLabel);

    const clothBytes = fs.readFileSync(req.file.path);
    const originalHash = crypto.createHash('sha256').update(clothBytes).digest('hex');
    const originalUrl = await uploadOriginalGarment(user.id, garmentId, req.file.path, req.file.mimetype);

    const payload = {
      cloth_image_base64: clothBytes.toString('base64'),
      brand_id: String(user.id),
      garment_id: garmentId,
      category: requestedCategory || undefined,
      product_name: requestedProductName || displayName,
      garment_profile: requestedProfile || undefined,
      garment_type: requestedGarmentType,
      admin_bypass: adminBypass
    };

    const aiResponse = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {
      method: 'POST',
      headers: getAiHeaders({
        'Content-Type': 'application/json',
        ...(adminBypass && ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {})
      }),
      body: JSON.stringify(payload)
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      const error = getGarmentValidationCode(errText || 'AI_SERVICE_ERROR');
      return res.status(aiResponse.status).json({
        error,
        message: getGarmentValidationMessage(error),
      });
    }

    const result = await aiResponse.json() as GarmentPreprocessResponse;
    const cacheKey = result.cache_key as string;
    const normalizedCategory = requestedCategory || result.profile_label || (requestedGarmentType === 'lower' ? 'Lower-Body Garment' : 'Upper-Body Garment');
    const normalizedProductName = requestedProductName || displayName;

    const thumbnailUrl = await uploadThumbnail(user.id, garmentId, Buffer.from(result.image_base64, 'base64'));
    const status = GARMENT_APPROVAL_REQUIRED || (requestedGarmentType === 'lower' && LOWER_BODY_ADMIN_REVIEW_REQUIRED) ? 'pending' : 'ready';
    await prisma.garment.upsert({
      where: { userId_garmentId: { userId: user.id, garmentId } },
      update: {
        cacheKey,
        displayName,
        originalHash,
        originalUrl,
        thumbnailUrl,
        status,
        category: normalizedCategory,
        garmentType: requestedGarmentType,
        productName: normalizedProductName,
      },
      create: {
        userId: user.id,
        garmentId,
        displayName,
        cacheKey,
        originalHash,
        originalUrl,
        thumbnailUrl,
        status,
        category: normalizedCategory,
        garmentType: requestedGarmentType,
        productName: normalizedProductName,
      }
    });
    await recomputeGarmentMatchesForUser(prisma, user.id);

    res.json({
      garmentId,
      displayName,
      cacheKey,
      didProcess: result.did_process,
      reason: result.reason,
      status,
      category: normalizedCategory,
      garmentType: requestedGarmentType,
      supportLevel: result.support_level || 'launch_ready',
      warnings: result.warnings || [],
    });
  } catch (error) {
    console.error('Garment upload error:', formatLogError(error));
    res.status(500).json({ error: 'Garment upload failed' });
  } finally {
    removeUploadedFile(req.file);
  }
});

/**
 * POST /sdk/garments/bulk
 * Bulk upload garments as standalone assets
 */
router.post('/garments/bulk', authMiddleware, requireDashboardProxy, requireTryOnIntake, upload.array('cloth_images', 20), async (req: any, res: any) => {
  if (rejectInvalidMultipartFields(req, res)) return;
  try {
    const user = req.user;
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'FILES_REQUIRED' });
    }

    const results: any[] = [];
    const requestedGarmentType = normalizeGarmentType(req.body?.garment_type || 'upper');
    if (!requestedGarmentType) {
      return res.status(400).json({ error: 'UNSUPPORTED_GARMENT_TYPE' });
    }
    if (requestedGarmentType === 'lower' && !ENABLE_LOWER_BODY) {
      return res.status(403).json({ error: 'LOWER_BODY_NOT_ENABLED', message: getGarmentValidationMessage('LOWER_BODY_NOT_ENABLED') });
    }
    for (const file of files) {
      const fileLabel = path.parse(file.originalname).name;
      if (!fileLabel) {
        results.push({ file: file.originalname, error: 'INVALID_FILENAME' });
        continue;
      }
      if (!(await isAllowedImageFileContent(file))) {
        results.push({ file: file.originalname, error: 'INVALID_IMAGE_CONTENT' });
        continue;
      }
      const garmentId = buildGarmentAssetId(fileLabel);
      const displayName = humanizeIdentifier(fileLabel);
      const clothBytes = fs.readFileSync(file.path);
      const originalHash = crypto.createHash('sha256').update(clothBytes).digest('hex');
      const originalUrl = await uploadOriginalGarment(user.id, garmentId, file.path, file.mimetype);
      const payload = {
        cloth_image_base64: clothBytes.toString('base64'),
        brand_id: String(user.id),
        garment_id: garmentId,
        product_name: displayName,
        garment_type: requestedGarmentType,
        admin_bypass: false
      };
      const aiResponse = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {
        method: 'POST',
        headers: getAiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        const error = getGarmentValidationCode(errText || 'AI_SERVICE_ERROR');
        results.push({
          garmentId,
          error,
          message: getGarmentValidationMessage(error),
        });
        continue;
      }
      const result = await aiResponse.json() as GarmentPreprocessResponse;
      const cacheKey = result.cache_key as string;
      const normalizedCategory = result.profile_label || (requestedGarmentType === 'lower' ? 'Lower-Body Garment' : 'Upper-Body Garment');
      const thumbnailUrl = await uploadThumbnail(user.id, garmentId, Buffer.from(result.image_base64, 'base64'));
      const status = GARMENT_APPROVAL_REQUIRED || (requestedGarmentType === 'lower' && LOWER_BODY_ADMIN_REVIEW_REQUIRED) ? 'pending' : 'ready';
      await prisma.garment.upsert({
        where: { userId_garmentId: { userId: user.id, garmentId } },
        update: {
          cacheKey,
          displayName,
          originalHash,
          originalUrl,
          thumbnailUrl,
          status,
          category: normalizedCategory,
          garmentType: requestedGarmentType,
          productName: displayName,
        },
        create: {
          userId: user.id,
          garmentId,
          displayName,
          cacheKey,
          originalHash,
          originalUrl,
          thumbnailUrl,
          status,
          category: normalizedCategory,
          garmentType: requestedGarmentType,
          productName: displayName,
        }
      });
      results.push({
        garmentId,
        displayName,
        cacheKey,
        status,
        category: normalizedCategory,
        garmentType: requestedGarmentType,
        supportLevel: result.support_level || 'launch_ready',
        warnings: result.warnings || [],
      });
    }

    await recomputeGarmentMatchesForUser(prisma, user.id);

    res.json({ items: results });
  } catch (error) {
    console.error('Garment bulk error:', formatLogError(error));
    res.status(500).json({ error: 'Garment bulk upload failed' });
  } finally {
    const files = req.files as Express.Multer.File[];
    if (files) {
      for (const file of files) {
        removeUploadedFile(file);
      }
    }
  }
});

/**
 * GET /sdk/garments/:garmentId
 * Get cached garment info
 */
router.get('/garments/:garmentId', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.params.garmentId || '').trim();
    if (!garmentId) {
      return res.status(400).json({ error: 'GARMENT_ID_REQUIRED' });
    }
    const garment = await prisma.garment.findUnique({
      where: { userId_garmentId: { userId: user.id, garmentId } }
    });
    if (!garment) {
      return res.status(404).json({ error: 'GARMENT_NOT_FOUND' });
    }
    const match = await prisma.garmentMatch.findUnique({
      where: { userId_garmentId: { userId: user.id, garmentId } }
    });
    res.json({
      garmentId: garment.garmentId,
      displayName: garment.displayName,
      cacheKey: garment.cacheKey,
      status: garment.status,
      productName: garment.productName,
      category: garment.category,
      garmentType: garment.garmentType,
      sourceImageUrl: garment.sourceImageUrl,
      matchStatus: match?.status || 'unmatched',
      suggestedProductId: match?.suggestedProductId || null,
      confirmedProductId: match?.confirmedProductId || null,
      matchConfidence: match?.confidence ?? null,
      matchReason: match?.matchReason || null,
      updatedAt: garment.updatedAt
    });
  } catch (error) {
    console.error('Garment fetch error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to fetch garment' });
  }
});

/**
 * GET /sdk/garments
 * List garments for current user
 */
router.get('/garments', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const items = await listGarmentsWithMatchState(user.id);
    res.json({ items });
  } catch (error) {
    console.error('Garment list error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to list garments' });
  }
});

/**
 * GET /sdk/catalog
 * List discovered catalog products
 */
router.get('/catalog', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const items = await prisma.catalogProduct.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({
      items: items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        garmentType: item.garmentType,
        imageUrl: item.imageUrl,
        status: item.status,
        updatedAt: item.updatedAt,
      }))
    });
  } catch (error) {
    console.error('Catalog list error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to list catalog products' });
  }
});

const syncCatalogHandler = async (req: any, res: any) => {
  try {
    const user = req.user;
    const productIds: string[] = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const rawItems: CatalogSyncInputItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (productIds.length === 0 && rawItems.length === 0) {
      return res.status(400).json({ error: 'PRODUCT_IDS_REQUIRED' });
    }

    const normalizedItems = [
      ...productIds
        .map((pid) => normalizeCatalogItem({ productId: pid, garmentType: 'upper' }))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      ...rawItems
        .map((item) => normalizeCatalogItem(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    ];

    const uniqueItems = Array.from(
      new Map(normalizedItems.map((item) => [item.productId, item])).values()
    );

    const { discovered, skipped } = await upsertCatalogProductsForUser(prisma, user.id, uniqueItems, 'manual_csv');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        catalogLastSyncedAt: new Date(),
        catalogLastSyncStatus: `SYNCED_${discovered.length}_SKIPPED_${skipped.length}`,
      },
    });

    res.json({ items: discovered, skipped });
  } catch (error) {
    console.error('Garment sync error:', formatLogError(error));
    res.status(500).json({ error: 'Garment sync failed' });
  }
};

/**
 * POST /sdk/catalog/sync
 * Discover catalog products for matching
 */
router.post('/catalog/sync', authMiddleware, requireDashboardProxy, syncCatalogHandler);

/**
 * POST /sdk/garments/sync
 * Backward-compatible alias for catalog discovery
 */
router.post('/garments/sync', authMiddleware, requireDashboardProxy, syncCatalogHandler);

/**
 * POST /sdk/matches/:garmentId/confirm
 * Confirm a garment-to-product pairing
 */
router.post('/matches/:garmentId/confirm', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.params.garmentId || '').trim();
    const productId = String(req.body?.productId || '').trim();

    if (!garmentId || !productId) {
      return res.status(400).json({ error: 'GARMENT_AND_PRODUCT_REQUIRED' });
    }

    try {
      const match = await confirmGarmentMatch(prisma, user.id, garmentId, productId);
      return res.json({
        ok: true,
        garmentId,
        productId,
        status: match.status,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MATCH_CONFIRM_FAILED';
      return res.status(code === 'GARMENT_NOT_FOUND' || code === 'PRODUCT_NOT_FOUND' ? 404 : 400).json({ error: code });
    }
  } catch (error) {
    console.error('Match confirm error:', formatLogError(error));
    res.status(500).json({ error: 'MATCH_CONFIRM_FAILED' });
  }
});

/**
 * DELETE /sdk/matches/:garmentId/confirm
 * Clear a confirmed garment-to-product pairing
 */
router.delete('/matches/:garmentId/confirm', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.params.garmentId || '').trim();
    if (!garmentId) {
      return res.status(400).json({ error: 'GARMENT_ID_REQUIRED' });
    }

    await clearConfirmedGarmentMatch(prisma, user.id, garmentId);
    res.json({ ok: true, garmentId });
  } catch (error) {
    console.error('Match clear error:', formatLogError(error));
    res.status(500).json({ error: 'MATCH_CLEAR_FAILED' });
  }
});

/**
 * GET /sdk/garments/:garmentId/image
 * Proxy cached garment image
 */
router.get('/garments/:garmentId/image', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.params.garmentId || '').trim();
    if (!garmentId) return res.status(400).json({ error: 'GARMENT_ID_REQUIRED' });
    const garment = await prisma.garment.findUnique({
      where: { userId_garmentId: { userId: user.id, garmentId } }
    });
    if (!garment || !garment.cacheKey) {
      return res.status(404).json({ error: 'GARMENT_NOT_READY' });
    }
    const aiRes = await aiFetch(`${AI_URL}/ai/garment/cache?cache_key=${encodeURIComponent(garment.cacheKey)}`, {
      headers: getAiHeaders()
    });
    if (!aiRes.ok) {
      return res.status(404).json({ error: 'GARMENT_CACHE_MISS' });
    }
    const buffer = Buffer.from(await aiRes.arrayBuffer());
    res.setHeader('Content-Type', aiRes.headers.get('content-type') || 'image/png');
    res.send(buffer);
  } catch (error) {
    console.error('Garment image error:', formatLogError(error));
    res.status(500).json({ error: 'Garment image fetch failed' });
  }
});

/**
 * GET /sdk/garments/:garmentId/thumbnail
 * Proxy garment thumbnail
 */
router.get('/garments/:garmentId/thumbnail', authMiddleware, requireDashboardProxy, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.params.garmentId || '').trim();
    if (!garmentId) return res.status(400).json({ error: 'GARMENT_ID_REQUIRED' });
    const garment = await prisma.garment.findUnique({
      where: { userId_garmentId: { userId: user.id, garmentId } }
    });
    if (!garment || !garment.thumbnailUrl) {
      return res.status(404).json({ error: 'THUMBNAIL_NOT_READY' });
    }
    if (garment.thumbnailUrl.startsWith('local:')) {
      const buffer = readLocalUploadFile(garment.thumbnailUrl);
      if (!buffer) return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
      res.setHeader('Content-Type', 'image/png');
      return res.send(buffer);
    }
    if (garment.thumbnailUrl.startsWith('s3://')) {
      const rest = garment.thumbnailUrl.replace('s3://', '');
      const [bucket, ...keyParts] = rest.split('/');
      const key = keyParts.join('/');
      const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of resp.Body) chunks.push(chunk);
      res.setHeader('Content-Type', 'image/png');
      return res.send(Buffer.concat(chunks));
    }
    return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
  } catch (error) {
    console.error('Garment thumbnail error:', formatLogError(error));
    res.status(500).json({ error: 'Garment thumbnail fetch failed' });
  }
});

/**
 * GET /sdk/status/:jobId
 * Check render job status
 */
router.get('/status/:jobId', authMiddleware, requireLegacyAsyncRender, async (req: any, res: any) => {
  try {
    if (!(await enforceSdkRequestDomain(req, res))) return;
    const jobId = parseInt(req.params.jobId);
    const apiKey = req.apiKey;

    const render = await prisma.render.findUnique({ 
      where: { id: jobId } 
    });

    if (!render) {
      return res.status(404).json({ 
        error: 'Job not found',
        message: 'No render job found with this ID'
      });
    }

    if (render.apiKeyId !== apiKey.id) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'This job does not belong to your API key'
      });
    }

    if (render.status === 'complete') {
      res.json({ 
        status: 'complete', 
        progress: 100,
        outputUrl: render.outputUrl,
        message: 'Your virtual try-on is ready!'
      });
    } else if (render.status === 'failed') {
      res.json({ 
        status: 'failed', 
        progress: render.progress,
        error: render.error || 'Processing failed',
        message: 'Something went wrong. Please try again.'
      });
    } else {
      res.json({ 
        status: render.status, 
        progress: render.progress,
        message: 'Your image is being processed...'
      });
    }
  } catch (error) {
    console.error('Status check error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/**
 * GET /sdk/result/:jobId
 * Get the final rendered image
 */
router.get('/result/:jobId', authMiddleware, requireLegacyAsyncRender, async (req: any, res: any) => {
  try {
    if (!(await enforceSdkRequestDomain(req, res))) return;
    const jobId = parseInt(req.params.jobId);
    const apiKey = req.apiKey;
    const user = req.user;

    const render = await prisma.render.findUnique({ 
      where: { id: jobId } 
    });

    if (!render) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (render.apiKeyId !== apiKey.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (render.status !== 'complete') {
      return res.status(400).json({ 
        error: 'Job not complete',
        message: 'Your image is still being processed'
      });
    }

    // Apply post-processing policy by active plan.
    if (render.outputUrl && (render.outputUrl.startsWith('session/') || render.outputUrl.startsWith('outputs/'))) {
      try {
        const watermarkedUrl = await processWithWatermark(
          render.outputUrl,
          getUserPlanContext(user).normalizedPlan
        );
        
        await prisma.render.update({
          where: { id: jobId },
          data: { outputUrl: watermarkedUrl }
        });
        
        res.json({ 
          status: 'complete',
          url: watermarkedUrl
        });
      } catch (watermarkError) {
        console.error('Watermark error:', formatLogError(watermarkError));
        res.json({ 
          status: 'complete',
          url: render.outputUrl
        });
      }
    } else {
      res.json({ 
        status: 'complete',
        url: render.outputUrl
      });
    }
  } catch (error) {
    console.error('Result error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to get result' });
  }
});

/**
 * DELETE /sdk/job/:jobId
 * Cancel a pending job
 */
router.delete('/job/:jobId', authMiddleware, requireLegacyAsyncRender, async (req: any, res: any) => {
  try {
    if (!(await enforceSdkRequestDomain(req, res))) return;
    const jobId = parseInt(req.params.jobId);
    const apiKey = req.apiKey;

    const render = await prisma.render.findUnique({ 
      where: { id: jobId } 
    });

    if (!render) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (render.apiKeyId !== apiKey.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (render.status !== 'pending') {
      return res.status(400).json({ 
        error: 'Cannot cancel',
        message: 'Only pending jobs can be cancelled'
      });
    }

    await prisma.render.update({
      where: { id: jobId },
      data: { status: 'cancelled' }
    });

    res.json({ 
      success: true,
      message: 'Job has been cancelled'
    });
  } catch (error) {
    console.error('Cancel job error:', formatLogError(error));
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

export default router;
