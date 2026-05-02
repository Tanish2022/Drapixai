import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import { createRateLimitMiddleware } from '../lib/rate-limit';

const router = Router();
const prisma = new PrismaClient();
const MAX_UPLOAD_BYTES = Number(process.env.DRAPIXAI_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const AI_URL = process.env.DRAPIXAI_AI_URL || 'http://localhost:8080';

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype.startsWith('image/'));
  },
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

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
      if (!event || typeof event !== 'string') {
        return res.status(400).json({ error: 'EVENT_REQUIRED' });
      }

      await trackWebsiteEvent(
        event.slice(0, 80),
        typeof path === 'string' ? path.slice(0, 255) : null,
        typeof visitorId === 'string' ? visitorId.slice(0, 120) : null,
        typeof referrer === 'string' ? referrer.slice(0, 255) : null,
        metadata && typeof metadata === 'object' ? metadata : {}
      );

      return res.json({ ok: true });
    } catch (error) {
      console.error('Website event tracking error:', error);
      return res.status(500).json({ error: 'EVENT_TRACK_FAILED' });
    }
  }
);

router.post(
  '/demo/tryon',
  createRateLimitMiddleware(3, 24 * 60 * 60 * 1000),
  upload.fields([
    { name: 'person_image', maxCount: 1 },
    { name: 'cloth_image', maxCount: 1 },
  ]),
  async (req: any, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const personFile = files?.person_image?.[0];
    const clothFile = files?.cloth_image?.[0];

    if (!personFile || !clothFile) {
      return res.status(400).json({ error: 'PERSON_AND_CLOTH_REQUIRED' });
    }

    try {
      await trackWebsiteEvent('demo_tryon_started', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
      });

      const personBytes = fs.readFileSync(personFile.path);
      const clothBytes = fs.readFileSync(clothFile.path);

      const preprocessResponse = await fetch(`${AI_URL}/ai/garment/preprocess/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const tryOnResponse = await fetch(`${AI_URL}/ai/tryon/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'public-demo',
          person_image_base64: personBytes.toString('base64'),
          cloth_image_base64: '',
          cloth_cache_key: preprocessResult.cache_key,
          quality: 'enhanced',
          garment_type: 'upper',
        }),
      });

      if (!tryOnResponse.ok) {
        const errorText = await tryOnResponse.text();
        return res.status(tryOnResponse.status).json({ error: errorText || 'DEMO_TRY_ON_FAILED' });
      }

      const buffer = Buffer.from(await tryOnResponse.arrayBuffer());
      await trackWebsiteEvent('demo_tryon_succeeded', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
      });
      res.setHeader('Content-Type', tryOnResponse.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (error) {
      console.error('Public demo try-on error:', error);
      await trackWebsiteEvent('demo_tryon_failed', '/demo', null, req.headers.referer || null, {
        source: 'public_demo',
      }).catch(() => undefined);
      return res.status(500).json({ error: 'DEMO_TRY_ON_FAILED' });
    } finally {
      if (personFile?.path && fs.existsSync(personFile.path)) fs.unlinkSync(personFile.path);
      if (clothFile?.path && fs.existsSync(clothFile.path)) fs.unlinkSync(clothFile.path);
    }
  }
);

export default router;
