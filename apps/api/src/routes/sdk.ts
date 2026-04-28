/**
 * SDK Routes for DrapixAI Virtual Try-On API
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { processWithWatermark } from '../services/watermark';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { CatalogSyncInputItem, isSupportedUpperBodyItem, normalizeCatalogItem } from '../lib/catalog-feed';
import {
  getPlanName,
  getPlanQuality,
  getPlanQuota,
  hasActivePlanAccess,
  isInactivePlan,
  normalizePlanKey,
} from '../lib/plans';

const router = Router();
const prisma = new PrismaClient();
type GarmentPreprocessResponse = {
  cache_key: string;
  image_base64: string;
  did_process: boolean;
  reason: string;
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
    default:
      return 'Garment upload failed validation. Use one isolated upper-body garment on a clean background.';
  }
};

// Initialize Redis client
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.connect().catch((error) => {
  console.error('Redis connection error:', error);
});

// Initialize S3 client (MinIO)
const s3 = createStorageClient();
const BUCKET = STORAGE_BUCKET;
const SINGLE_DOMAIN_REQUIRED = true;
const MAX_UPLOAD_BYTES = Number(process.env.DRAPIXAI_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith('image/'));
  }
});
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
const AI_URL = process.env.DRAPIXAI_AI_URL || 'http://localhost:8080';
const ADMIN_TOKEN = process.env.DRAPIXAI_ADMIN_TOKEN || '';
const REQUIRE_GARMENT_CACHE = (process.env.DRAPIXAI_REQUIRE_GARMENT_CACHE || '1') === '1';
const GARMENT_APPROVAL_REQUIRED = (process.env.DRAPIXAI_GARMENT_APPROVAL_REQUIRED || '0') === '1';

const getUserPlanContext = (planType: string | null | undefined) => {
  const normalizedPlan = normalizePlanKey(planType);
  return {
    normalizedPlan,
    planName: getPlanName(normalizedPlan),
    quota: getPlanQuota(normalizedPlan),
    quality: getPlanQuality(normalizedPlan),
    active: hasActivePlanAccess(normalizedPlan),
    inactive: isInactivePlan(normalizedPlan),
  };
};

const findSyncedGarment = async (userId: number, garmentId: string) => {
  return prisma.garment.findUnique({
    where: { userId_garmentId: { userId, garmentId } }
  });
};

const uploadOriginalGarment = async (
  userId: number,
  garmentId: string,
  filePath: string,
  mime: string
): Promise<string> => {
  const fileContent = fs.readFileSync(filePath);
  const fileExtension = path.extname(filePath) || '.png';
  const key = `garments/originals/${userId}/${garmentId}/${uuidv4()}${fileExtension}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: mime
    }));
    return `s3://${BUCKET}/${key}`;
  } catch {
    const localDir = path.join('uploads', 'garments', String(userId), garmentId);
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, `${uuidv4()}${fileExtension}`);
    fs.writeFileSync(localPath, fileContent);
    return `local:${localPath}`;
  }
};

const fetchOriginalGarment = async (originalUrl: string): Promise<Buffer | null> => {
  if (originalUrl.startsWith('local:')) {
    const localPath = originalUrl.replace('local:', '');
    if (!fs.existsSync(localPath)) return null;
    return fs.readFileSync(localPath);
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
  const key = `garments/thumbs/${userId}/${garmentId}/${uuidv4()}.png`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: thumb,
      ContentType: 'image/png'
    }));
    return `s3://${BUCKET}/${key}`;
  } catch {
    const localDir = path.join('uploads', 'garments', String(userId), garmentId, 'thumbs');
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, `${uuidv4()}.png`);
    fs.writeFileSync(localPath, thumb);
    return `local:${localPath}`;
  }
};

/**
 * Authentication Middleware
 */
const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    const apiKeyHeader = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKeyHeader) {
      return res.status(401).json({ 
        error: 'API key required',
        message: 'Please provide your API key in the Authorization header'
      });
    }

    // Find all active API keys
    const keys = await prisma.apiKey.findMany({ 
      where: { isActive: true },
      include: { user: true }
    });
    
    let validKey: any = null;
    let validUser: any = null;
    
    for (const key of keys) {
      if (await bcrypt.compare(apiKeyHeader, key.keyHash)) {
        validKey = key;
        validUser = key.user;
        break;
      }
    }
    
    if (!validKey || !validUser) {
      return res.status(401).json({ 
        error: 'Invalid API key',
        message: 'The provided API key is invalid or has been revoked'
      });
    }
    
    req.apiKey = validKey;
    req.user = validUser;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
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
  if (domainWhitelist === '*') {
    const updated = await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { domainWhitelist: normalizeDomain(current) }
    });
    return updated.domainWhitelist;
  }
  return domainWhitelist;
};

const incrementDailyUsage = async (apiKeyId: number) => {
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await prisma.usageDaily.upsert({
    where: { apiKeyId_date: { apiKeyId, date: utcDate } },
    update: { count: { increment: 1 } },
    create: { apiKeyId, date: utcDate, count: 1 }
  });
};

/**
 * POST /sdk/validate
 * Validate API key and domain
 */
router.post('/validate', authMiddleware, async (req: any, res: any) => {
  try {
    const { domain } = req.body;
    const apiKey = req.apiKey;
    const user = req.user;

    // Check domain whitelist
    const currentDomain = domain || getRequestDomain(req);
    const finalWhitelist = await enforceSingleDomain(apiKey.id, currentDomain, apiKey.domainWhitelist);
    if (SINGLE_DOMAIN_REQUIRED && !isDomainAllowed(finalWhitelist, currentDomain)) {
      return res.status(403).json({ 
        valid: false, 
        error: 'Domain not allowed',
        message: `This API key is not authorized for domain: ${currentDomain || 'unknown'}`
      });
    }

    // Check subscription status
    const plan = getUserPlanContext(user.planType);
    if (plan.inactive) {
      return res.status(403).json({ 
        valid: false, 
        error: 'Subscription expired',
        message: 'Your subscription has expired. Please renew to continue using DrapixAI.'
      });
    }

    // Get usage stats
    const now = new Date();
    const usage = await prisma.usage.findFirst({ 
      where: { 
        apiKeyId: apiKey.id, 
        month: now.getMonth() + 1, 
        year: now.getFullYear() 
      } 
    });

    res.json({ 
      valid: true,
      plan: plan.normalizedPlan,
      planName: plan.planName,
      rendersUsed: usage?.renderCount || 0,
      quotaRemaining: Math.max(0, plan.quota - (usage?.renderCount || 0)),
      quota: plan.quota,
      domain: finalWhitelist,
      selectedPlan: user.selectedPlan || null,
      subscriptionPlan: user.subscriptionPlan || null,
      subscriptionStatus: user.subscriptionStatus || null,
      trialDaysLeft: plan.normalizedPlan === 'trial' && user.trialExpiresAt 
        ? Math.max(0, Math.ceil((user.trialExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

/**
 * POST /sdk/render
 * Submit a new render job
 */
router.post('/render', authMiddleware, upload.single('image'), async (req: any, res: any) => {
  try {
    const apiKey = req.apiKey;
    const user = req.user;
    const requestDomain = getRequestDomain(req);
    const finalWhitelist = await enforceSingleDomain(apiKey.id, requestDomain, apiKey.domainWhitelist);

    if (SINGLE_DOMAIN_REQUIRED && !isDomainAllowed(finalWhitelist, requestDomain)) {
      return res.status(403).json({
        error: 'Domain not allowed',
        message: `This API key is not authorized for domain: ${requestDomain || 'unknown'}`
      });
    }
    const { productId } = req.body;

    if (!req.file) {
      return res.status(400).json({ 
        error: 'Image required',
        message: 'Please upload a user photo for the virtual try-on'
      });
    }

    const plan = getUserPlanContext(user.planType);
    if (!plan.active) {
      return res.status(403).json({ 
        error: 'No active subscription',
        message: 'Please upgrade your plan to continue using DrapixAI'
      });
    }

    const now = new Date();
    let usage = await prisma.usage.findFirst({ 
      where: { 
        apiKeyId: apiKey.id, 
        month: now.getMonth() + 1, 
        year: now.getFullYear() 
      } 
    });

    if (usage && usage.renderCount >= plan.quota) {
      return res.status(403).json({ 
        error: 'Quota exceeded',
        message: `You've reached your monthly limit of ${plan.quota} renders. Please upgrade your plan.`
      });
    }

    // Read uploaded file
    const fileContent = fs.readFileSync(req.file.path);
    const fileExtension = path.extname(req.file.originalname) || '.jpg';
    
    // Session-based storage
    const inputKey = `session/${uuidv4()}-${Date.now()}${fileExtension}`;

    // Upload to S3/MinIO
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: inputKey,
        Body: fileContent,
        ContentType: req.file.mimetype
      }));
      console.log(`Uploaded session image to ${inputKey}`);
    } catch (s3Error) {
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
    if (usage) {
      await prisma.usage.update({ 
        where: { id: usage.id }, 
        data: { renderCount: { increment: 1 } } 
      });
    } else {
      await prisma.usage.create({ 
        data: { 
          apiKeyId: apiKey.id, 
          renderCount: 1, 
          month: now.getMonth() + 1, 
          year: now.getFullYear() 
        } 
      });
    }
    await incrementDailyUsage(apiKey.id);

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
    console.error('Render error:', error);
    res.status(500).json({ 
      error: 'Render failed',
      message: 'Failed to process your request. Please try again.'
    });
  }
});

/**
 * POST /sdk/tryon
 * Direct binary try-on (person + cloth) via AI service
 */
router.post('/tryon', authMiddleware, upload.fields([
  { name: 'person_image', maxCount: 1 },
  { name: 'cloth_image', maxCount: 1 }
]), async (req: any, res: any) => {
  try {
    const apiKey = req.apiKey;
    const user = req.user;
    const requestDomain = getRequestDomain(req);
    const finalWhitelist = await enforceSingleDomain(apiKey.id, requestDomain, apiKey.domainWhitelist);

    if (SINGLE_DOMAIN_REQUIRED && !isDomainAllowed(finalWhitelist, requestDomain)) {
      return res.status(403).json({
        error: 'Domain not allowed',
        message: `This API key is not authorized for domain: ${requestDomain || 'unknown'}`
      });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const personFile = files?.person_image?.[0];
    const clothFile = files?.cloth_image?.[0];
    const garmentId = (req.body.garment_id as string | undefined) || (req.body.productId as string | undefined);
    const clothCacheKey = req.body.cloth_cache_key as string | undefined;

    if (!personFile) {
      return res.status(400).json({
        error: 'Person image required',
        message: 'Please upload a person image'
      });
    }

    if (REQUIRE_GARMENT_CACHE && !garmentId && !clothCacheKey) {
      return res.status(400).json({
        error: 'GARMENT_CACHE_REQUIRED',
        message: 'Provide garment_id or cloth_cache_key'
      });
    }

    if (!clothFile && !garmentId && !clothCacheKey) {
      return res.status(400).json({
        error: 'Cloth image required',
        message: 'Provide cloth_image or garment_id or cloth_cache_key'
      });
    }

    const now = new Date();
    const plan = getUserPlanContext(user.planType);
    if (!plan.active) {
      return res.status(403).json({
        error: 'No active subscription',
        message: 'Please upgrade your plan to continue using DrapixAI'
      });
    }
    let usage = await prisma.usage.findFirst({
      where: {
        apiKeyId: apiKey.id,
        month: now.getMonth() + 1,
        year: now.getFullYear()
      }
    });

    if (usage && usage.renderCount >= plan.quota) {
      return res.status(429).json({ error: 'TRY_ON_LIMIT_EXCEEDED' });
    }

    const garmentType = String(req.body.garment_type || 'upper').toLowerCase();
    if (garmentType !== 'upper') {
      return res.status(400).json({ error: 'UPPER_BODY_ONLY' });
    }

    try {
      const personBytes = fs.readFileSync(personFile.path);
      let clothBase64 = '';
      let cacheKey = clothCacheKey;
      let garmentRecord: any = null;
      const resolvedGarmentId = garmentId ?? '';
      if (garmentId) {
        const garment = await prisma.garment.findUnique({
          where: { userId_garmentId: { userId: user.id, garmentId: resolvedGarmentId } }
        });
        if (!garment) {
          return res.status(404).json({ error: 'GARMENT_NOT_FOUND' });
        }
        garmentRecord = garment;
        if (!garment.cacheKey) {
          return res.status(409).json({ error: 'GARMENT_NOT_READY' });
        }
        if (GARMENT_APPROVAL_REQUIRED && garment.status === 'pending') {
          return res.status(403).json({ error: 'GARMENT_PENDING_APPROVAL' });
        }
        if (GARMENT_APPROVAL_REQUIRED && garment.status === 'rejected') {
          return res.status(403).json({ error: 'GARMENT_REJECTED', reason: garment.rejectedReason || '' });
        }
        cacheKey = garment.cacheKey;
      }
      if (!cacheKey) {
        if (!clothFile) {
          return res.status(400).json({ error: 'CLOTH_IMAGE_REQUIRED' });
        }
        const clothBytes = fs.readFileSync(clothFile.path);
        clothBase64 = clothBytes.toString('base64');
      }
      const selectedQuality = req.body.quality || plan.quality;

      const payload = {
        user_id: String(user.id),
        person_image_base64: personBytes.toString('base64'),
        cloth_image_base64: clothBase64,
        quality: selectedQuality,
        garment_type: garmentType,
        cloth_cache_key: cacheKey || undefined
      };

      let finalCacheKey = cacheKey || undefined;
      if (finalCacheKey) {
        const cacheCheck = await fetch(`${AI_URL}/ai/garment/cache?cache_key=${encodeURIComponent(finalCacheKey)}`);
        if (!cacheCheck.ok && garmentRecord?.originalUrl) {
          const originalBytes = await fetchOriginalGarment(garmentRecord.originalUrl);
          if (originalBytes) {
            const regenPayload = {
              cloth_image_base64: originalBytes.toString('base64'),
              brand_id: String(user.id),
              garment_id: garmentId,
              admin_bypass: false
            };
            const regenRes = await fetch(`${AI_URL}/ai/garment/preprocess/base64`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(regenPayload)
            });
            if (regenRes.ok && resolvedGarmentId) {
              const regen = await regenRes.json() as GarmentPreprocessResponse;
              finalCacheKey = regen.cache_key as string;
              await prisma.garment.update({
                where: { userId_garmentId: { userId: user.id, garmentId: resolvedGarmentId } },
                data: { cacheKey: finalCacheKey, status: 'ready' }
              });
            }
          }
        }
      }

      const aiResponse = await fetch(`${AI_URL}/ai/tryon/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, cloth_cache_key: finalCacheKey })
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        return res.status(aiResponse.status).json({ error: errText || 'AI service error' });
      }

      if (usage) {
        await prisma.usage.update({
          where: { id: usage.id },
          data: { renderCount: { increment: 1 } }
        });
      } else {
        await prisma.usage.create({
          data: {
            apiKeyId: apiKey.id,
            renderCount: 1,
            month: now.getMonth() + 1,
            year: now.getFullYear()
          }
        });
      }
      await incrementDailyUsage(apiKey.id);

      const buffer = Buffer.from(await aiResponse.arrayBuffer());
      const contentType = aiResponse.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', contentType);
      res.send(buffer);
    } finally {
      if (personFile?.path && fs.existsSync(personFile.path)) fs.unlinkSync(personFile.path);
      if (clothFile?.path && fs.existsSync(clothFile.path)) fs.unlinkSync(clothFile.path);
    }
  } catch (error) {
    console.error('Try-on error:', error);
    res.status(500).json({ error: 'Try-on failed' });
  }
});

/**
 * POST /sdk/garments
 * Upload + preprocess garment, store cache key
 */
router.post('/garments', authMiddleware, upload.single('cloth_image'), async (req: any, res: any) => {
  try {
    const user = req.user;
    const garmentId = String(req.body.garment_id || req.body.productId || '').trim();
    const adminBypass = String(req.body.admin_bypass || '').toLowerCase() === 'true';

    if (!garmentId) {
      return res.status(400).json({ error: 'GARMENT_ID_REQUIRED' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'CLOTH_IMAGE_REQUIRED' });
    }

    const syncedGarment = await findSyncedGarment(user.id, garmentId);
    if (!syncedGarment) {
      return res.status(409).json({
        error: 'GARMENT_NOT_SYNCED',
        message: 'Sync upper-body product IDs first, then upload matching garment images.'
      });
    }

    const clothBytes = fs.readFileSync(req.file.path);
    const originalHash = crypto.createHash('sha256').update(clothBytes).digest('hex');
    const originalUrl = await uploadOriginalGarment(user.id, garmentId, req.file.path, req.file.mimetype);

    const payload = {
      cloth_image_base64: clothBytes.toString('base64'),
      brand_id: String(user.id),
      garment_id: garmentId,
      admin_bypass: adminBypass
    };

    const aiResponse = await fetch(`${AI_URL}/ai/garment/preprocess/base64`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminBypass && ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {})
      },
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

    const thumbnailUrl = await uploadThumbnail(user.id, garmentId, Buffer.from(result.image_base64, 'base64'));
    const status = GARMENT_APPROVAL_REQUIRED ? 'pending' : 'ready';
    await prisma.garment.upsert({
      where: { userId_garmentId: { userId: user.id, garmentId } },
      update: { cacheKey, originalHash, originalUrl, thumbnailUrl, status },
      create: { userId: user.id, garmentId, cacheKey, originalHash, originalUrl, thumbnailUrl, status }
    });

    res.json({
      garmentId,
      cacheKey,
      didProcess: result.did_process,
      reason: result.reason,
      status
    });
  } catch (error) {
    console.error('Garment upload error:', error);
    res.status(500).json({ error: 'Garment upload failed' });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

/**
 * POST /sdk/garments/bulk
 * Bulk upload garments using filename as garmentId
 */
router.post('/garments/bulk', authMiddleware, upload.array('cloth_images', 20), async (req: any, res: any) => {
  try {
    const user = req.user;
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'FILES_REQUIRED' });
    }

    const results: any[] = [];
    for (const file of files) {
      const garmentId = path.parse(file.originalname).name;
      if (!garmentId) {
        results.push({ file: file.originalname, error: 'INVALID_FILENAME' });
        continue;
      }
      const syncedGarment = await findSyncedGarment(user.id, garmentId);
      if (!syncedGarment) {
        results.push({
          garmentId,
          error: 'GARMENT_NOT_SYNCED',
          message: 'Sync upper-body product IDs first, then upload files whose filenames match those IDs.'
        });
        continue;
      }
      const clothBytes = fs.readFileSync(file.path);
      const originalHash = crypto.createHash('sha256').update(clothBytes).digest('hex');
      const originalUrl = await uploadOriginalGarment(user.id, garmentId, file.path, file.mimetype);
      const payload = {
        cloth_image_base64: clothBytes.toString('base64'),
        brand_id: String(user.id),
        garment_id: garmentId,
        admin_bypass: false
      };
      const aiResponse = await fetch(`${AI_URL}/ai/garment/preprocess/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const thumbnailUrl = await uploadThumbnail(user.id, garmentId, Buffer.from(result.image_base64, 'base64'));
      const status = GARMENT_APPROVAL_REQUIRED ? 'pending' : 'ready';
      await prisma.garment.upsert({
        where: { userId_garmentId: { userId: user.id, garmentId } },
        update: { cacheKey, originalHash, originalUrl, thumbnailUrl, status },
        create: { userId: user.id, garmentId, cacheKey, originalHash, originalUrl, thumbnailUrl, status }
      });
      results.push({ garmentId, cacheKey, status });
    }

    res.json({ items: results });
  } catch (error) {
    console.error('Garment bulk error:', error);
    res.status(500).json({ error: 'Garment bulk upload failed' });
  } finally {
    const files = req.files as Express.Multer.File[];
    if (files) {
      for (const file of files) {
        if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }
  }
});

/**
 * GET /sdk/garments/:garmentId
 * Get cached garment info
 */
router.get('/garments/:garmentId', authMiddleware, async (req: any, res: any) => {
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
    res.json({
      garmentId: garment.garmentId,
      cacheKey: garment.cacheKey,
      status: garment.status,
      productName: garment.productName,
      category: garment.category,
      garmentType: garment.garmentType,
      sourceImageUrl: garment.sourceImageUrl,
      updatedAt: garment.updatedAt
    });
  } catch (error) {
    console.error('Garment fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch garment' });
  }
});

/**
 * GET /sdk/garments
 * List garments for current user
 */
router.get('/garments', authMiddleware, async (req: any, res: any) => {
  try {
    const user = req.user;
    const garments = await prisma.garment.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({
      items: garments.map((g) => ({
        garmentId: g.garmentId,
        cacheKey: g.cacheKey,
        status: g.status,
        productName: g.productName,
        category: g.category,
        garmentType: g.garmentType,
        sourceImageUrl: g.sourceImageUrl,
        updatedAt: g.updatedAt
      }))
    });
  } catch (error) {
    console.error('Garment list error:', error);
    res.status(500).json({ error: 'Failed to list garments' });
  }
});

/**
 * POST /sdk/garments/sync
 * Create stubs for product catalog IDs
 */
router.post('/garments/sync', authMiddleware, async (req: any, res: any) => {
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

    const synced: Array<{ garmentId: string; status: string }> = [];
    const skipped: Array<{ productId: string; reason: string }> = [];

    for (const item of uniqueItems) {
      if (!productIds.includes(item.productId) && !isSupportedUpperBodyItem(item)) {
        skipped.push({ productId: item.productId, reason: 'NOT_UPPER_BODY' });
        continue;
      }

      const record = await prisma.garment.upsert({
        where: { userId_garmentId: { userId: user.id, garmentId: item.productId } },
        update: {
          productName: item.productName,
          category: item.category,
          garmentType: item.garmentType || 'upper',
          sourceImageUrl: item.imageUrl,
        },
        create: {
          userId: user.id,
          garmentId: item.productId,
          cacheKey: null,
          originalHash: '',
          status: 'missing',
          productName: item.productName,
          category: item.category,
          garmentType: item.garmentType || 'upper',
          sourceImageUrl: item.imageUrl,
        }
      });

      synced.push({
        garmentId: record.garmentId,
        status: record.status
      });
    }

    res.json({ items: synced, skipped });
  } catch (error) {
    console.error('Garment sync error:', error);
    res.status(500).json({ error: 'Garment sync failed' });
  }
});

/**
 * GET /sdk/garments/:garmentId/image
 * Proxy cached garment image
 */
router.get('/garments/:garmentId/image', authMiddleware, async (req: any, res: any) => {
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
    const aiRes = await fetch(`${AI_URL}/ai/garment/cache?cache_key=${encodeURIComponent(garment.cacheKey)}`);
    if (!aiRes.ok) {
      return res.status(404).json({ error: 'GARMENT_CACHE_MISS' });
    }
    const buffer = Buffer.from(await aiRes.arrayBuffer());
    res.setHeader('Content-Type', aiRes.headers.get('content-type') || 'image/png');
    res.send(buffer);
  } catch (error) {
    console.error('Garment image error:', error);
    res.status(500).json({ error: 'Garment image fetch failed' });
  }
});

/**
 * GET /sdk/garments/:garmentId/thumbnail
 * Proxy garment thumbnail
 */
router.get('/garments/:garmentId/thumbnail', authMiddleware, async (req: any, res: any) => {
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
      const localPath = garment.thumbnailUrl.replace('local:', '');
      if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'THUMBNAIL_NOT_FOUND' });
      const buffer = fs.readFileSync(localPath);
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
    console.error('Garment thumbnail error:', error);
    res.status(500).json({ error: 'Garment thumbnail fetch failed' });
  }
});

/**
 * GET /sdk/status/:jobId
 * Check render job status
 */
router.get('/status/:jobId', authMiddleware, async (req: any, res: any) => {
  try {
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
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/**
 * GET /sdk/result/:jobId
 * Get the final rendered image
 */
router.get('/result/:jobId', authMiddleware, async (req: any, res: any) => {
  try {
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
          normalizePlanKey(user.planType)
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
        console.error('Watermark error:', watermarkError);
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
    console.error('Result error:', error);
    res.status(500).json({ error: 'Failed to get result' });
  }
});

/**
 * DELETE /sdk/job/:jobId
 * Cancel a pending job
 */
router.delete('/job/:jobId', authMiddleware, async (req: any, res: any) => {
  try {
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
    console.error('Cancel job error:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

export default router;
