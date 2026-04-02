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
        return res.status(preprocessResponse.status).json({ error: errorText || 'GARMENT_PREPROCESS_FAILED' });
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
          quality: 'standard',
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
