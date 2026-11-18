import { PrismaClient } from '@prisma/client';
import { removeLocalStoredFile } from '../lib/security';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { eraseStoredObjectVersions } from '../lib/storage-erasure';
import { aiFetch } from '../lib/ai-client';
import { runDatabaseTransaction } from '../lib/database-transaction';

const storage = createStorageClient();
const AI_URL = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');

export const deleteShopifyAiCache = async (cacheKey: string | null) => {
  if (!cacheKey) return;
  const response = await aiFetch(`${AI_URL}/ai/garment/cache/delete`, {
    method: 'POST', headers: {'Content-Type': 'application/json',
      ...(process.env.DRAPIXAI_AI_SERVICE_TOKEN ? {'x-drapixai-service-token': process.env.DRAPIXAI_AI_SERVICE_TOKEN} : {})},
    body: JSON.stringify({cache_key: cacheKey}), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('SHOPIFY_AI_CACHE_DELETE_FAILED');
};

export const deleteShopifyStoredAsset = async (storedUrl: string | null) => {
  if (!storedUrl) return;
  if (storedUrl.startsWith('local:')) { removeLocalStoredFile(storedUrl, 'garments'); return; }
  if (!storedUrl.startsWith('s3://')) throw new Error('SHOPIFY_STORED_ASSET_OUTSIDE_GARMENT_PREFIX');
  const location = new URL(storedUrl), key = location.pathname.replace(/^\/+/, '');
  if (location.hostname !== STORAGE_BUCKET || !key.startsWith('garments/') || key.includes('..') || location.search || location.hash) throw new Error('SHOPIFY_STORED_ASSET_OUTSIDE_GARMENT_PREFIX');
  await eraseStoredObjectVersions(storage, STORAGE_BUCKET, key);
};

export const cleanupShopifyPreparationJob = async (prisma: PrismaClient, id: string, redacting = false) => {
  const job = await prisma.shopifyPreparationJob.findUnique({where: {id}});
  if (!job || job.status === 'cleaned') return;
  if (job.status !== 'cleanup_pending' && !(redacting && job.status === 'completed')) throw new Error('SHOPIFY_PREPARATION_DRAIN_PENDING');
  if (!job.externalWorkStarted) {
    await prisma.shopifyPreparationJob.updateMany({where: {id, status: 'cleanup_pending'}, data: {status: 'cleaned', errorCode: null}});
    return;
  }
  if (job.aiRequestStarted && !job.cacheKey) throw new Error('SHOPIFY_PREPARATION_RECONCILIATION_REQUIRED');
  try {
    await deleteShopifyAiCache(job.cacheKey);
    await deleteShopifyStoredAsset(job.originalUrl);
    await deleteShopifyStoredAsset(job.thumbnailUrl);
    await prisma.shopifyPreparationJob.updateMany({where: {id, status: {in: ['cleanup_pending', ...(redacting ? ['completed'] : [])]}},
      data: {status: 'cleaned', errorCode: null}});
  } catch {
    await prisma.shopifyPreparationJob.updateMany({where: {id, status: {in: ['cleanup_pending', ...(redacting ? ['completed'] : [])]}},
      data: {status: 'cleanup_pending', errorCode: 'SHOPIFY_PREPARATION_CLEANUP_FAILED'}});
    throw new Error('SHOPIFY_PREPARATION_CLEANUP_FAILED');
  }
};

export const recoverShopifyPreparationJobs = async (prisma: PrismaClient, installationId?: number) => {
  const jobs = await prisma.shopifyPreparationJob.findMany({where: {
    ...(installationId === undefined ? {} : {installationId}),
    OR: [{status: 'processing', expiresAt: {lte: new Date()}}, {status: 'cleanup_pending'}],
  }, orderBy: {createdAt: 'asc'}, take: 20});
  for (const job of jobs) {
    if (job.status === 'processing') {
      // An expired lease is not proof that a paused process/provider cannot
      // still write. Keep an explicit reconciliation hold on ambiguous work.
      const changed = await runDatabaseTransaction(prisma, async tx => {
        const changed = await tx.shopifyPreparationJob.updateMany({where: {id: job.id, status: 'processing', expiresAt: {lte: new Date()}, externalWorkStarted: job.externalWorkStarted},
          data: {status: job.externalWorkStarted ? 'ambiguous' : 'cleanup_pending', errorCode: 'SHOPIFY_PREPARATION_INTERRUPTED'}});
        if (changed.count) await tx.catalogProduct.updateMany({where: {id: job.catalogProductId, preparationStatus: 'processing', preparationStartedAt: job.createdAt},
          data: {preparationStatus: job.externalWorkStarted ? 'reconciliation_required' : 'retry', preparationError: 'SHOPIFY_PREPARATION_INTERRUPTED', preparationNextAttemptAt: new Date()}});
        return changed;
      });
      if (!changed.count) continue;
      if (job.externalWorkStarted) continue;
    }
    await cleanupShopifyPreparationJob(prisma, job.id).catch(() => undefined);
  }
};
