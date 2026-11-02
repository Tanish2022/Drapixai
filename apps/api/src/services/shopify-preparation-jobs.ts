import crypto from 'crypto';
import sharp from 'sharp';
import { Prisma, PrismaClient, ShopifyPreparationJob } from '@prisma/client';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createStorageClient, getStorageEncryptionParams, STORAGE_BUCKET } from '../lib/storage';
import { detectImageMimeType, sanitizePathSegment } from '../lib/security';
import { aiFetch } from '../lib/ai-client';
import { isTryOnIntakeEnabled } from '../lib/tryon-intake';
import { DatabaseLockBusy, runDatabaseTransaction } from '../lib/database-transaction';
import { lockShopifyLifecycle, requireActiveShopifyCatalog, shopifyPreparationSourceHash } from './shopify-catalog-state';
import { cleanupShopifyPreparationJob, recoverShopifyPreparationJobs } from './shopify-preparation-cleanup';
import { downloadShopifyImage, MAX_ATTEMPTS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, positiveIntegerSetting } from './shopify-image-source';

const storage = createStorageClient();
const AI_URL = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');
const MAX_PENDING = positiveIntegerSetting('DRAPIXAI_SHOPIFY_PREPARE_MAX_PENDING_PER_TENANT', 100, 1000);
const pending = ['queued', 'retry', 'processing', 'reconciliation_required'];
const tenantLeaseId = (userId: number) => `shopify-preparation:user:${userId}`;
const failureCode = (error: unknown) => error instanceof Error && /^SHOPIFY_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SHOPIFY_PREPARATION_FAILED';

// Caller owns a short DB-only transaction. Admission is serialized per tenant;
// repeated catalog syncs cannot reset attempt limits or multiply queued work.
export const queueShopifyCatalogPreparation = async (tx: Prisma.TransactionClient, userId: number, productIds: string[], retryFailed = false) => {
  const [lock] = await tx.$queryRaw<Array<{acquired: boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext('drapixai-shopify-prep-admit'), ${userId}::integer) AS acquired`;
  if (!lock?.acquired) throw new DatabaseLockBusy();
  let count = await tx.catalogProduct.count({where: {userId, source: {startsWith: 'shopify:'}, preparationStatus: {in: pending}}});
  const products = await tx.catalogProduct.findMany({where: {userId, productId: {in: productIds}, source: {startsWith: 'shopify:'}, isVariant: false, status: {not: 'archived'}}, orderBy: {id: 'asc'}});
  let queued = 0, alreadyPrepared = 0, missingImage = 0, deferred = 0;
  const queuedIds: number[] = [], deferredIds: number[] = [];
  for (const product of products) {
    if (!product.imageUrl) { missingImage++; continue; }
    if (product.preparationStatus === 'reconciliation_required') continue;
    const sourceHash = shopifyPreparationSourceHash(product);
    if (['review_required', 'prepared', 'ready'].includes(product.preparationStatus) && product.preparedImageUrl === product.imageUrl && product.preparedSourceHash === sourceHash) { alreadyPrepared++; continue; }
    if (['queued', 'processing', 'retry'].includes(product.preparationStatus) && !(retryFailed && product.preparationStatus === 'retry')) continue;
    if (product.preparationStatus === 'failed' && !retryFailed && (!product.preparedSourceHash || product.preparedSourceHash === sourceHash)) continue;
    if (product.preparedGarmentId && product.preparedSourceHash !== sourceHash) {
      await tx.garment.updateMany({where: {userId, garmentId: product.preparedGarmentId}, data: {status: 'stale'}});
      await tx.garmentMatch.updateMany({where: {userId, garmentId: product.preparedGarmentId}, data: {confirmedProductId: null, suggestedProductId: product.productId, status: 'suggested', matchReason: 'Shopify product image changed; regenerate and review the garment cache.'}});
    }
    const wasPending = pending.includes(product.preparationStatus);
    if (count >= MAX_PENDING && !wasPending) {
      deferredIds.push(product.id);
      deferred++; continue;
    }
    queuedIds.push(product.id);
    if (!wasPending) count++;
    queued++;
  }
  if (deferredIds.length) await tx.catalogProduct.updateMany({where: {userId, id: {in: deferredIds}}, data: {preparationStatus: 'capacity_wait', preparationError: 'SHOPIFY_PREPARATION_TENANT_CAPACITY'}});
  if (queuedIds.length) await tx.catalogProduct.updateMany({where: {userId, id: {in: queuedIds}}, data: {preparationStatus: 'queued', preparationAttempts: 0,
    preparationError: null, preparationQueuedAt: new Date(), preparationStartedAt: null, preparationNextAttemptAt: null, preparationCompletedAt: null}});
  return {queued, alreadyPrepared, missingImage, deferred};
};

export const retryShopifyPreparation = async (prisma: PrismaClient, userId: number, productId?: string, onlyDeferred = false) => runDatabaseTransaction(prisma, async tx => {
  const installations = await tx.shopifyInstallation.findMany({where: {userId, status: 'active'}, orderBy: {shopDomain: 'asc'}});
  for (const installation of installations) await lockShopifyLifecycle(tx, installation.shopDomain);
  const products = await tx.catalogProduct.findMany({where: {userId, source: {in: installations.map(i => `shopify:${i.shopDomain}`)},
    ...(productId ? {productId} : {}), preparationStatus: {in: onlyDeferred ? ['capacity_wait'] : ['failed', 'retry', 'capacity_wait']}, status: {not: 'archived'}, isVariant: false}, take: 1000, select: {productId: true}});
  return queueShopifyCatalogPreparation(tx, userId, products.map(p => p.productId), !onlyDeferred);
});

const claimNext = async (prisma: PrismaClient, requestedUser?: number) => runDatabaseTransaction(prisma, async tx => {
  const [dispatcher] = await tx.$queryRaw<Array<{acquired: boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext('drapixai-shopify-prep-dispatch'), 0) AS acquired`;
  if (!dispatcher?.acquired) return null;
  // Preserve the previous single global preprocessing operation, while choosing
  // the least-recently-served tenant rather than its entire oldest backlog.
  if (await tx.shopifyPreparationJob.count({where: {status: {in: ['processing', 'ambiguous']}}})) return null;
  if (await tx.catalogPreparationLease.count({where: {id: 'shopify-catalog-preparation', expiresAt: {gt: new Date()}}})) return null;
  if (await tx.catalogProduct.count({where: {source: {startsWith: 'shopify:'}, preparationStatus: 'reconciliation_required'}})) return null;
  const rows = await tx.$queryRaw<Array<{id: number; userId: number}>>`SELECT p."id", p."userId" FROM "CatalogProduct" p
    JOIN "ShopifyInstallation" s ON p."source" = 'shopify:' || s."shopDomain" AND p."userId" = s."userId" AND s."status" = 'active'
    LEFT JOIN "CatalogPreparationLease" l ON l."id" = 'shopify-preparation:user:' || p."userId"::text
    WHERE p."isVariant" = false AND p."status" <> 'archived' AND p."preparationAttempts" < ${MAX_ATTEMPTS}
      AND (p."preparationStatus" = 'queued' OR (p."preparationStatus" = 'retry' AND p."preparationNextAttemptAt" <= CURRENT_TIMESTAMP))
      AND (l."id" IS NULL OR l."expiresAt" <= CURRENT_TIMESTAMP)
      AND NOT EXISTS (SELECT 1 FROM "ShopifyPreparationJob" j WHERE j."userId" = p."userId" AND j."status" = 'cleanup_pending')
    ORDER BY COALESCE(l."updatedAt", TIMESTAMP '1970-01-01'), p."preparationQueuedAt" ASC NULLS LAST, p."id" LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
  if (!rows.length || requestedUser !== undefined && rows[0].userId !== requestedUser) return null;
  const product = await tx.catalogProduct.findUniqueOrThrow({where: {id: rows[0].id}});
  if (!product.source?.startsWith('shopify:') || !product.imageUrl) return null;
  const shop = product.source.slice('shopify:'.length);
  await lockShopifyLifecycle(tx, shop);
  const installation = await tx.shopifyInstallation.findUnique({where: {shopDomain: shop}});
  if (!installation || installation.status !== 'active' || installation.userId !== product.userId) return null;
  const id = crypto.randomUUID(), now = new Date(), expiresAt = new Date(Date.now() + 300000);
  const garmentId = `shopify-${product.productId}-${id.replace(/-/g, '')}`;
  const prefix = `garments/originals/${product.userId}/${sanitizePathSegment(garmentId, 'garment')}`;
  const thumbPrefix = `garments/thumbs/${product.userId}/${sanitizePathSegment(garmentId, 'garment')}`;
  await tx.catalogPreparationLease.upsert({where: {id: tenantLeaseId(product.userId)},
    create: {id: tenantLeaseId(product.userId), ownerToken: id, expiresAt}, update: {ownerToken: id, expiresAt}});
  const job = await tx.shopifyPreparationJob.create({data: {id, installationId: installation.id, catalogProductId: product.id,
    userId: product.userId, epoch: installation.catalogEpoch, sourceImageUrl: product.imageUrl, sourceHash: shopifyPreparationSourceHash(product), garmentId,
    originalUrl: `s3://${STORAGE_BUCKET}/${prefix}/${id}.img`, thumbnailUrl: `s3://${STORAGE_BUCKET}/${thumbPrefix}/${id}.png`, expiresAt, createdAt: now}});
  await tx.catalogProduct.update({where: {id: product.id}, data: {preparationStatus: 'processing', preparationStartedAt: now, preparationAttempts: {increment: 1}}});
  return {job, product, shop};
});

const assertJob = async (tx: Prisma.TransactionClient, job: ShopifyPreparationJob, shop: string) => {
  await requireActiveShopifyCatalog(tx, job.installationId, shop, job.epoch, job.userId);
  const current = await tx.shopifyPreparationJob.findUnique({where: {id: job.id}});
  const lease = await tx.catalogPreparationLease.findUnique({where: {id: tenantLeaseId(job.userId)}});
  const product = await tx.catalogProduct.findUnique({where: {id: job.catalogProductId}});
  if (!current || current.status !== 'processing' || current.expiresAt <= new Date() || lease?.ownerToken !== job.id || lease.expiresAt <= new Date()
    || !product || product.userId !== job.userId || product.source !== `shopify:${shop}` || product.status === 'archived'
    || product.isVariant || product.preparationStatus !== 'processing' || product.preparationStartedAt?.getTime() !== job.createdAt.getTime() || shopifyPreparationSourceHash(product) !== job.sourceHash) throw new Error('SHOPIFY_PREPARATION_STATE_CHANGED');
  return product;
};

const uploadPlanned = async (url: string, bytes: Buffer, mime: string) => {
  const location = new URL(url);
  try { await storage.send(new PutObjectCommand({Bucket: STORAGE_BUCKET, Key: location.pathname.slice(1), Body: bytes, ContentType: mime, ...getStorageEncryptionParams()}), {abortSignal: AbortSignal.timeout(30000)}); }
  catch { throw new Error('SHOPIFY_STORAGE_WRITE_UNCERTAIN'); }
};

const preprocess = async (prisma: PrismaClient, claim: NonNullable<Awaited<ReturnType<typeof claimNext>>>) => {
  const {job, product, shop} = claim;
  const {image, mime} = await downloadShopifyImage(job.sourceImageUrl);
  const guarded = (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => runDatabaseTransaction(prisma, async tx => {await assertJob(tx, job, shop); return callback(tx);});
  await guarded(tx => tx.shopifyPreparationJob.update({where: {id: job.id}, data: {externalWorkStarted: true}}));
  await uploadPlanned(job.originalUrl, image, mime);
  await guarded(tx => tx.shopifyPreparationJob.update({where: {id: job.id}, data: {aiRequestStarted: true}}));
  const response = await aiFetch(`${AI_URL}/ai/garment/preprocess/base64`, {method: 'POST', headers: {'Content-Type': 'application/json',
    ...(process.env.DRAPIXAI_AI_SERVICE_TOKEN ? {'x-drapixai-service-token': process.env.DRAPIXAI_AI_SERVICE_TOKEN} : {})},
    signal: AbortSignal.timeout(120000), body: JSON.stringify({cloth_image_base64: image.toString('base64'), brand_id: String(job.userId), garment_id: job.garmentId,
      category: product.category || undefined, product_name: product.productName || product.productId, garment_type: product.garmentType || 'upper', admin_bypass: false})});
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      await prisma.shopifyPreparationJob.update({where: {id: job.id}, data: {aiRequestStarted: false}});
      throw new Error('SHOPIFY_GARMENT_VALIDATION_FAILED');
    }
    throw new Error('SHOPIFY_AI_PREPROCESS_UNAVAILABLE');
  }
  // Bound both advertised and streamed JSON, then validate tenant-specific key.
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES * 3) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const reader = response.body?.getReader(); if (!reader) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const chunks: Buffer[] = []; let length = 0;
  try { while (true) {const {done, value} = await reader.read(); if (done) break; length += value.length;
    if (length > MAX_IMAGE_BYTES * 3) {await reader.cancel(); throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');} chunks.push(Buffer.from(value));} }
  finally {reader.releaseLock();}
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {cache_key?: string; image_base64?: string; warnings?: string[]};
  const key = typeof result.cache_key === 'string' ? result.cache_key.split(':') : [];
  const imageHash = crypto.createHash('sha256').update(image).digest('hex');
  if (key.length !== 5 || key[0] !== 'v3-1024x1365' || key[1] !== String(job.userId) || key[2] !== job.garmentId || !/^[A-Za-z0-9_-]{1,80}$/.test(key[3]) || key[4] !== imageHash) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  // Preserve a late response's cleanup key even after its claim was invalidated.
  await prisma.shopifyPreparationJob.updateMany({where: {id: job.id, status: {in: ['processing', 'ambiguous']}}, data: {cacheKey: result.cache_key}});
  if (!result.image_base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.image_base64)) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const processed = Buffer.from(result.image_base64, 'base64'); if (!detectImageMimeType(processed.subarray(0, 16))) throw new Error('SHOPIFY_AI_PREPROCESS_INVALID');
  const thumbnail = await sharp(processed, {limitInputPixels: MAX_IMAGE_PIXELS}).resize(256, 256, {fit: 'contain', background: '#00000000'}).png().toBuffer();
  await guarded(async () => undefined);
  await uploadPlanned(job.thumbnailUrl, thumbnail, 'image/png');
  await guarded(async tx => {
    const data = {displayName: product.productName || product.productId, cacheKey: result.cache_key!, originalHash: imageHash,
      originalUrl: job.originalUrl, sourceImageUrl: job.sourceImageUrl, thumbnailUrl: job.thumbnailUrl, productName: product.productName,
      category: product.category, garmentType: product.garmentType || 'upper', status: 'pending', rejectedReason: null};
    await tx.garment.create({data: {userId: job.userId, garmentId: job.garmentId, ...data}});
    await tx.garmentMatch.create({data: {userId: job.userId, garmentId: job.garmentId, suggestedProductId: product.productId, confirmedProductId: null, status: 'suggested', confidence: 1,
      matchReason: 'Prepared automatically from the synchronized Shopify product image; review before publishing.'}});
    await tx.catalogProduct.update({where: {id: product.id}, data: {preparationStatus: 'review_required', preparationError: null, preparationWarnings: result.warnings || [],
      preparationCompletedAt: new Date(), preparationNextAttemptAt: null, preparedImageUrl: job.sourceImageUrl, preparedSourceHash: job.sourceHash, preparedGarmentId: job.garmentId}});
    await tx.shopifyPreparationJob.update({where: {id: job.id}, data: {status: 'completed', errorCode: null}});
  });
};

export const processShopifyCatalogPreparationBatch = async (prisma: PrismaClient, limit = 3, userId?: number) => {
  await recoverShopifyPreparationJobs(prisma);
  if (!isTryOnIntakeEnabled()) return {busy: false, paused: true, items: [] as Array<{productId: string; status: string; error?: string}>};
  // Refill bounded per-tenant capacity from the durable deferred catalog.
  const waiting = await prisma.catalogProduct.findMany({where: {source: {startsWith: 'shopify:'}, preparationStatus: 'capacity_wait', status: {not: 'archived'}}, distinct: ['userId'], select: {userId: true}, take: 20});
  for (const tenant of waiting) await retryShopifyPreparation(prisma, tenant.userId, undefined, true).catch(() => undefined);
  const normalized = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 10)) : 3;
  const items: Array<{productId: string; status: string; error?: string}> = [];
  for (let index = 0; index < normalized; index++) {
    const claim = await claimNext(prisma, userId); if (!claim) break;
    const {job, product} = claim;
    try { await preprocess(prisma, claim); items.push({productId: product.productId, status: 'review_required'}); }
    catch (error) {
      const code = failureCode(error), current = await prisma.shopifyPreparationJob.findUniqueOrThrow({where: {id: job.id}});
      const uncertain = code === 'SHOPIFY_STORAGE_WRITE_UNCERTAIN' || current.aiRequestStarted && !current.cacheKey;
      const permanent = /VALIDATION_FAILED|HOST_NOT_ALLOWED|TYPE_UNSUPPORTED|LOW_RESOLUTION|PIXEL_LIMIT|TOO_LARGE/.test(code);
      const retry = !permanent && !uncertain && product.preparationAttempts + 1 < MAX_ATTEMPTS;
      await runDatabaseTransaction(prisma, async tx => {
        await tx.shopifyPreparationJob.updateMany({where: {id: job.id, status: {in: ['processing', 'ambiguous']}}, data: {status: uncertain ? 'ambiguous' : 'cleanup_pending', errorCode: code}});
        await tx.catalogProduct.updateMany({where: {id: product.id, preparationStatus: {in: ['processing', 'reconciliation_required']}, preparationStartedAt: job.createdAt}, data: {
          preparationStatus: uncertain ? 'reconciliation_required' : retry ? 'retry' : 'failed', preparationError: code,
          preparationNextAttemptAt: retry ? new Date(Date.now() + Math.min(900000, 30000 * 2 ** product.preparationAttempts)) : null}});
      });
      if (!uncertain) await cleanupShopifyPreparationJob(prisma, job.id).catch(() => undefined);
      items.push({productId: product.productId, status: uncertain ? 'reconciliation_required' : retry ? 'retry' : 'failed', error: code});
    } finally {
      await prisma.catalogPreparationLease.updateMany({where: {id: tenantLeaseId(job.userId), ownerToken: job.id}, data: {ownerToken: 'idle', expiresAt: new Date(0)}});
    }
  }
  return {busy: items.length === 0 && Boolean(await prisma.shopifyPreparationJob.count({where: {status: {in: ['processing', 'ambiguous']}}})), items};
};
