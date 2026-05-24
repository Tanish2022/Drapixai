import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { createStorageClient } from '../lib/storage';

type GarmentPreprocessResponse = {
  cache_key?: string;
  reason?: string;
  profile_label?: string;
};

const prisma = new PrismaClient();
const s3 = createStorageClient();
const AI_URL = process.env.DRAPIXAI_AI_URL || 'http://localhost:8080';
const CACHE_VERSION = process.env.DRAPIXAI_GARMENT_CACHE_VERSION || 'v3-1024x1365';
const ADMIN_TOKEN = process.env.DRAPIXAI_ADMIN_TOKEN || '';
const ADMIN_BYPASS = (process.env.DRAPIXAI_CACHE_REGEN_ADMIN_BYPASS || '0') === '1';

const fetchStoredImage = async (storedUrl: string | null | undefined): Promise<Buffer | null> => {
  if (!storedUrl) return null;
  if (storedUrl.startsWith('local:')) {
    const localPath = storedUrl.replace('local:', '');
    if (!fs.existsSync(localPath)) return null;
    return fs.readFileSync(localPath);
  }
  if (storedUrl.startsWith('s3://')) {
    const rest = storedUrl.replace('s3://', '');
    const [bucket, ...keyParts] = rest.split('/');
    const key = keyParts.join('/');
    const resp: any = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  if (/^https?:\/\//i.test(storedUrl)) {
    const response = await fetch(storedUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
};

const getErrorCode = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as { detail?: string; error?: string; message?: string };
    const value = parsed.detail || parsed.error || parsed.message || raw;
    return value.startsWith('GARMENT_INVALID:') ? value.replace('GARMENT_INVALID:', '') : value;
  } catch {
    return raw.startsWith('GARMENT_INVALID:') ? raw.replace('GARMENT_INVALID:', '') : raw;
  }
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const onlyUserIdArg = process.argv.find((arg) => arg.startsWith('--user-id='));
  const onlyUserId = onlyUserIdArg ? Number(onlyUserIdArg.split('=')[1]) : null;

  const garments = await prisma.garment.findMany({
    where: {
      ...(onlyUserId ? { userId: onlyUserId } : {}),
      originalUrl: { not: null },
    },
    orderBy: [{ userId: 'asc' }, { garmentId: 'asc' }],
  });

  const summary = {
    cacheVersion: CACHE_VERSION,
    dryRun,
    total: garments.length,
    ready: 0,
    failed: 0,
    skipped: 0,
    items: [] as Array<{
      userId: number;
      garmentId: string;
      status: 'ready' | 'failed' | 'skipped';
      cacheKey?: string;
      reason?: string;
    }>,
  };

  for (const garment of garments) {
    const label = `${garment.userId}/${garment.garmentId}`;
    const originalBytes = await fetchStoredImage(garment.originalUrl);
    if (!originalBytes) {
      const reason = 'ORIGINAL_IMAGE_NOT_FOUND';
      summary.failed += 1;
      summary.items.push({ userId: garment.userId, garmentId: garment.garmentId, status: 'failed', reason });
      if (!dryRun) {
        await prisma.garment.update({
          where: { id: garment.id },
          data: { status: 'pending', rejectedReason: `CACHE_REGEN_FAILED:${reason}` },
        });
      }
      console.log(`[failed] ${label} ${reason}`);
      continue;
    }

    if (dryRun) {
      summary.skipped += 1;
      summary.items.push({ userId: garment.userId, garmentId: garment.garmentId, status: 'skipped', reason: 'DRY_RUN' });
      console.log(`[dry-run] ${label}`);
      continue;
    }

    try {
      const response = await fetch(`${AI_URL}/ai/garment/preprocess/base64`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ADMIN_BYPASS && ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}),
        },
        body: JSON.stringify({
          cloth_image_base64: originalBytes.toString('base64'),
          brand_id: String(garment.userId),
          garment_id: garment.garmentId,
          category: garment.category || undefined,
          product_name: garment.productName || garment.displayName || garment.garmentId,
          admin_bypass: ADMIN_BYPASS,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(getErrorCode(raw || 'AI_PREPROCESS_FAILED'));
      }

      const result = (await response.json()) as GarmentPreprocessResponse;
      if (!result.cache_key) {
        throw new Error('CACHE_KEY_MISSING');
      }

      await prisma.garment.update({
        where: { id: garment.id },
        data: {
          cacheKey: result.cache_key,
          status: 'ready',
          rejectedReason: null,
          category: garment.category || result.profile_label || 'Upper-Body Garment',
          garmentType: garment.garmentType || 'upper',
        },
      });

      summary.ready += 1;
      summary.items.push({
        userId: garment.userId,
        garmentId: garment.garmentId,
        status: 'ready',
        cacheKey: result.cache_key,
        reason: result.reason,
      });
      console.log(`[ready] ${label} ${result.cache_key}`);
    } catch (error: any) {
      const reason = String(error?.message || 'CACHE_REGEN_FAILED').slice(0, 180);
      summary.failed += 1;
      summary.items.push({ userId: garment.userId, garmentId: garment.garmentId, status: 'failed', reason });
      await prisma.garment.update({
        where: { id: garment.id },
        data: { status: 'pending', rejectedReason: `CACHE_REGEN_FAILED:${reason}` },
      });
      console.log(`[failed] ${label} ${reason}`);
    }
  }

  const reportDir = path.join('runtime', 'cache-regeneration');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `garment-cache-${CACHE_VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log(`\nCache regeneration report: ${reportPath}`);
  console.log(`Ready: ${summary.ready} / Failed: ${summary.failed} / Skipped: ${summary.skipped} / Total: ${summary.total}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
