import { PrismaClient, ShopifyInstallation } from '@prisma/client';
import { runDatabaseTransaction } from '../lib/database-transaction';
import { deactivateShopifyInstallation, lockShopifyLifecycle } from './shopify-catalog-state';
import { cleanupShopifyPreparationJob, recoverShopifyPreparationJobs, deleteShopifyAiCache as deleteAiCache, deleteShopifyStoredAsset as deleteStoredGarmentAsset } from './shopify-preparation-cleanup';

export const redactShopifyInstallationData = async (
  prisma: PrismaClient,
  target: ShopifyInstallation | string,
) => {
  const stopped = await deactivateShopifyInstallation(prisma, typeof target === 'string' ? target : target.shopDomain, 'redacting');
  if (!stopped || typeof target !== 'string' && stopped.id !== target.id) return;
  const installation = stopped;
  await recoverShopifyPreparationJobs(prisma, installation.id);
  const unfinished = await prisma.shopifyPreparationJob.count({where: {installationId: installation.id, status: {in: ['processing', 'ambiguous']}}});
  const recordedProducts = await prisma.shopifyPreparationJob.findMany({where: {installationId: installation.id}, select: {catalogProductId: true}});
  const legacy = installation.userId ? await prisma.catalogProduct.count({where: {userId: installation.userId, source: `shopify:${installation.shopDomain}`,
    preparationStatus: 'reconciliation_required', ...(recordedProducts.length ? {id: {notIn: recordedProducts.map(job => job.catalogProductId)}} : {})}}) : 0;
  if (unfinished || legacy) throw new Error('SHOPIFY_PREPARATION_DRAIN_PENDING');
  const jobs = await prisma.shopifyPreparationJob.findMany({where: {installationId: installation.id, status: {in: ['completed', 'cleanup_pending']}}});
  for (const job of jobs) await cleanupShopifyPreparationJob(prisma, job.id, true);
  const shopSource = `shopify:${installation.shopDomain}`;
  const catalogProducts = installation.userId
    ? await prisma.catalogProduct.findMany({
        where: { userId: installation.userId, source: shopSource },
        select: { preparedGarmentId: true },
      })
    : [];
  const garmentIds = [...new Set(
    [...catalogProducts, ...await prisma.shopifyPreparationJob.findMany({where: {installationId: installation.id}, select: {garmentId: true}}).then(rows => rows.map(row => ({preparedGarmentId: row.garmentId})))]
      .map((product) => product.preparedGarmentId)
      .filter((garmentId): garmentId is string => Boolean(garmentId)),
  )];
  const garments = installation.userId && garmentIds.length > 0
    ? await prisma.garment.findMany({
        where: { userId: installation.userId, garmentId: { in: garmentIds } },
        select: { garmentId: true, cacheKey: true, originalUrl: true, thumbnailUrl: true },
      })
    : [];

  for (const garment of garments) {
    await deleteAiCache(garment.cacheKey);
    await deleteStoredGarmentAsset(garment.originalUrl);
    await deleteStoredGarmentAsset(garment.thumbnailUrl);
  }

  await runDatabaseTransaction(prisma, async (transaction) => {
    await lockShopifyLifecycle(transaction, installation.shopDomain);
    const current = await transaction.shopifyInstallation.findUnique({where: {id: installation.id}});
    if (!current) return;
    if (current.status !== 'redacting' || current.userId !== installation.userId) throw new Error('SHOPIFY_CATALOG_STATE_CHANGED');
    if (await transaction.shopifyPreparationJob.count({where: {installationId: installation.id, status: {not: 'cleaned'}}})) throw new Error('SHOPIFY_PREPARATION_DRAIN_PENDING');
    await transaction.shopifyTokenLease.deleteMany({where: {shopDomain: installation.shopDomain}});
    if (installation.userId) {
      if (garmentIds.length > 0) {
        await transaction.garmentMatch.deleteMany({
          where: { userId: installation.userId, garmentId: { in: garmentIds } },
        });
        await transaction.garment.deleteMany({
          where: { userId: installation.userId, garmentId: { in: garmentIds } },
        });
      }
      await transaction.catalogProduct.deleteMany({
        where: { userId: installation.userId, source: shopSource },
      });
    }
    await transaction.shopifyInstallation.delete({ where: { id: installation.id } });
    await transaction.shopifyPreparationJob.deleteMany({where: {installationId: installation.id, status: 'cleaned'}});
    if (installation.storefrontApiKeyId) {
      // Preserve quota/financial references while removing the storefront
      // identity and access. Deleting a key must never erase in-flight holds.
      await transaction.apiKey.updateMany({ where: { id: installation.storefrontApiKeyId }, data: {
        isActive: false, revokedAt: new Date(), expiresAt: new Date(),
        domainWhitelist: 'redacted.invalid', label: null, scopes: '',
      } });
    }
    await transaction.shopifyWebhookEvent.updateMany({
      where: { shopDomain: installation.shopDomain },
      data: { shopDomain: 'redacted.invalid' },
    });
  });
};
