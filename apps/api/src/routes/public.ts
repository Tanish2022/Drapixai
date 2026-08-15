import { Router } from 'express';
import { aiFetch } from '../lib/ai-client';
import { Prisma, PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import crypto from 'crypto';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { appendSecurityAudit } from '../lib/audit-log';
import { formatLogError, getUploadRoot, isAllowedImageFileContent, isAllowedImageUpload, removeUploadedFile, sanitizeUpstreamError } from '../lib/security';
import {
  SHOPPER_MEDIA_RETENTION,
  SHOPPER_PRIVACY_POLICY_VERSION,
  SHOPPER_TRAINING_USE,
} from '../lib/privacy';
import { shouldAutoRejectTryOn } from '../lib/tryon-quality';
import { validateMultipartFields } from '../lib/input-validation';
import { acquireTryOnSlot, releaseTryOnSlot } from '../lib/tryon-concurrency';
import { requireTryOnIntake } from '../lib/tryon-intake';

const router = Router();
const prisma = new PrismaClient();
const MAX_UPLOAD_BYTES = Number(process.env.DRAPIXAI_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const AI_URL = process.env.DRAPIXAI_AI_URL || 'http://localhost:8080';
const AI_SERVICE_TOKEN = process.env.DRAPIXAI_AI_SERVICE_TOKEN || '';
const getAiHeaders = (headers: Record<string, string> = {}) => ({
  ...headers,
  ...(AI_SERVICE_TOKEN ? { 'x-drapixai-service-token': AI_SERVICE_TOKEN } : {}),
});
const PUBLIC_WEBSITE_EVENTS = new Set(['page_view', 'cta_click', 'trial_signup', 'user_login']);
const PUBLIC_GARMENT_VALIDATION_CODES = new Set([
  'MODEL_WORN_GARMENT',
  'GARMENT_TOO_LONG',
  'LOW_RESOLUTION',
  'IMAGE_BLURRY',
  'GARMENT_CATEGORY_UNSUPPORTED',
]);

const sanitizeReferrer = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    return `${parsed.origin}${parsed.pathname}`.slice(0, 255);
  } catch {
    return null;
  }
};

const sanitizeEventMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 10)
      .filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
      .map(([key, item]) => [
        key.slice(0, 40),
        typeof item === 'string' ? item.slice(0, 160) : item,
      ])
  );
};

const UPLOAD_ROOT = getUploadRoot();
const upload = multer({
  dest: UPLOAD_ROOT,
  limits: { fileSize: MAX_UPLOAD_BYTES, fieldSize: 8 * 1024, fields: 12 },
  fileFilter: (_req, file, callback) => {
    callback(null, isAllowedImageUpload(file));
  },
});

if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const parseJsonSafe = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const getGarmentValidationCode = (raw: string) => {
  const parsed = parseJsonSafe<{ detail?: string; error?: string }>(raw);
  const detail = parsed?.detail || parsed?.error || '';
  const normalized = detail.startsWith('GARMENT_INVALID:')
    ? detail.replace('GARMENT_INVALID:', '')
    : detail;
  return PUBLIC_GARMENT_VALIDATION_CODES.has(normalized) ? normalized : 'GARMENT_PREPROCESS_FAILED';
};

const getGarmentValidationMessage = (code: string) => {
  switch (code) {
    case 'MODEL_WORN_GARMENT':
      return 'Use a garment-only product image. Photos with a person wearing the garment are rejected in the public demo.';
    case 'GARMENT_TOO_LONG':
      return 'This garment is outside the current upper-body demo scope. Use a shorter upper-body garment.';
    case 'LOW_RESOLUTION':
      return 'Use a higher-resolution garment image for the demo.';
    case 'IMAGE_BLURRY':
      return 'The garment image is too blurry. Use a sharper product photo.';
    case 'GARMENT_CATEGORY_UNSUPPORTED':
      return 'That garment category is outside the current realism-focused demo scope. Try a shirt, t-shirt, polo, blouse, top, or short upper-body kurti.';
    default:
      return 'Garment preprocessing failed. Use one isolated upper-body garment on a plain background.';
  }
};

const trackWebsiteEvent = async (
  event: string,
  path: string | null,
  visitorId: string | null,
  referrer: string | null,
  metadata: Record<string, unknown> = {}
) => {
  await prisma.websiteEvent.create({
    data: {
      event,
      path: path || null,
      visitorId: visitorId || null,
      referrer: referrer || null,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
};

router.post(
  '/events',
  createRateLimitMiddleware(120, 15 * 60 * 1000),
  async (req, res) => {
    try {
      const { event, path, visitorId, referrer, metadata } = req.body || {};
      if (!event || typeof event !== 'string' || !PUBLIC_WEBSITE_EVENTS.has(event)) {
        return res.status(400).json({ error: 'INVALID_EVENT' });
      }

      await trackWebsiteEvent(
        event.slice(0, 80),
        typeof path === 'string' ? path.slice(0, 255) : null,
        typeof visitorId === 'string' ? visitorId.slice(0, 120) : null,
        sanitizeReferrer(referrer),
        sanitizeEventMetadata(metadata)
      );

      return res.json({ ok: true });
    } catch (error) {
      console.error('Website event tracking error:', formatLogError(error));
      return res.status(500).json({ error: 'EVENT_TRACK_FAILED' });
    }
  }
);

router.post(
  '/demo/tryon',
  createRateLimitMiddleware(3, 24 * 60 * 60 * 1000),
  requireTryOnIntake,
  upload.fields([
    { name: 'person_image', maxCount: 1 },
    { name: 'cloth_image', maxCount: 1 },
  ]),
  async (req: any, res) => {
    const inputFailure = validateMultipartFields(req.body);
    if (inputFailure) {
      const uploaded = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      for (const files of Object.values(uploaded || {})) files.forEach(removeUploadedFile);
      return res.status(400).json({ error: inputFailure.code });
    }
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const personFile = files?.person_image?.[0];
    const clothFile = files?.cloth_image?.[0];
    const requestId = crypto.randomUUID();
    let transientCacheKey: string | null = null;
    let publicDemoLease: Parameters<typeof releaseTryOnSlot>[0] | null = null;
    let consentRecorded = false;
    let cacheCleanupOutcome: 'not_created' | 'deleted' | 'failed' = 'not_created';

    if (!personFile || !clothFile) {
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
      return res.status(400).json({ error: 'PERSON_AND_CLOTH_REQUIRED' });
    }

    const shopperConsent = String(req.body?.shopper_consent || '').trim().toLowerCase();
    const privacyPolicyVersion = String(req.body?.privacy_policy_version || '').trim();
    if (shopperConsent !== 'true' || privacyPolicyVersion !== SHOPPER_PRIVACY_POLICY_VERSION) {
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
      return res.status(400).json({
        error: 'SHOPPER_CONSENT_REQUIRED',
        message: 'Explicit consent to transient try-on processing is required.',
        privacyPolicyVersion: SHOPPER_PRIVACY_POLICY_VERSION,
      });
    }
    res.setHeader('x-drapixai-media-retention', SHOPPER_MEDIA_RETENTION);
    res.setHeader('x-drapixai-training-use', SHOPPER_TRAINING_USE);

    if (!(await isAllowedImageFileContent(personFile)) || !(await isAllowedImageFileContent(clothFile))) {
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
      return res.status(400).json({
        error: 'INVALID_IMAGE_CONTENT',
        message: 'Uploaded image content must match a supported JPEG, PNG, or WebP file.'
      });
    }

    const slot = await acquireTryOnSlot(0);
    if (!slot.ok) {
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
      const unavailable = slot.reason === 'CONCURRENCY_CONTROL_UNAVAILABLE';
      res.setHeader('Retry-After', '2');
      return res.status(unavailable ? 503 : 429).json({
        error: slot.reason,
        message: unavailable
          ? 'Try-on capacity control is temporarily unavailable.'
          : 'DrapixAI is processing the current GPU capacity. Please retry shortly.',
      });
    }
    publicDemoLease = slot.lease;

    try {
      await appendSecurityAudit(prisma, {
        actorUserId: null,
        actorRole: 'public_shopper',
        action: 'privacy.public_demo_consent.accepted',
        targetType: 'tryon_request',
        targetId: requestId,
        requestId,
        ip: req.ip,
        metadata: {
          privacyPolicyVersion,
          mediaRetention: SHOPPER_MEDIA_RETENTION,
          modelTrainingUse: SHOPPER_TRAINING_USE,
        },
      });
      consentRecorded = true;

      await trackWebsiteEvent('demo_tryon_started', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
      });

      const personBytes = fs.readFileSync(personFile.path);
      const clothBytes = fs.readFileSync(clothFile.path);

      const preprocessResponse = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {
        method: 'POST',
        headers: getAiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          cloth_image_base64: clothBytes.toString('base64'),
          brand_id: 'public-demo',
          garment_id: `demo-${Date.now()}`,
          admin_bypass: false,
        }),
      });

      if (!preprocessResponse.ok) {
        const errorText = await preprocessResponse.text();
        const error = getGarmentValidationCode(errorText || 'GARMENT_PREPROCESS_FAILED');
        return res.status(preprocessResponse.status).json({
          error,
          message: getGarmentValidationMessage(error),
        });
      }

      const preprocessResult = await preprocessResponse.json() as { cache_key?: string };
      if (!preprocessResult.cache_key) {
        return res.status(502).json({ error: 'GARMENT_CACHE_KEY_MISSING' });
      }
      transientCacheKey = preprocessResult.cache_key;

      const tryOnResponse = await aiFetch(`${AI_URL}/ai/tryon/base64`, {
        method: 'POST',
        headers: getAiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_id: 'public-demo',
          person_image_base64: personBytes.toString('base64'),
          cloth_image_base64: '',
          cloth_cache_key: preprocessResult.cache_key,
          quality: 'standard',
          garment_type: 'upper',
        }),
      });

      if (!tryOnResponse.ok) {
        const errorText = await tryOnResponse.text();
        return res.status(tryOnResponse.status).json({
          error: sanitizeUpstreamError('DEMO_TRY_ON_FAILED', errorText),
          message: 'DrapixAI could not complete this demo try-on. Please retry with clearer front-facing inputs.',
        });
      }

      const engine = tryOnResponse.headers.get('x-drapixai-engine') || '';
      const qualityScore = tryOnResponse.headers.get('x-drapixai-quality-score') || '';
      const candidateCount = tryOnResponse.headers.get('x-drapixai-candidate-count') || '';
      const warnings = tryOnResponse.headers.get('x-drapixai-warnings') || '';
      const processingMs = tryOnResponse.headers.get('x-drapixai-processing-ms') || '';
      const timingJson = tryOnResponse.headers.get('x-drapixai-timing-json') || '';
      const parsedQualityScore = Number(qualityScore);
      const parsedWarnings = warnings.split(',').map((warning) => warning.trim()).filter(Boolean);
      const parsedTimingJson = timingJson ? parseJsonSafe<Record<string, unknown>>(timingJson) : null;
      if (shouldAutoRejectTryOn({
        qualityScore: Number.isFinite(parsedQualityScore) ? parsedQualityScore : null,
        warnings: parsedWarnings,
        timingJson: parsedTimingJson,
      })) {
        await trackWebsiteEvent('demo_tryon_rejected', '/demo', null, req.headers.referer || null, {
          source: 'public_demo',
          qualityScore,
          candidateCount,
          warnings,
        });
        return res.status(422).json({
          error: 'TRYON_RESULT_NOT_PUBLISHABLE',
          message: 'DrapixAI could not produce a storefront-safe try-on for these inputs. Please retry with a clearer front-facing photo.',
        });
      }

      const buffer = Buffer.from(await tryOnResponse.arrayBuffer());
      await trackWebsiteEvent('demo_tryon_succeeded', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
        engine,
        qualityScore,
        candidateCount,
        warnings,
        processingMs,
      });
      res.setHeader('Content-Type', tryOnResponse.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'no-store, private');
      if (engine) res.setHeader('x-drapixai-engine', engine);
      if (qualityScore) res.setHeader('x-drapixai-quality-score', qualityScore);
      if (candidateCount) res.setHeader('x-drapixai-candidate-count', candidateCount);
      if (warnings) res.setHeader('x-drapixai-warnings', warnings);
      if (processingMs) res.setHeader('x-drapixai-processing-ms', processingMs);
      if (timingJson) res.setHeader('x-drapixai-timing-json', timingJson);
      return res.send(buffer);
    } catch (error) {
      console.error('Public demo try-on error:', formatLogError(error));
      await trackWebsiteEvent('demo_tryon_failed', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
      }).catch(() => undefined);
      return res.status(500).json({ error: 'DEMO_TRY_ON_FAILED' });
    } finally {
      if (publicDemoLease) await releaseTryOnSlot(publicDemoLease);
      if (transientCacheKey) {
        try {
          const cleanupResponse = await aiFetch(`${AI_URL}/ai/garment/cache/delete`, {
            method: 'POST',
            headers: getAiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ cache_key: transientCacheKey }),
          });
          cacheCleanupOutcome = cleanupResponse.ok ? 'deleted' : 'failed';
          if (!cleanupResponse.ok) {
            console.error('Public demo transient garment cache cleanup failed:', `HTTP_${cleanupResponse.status}`);
          }
        } catch (error) {
          cacheCleanupOutcome = 'failed';
          console.error('Public demo transient garment cache cleanup failed:', formatLogError(error));
        }
      }
      removeUploadedFile(personFile);
      removeUploadedFile(clothFile);
      if (consentRecorded) {
        await appendSecurityAudit(prisma, {
          actorUserId: null,
          actorRole: 'public_shopper',
          action: 'privacy.public_demo_media.cleanup',
          targetType: 'tryon_request',
          targetId: requestId,
          outcome: cacheCleanupOutcome === 'failed' ? 'failure' : 'success',
          requestId,
          ip: req.ip,
          metadata: {
            uploadFilesDeleted: true,
            transientGarmentCache: cacheCleanupOutcome,
            personImageRetained: false,
            resultImageRetained: false,
            modelTrainingUse: SHOPPER_TRAINING_USE,
          },
        }).catch((error) => {
          console.error('Public demo privacy cleanup audit failed:', formatLogError(error));
        });
      }
    }
  }
);

export default router;
