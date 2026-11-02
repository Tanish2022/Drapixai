import { Prisma, PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { DatabaseLockBusy, runDatabaseTransaction } from '../lib/database-transaction';

export const shopifyPreparationSourceHash = (product: {productId: string; imageUrl: string | null; productName: string | null; category: string | null; garmentType: string | null}) =>
  crypto.createHash('sha256').update(JSON.stringify([product.productId, product.imageUrl, product.productName, product.category, product.garmentType || 'upper'])).digest('hex');

export const lockShopifyLifecycle = async (tx: Prisma.TransactionClient, shop: string) => {
  const [lock] = await tx.$queryRaw<Array<{acquired: boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext('drapixai-shopify-catalog'), hashtext(${shop})) AS acquired`;
  if (!lock?.acquired) throw new DatabaseLockBusy();
};

export const deactivateShopifyInstallation = async (prisma: PrismaClient, shop: string, status: 'uninstalled' | 'disconnected' | 'redacting') =>
  runDatabaseTransaction(prisma, async tx => {
    await lockShopifyLifecycle(tx, shop);
    await tx.shopifyTokenLease.deleteMany({where: {shopDomain: shop}});
    const current = await tx.shopifyInstallation.findUnique({where: {shopDomain: shop}});
    if (!current) return null;
    const nextStatus = current.status === 'redacting' ? 'redacting' : status;
    const installation = await tx.shopifyInstallation.update({where: {id: current.id}, data: {
      status: nextStatus, catalogEpoch: {increment: 1}, catalogLeaseOwner: null, catalogLeaseExpiresAt: null,
      catalogNextAttemptAt: null, encryptedAccessToken: '', encryptedRefreshToken: null,
      accessTokenExpiresAt: null, refreshTokenExpiresAt: null, linkTokenHash: null, linkTokenExpiresAt: null,
      ...(status === 'uninstalled' ? {uninstalledAt: new Date()} : {}),
    }});
    if (current.storefrontApiKeyId) await tx.apiKey.updateMany({where: {id: current.storefrontApiKeyId}, data: {isActive: false, revokedAt: new Date()}});
    if (current.userId) {
      const source = `shopify:${shop}`;
      const products = await tx.catalogProduct.findMany({where: {userId: current.userId, source}, select: {preparedGarmentId: true}});
      const ids = products.flatMap(p => p.preparedGarmentId ? [p.preparedGarmentId] : []);
      await tx.catalogProduct.updateMany({where: {userId: current.userId, source}, data: {status: 'archived'}});
      await tx.catalogProduct.updateMany({where: {userId: current.userId, source, preparationStatus: {not: 'reconciliation_required'}}, data: {preparationStatus: 'cancelled'}});
      if (ids.length) {
        await tx.garment.updateMany({where: {userId: current.userId, garmentId: {in: ids}}, data: {status: 'stale'}});
        await tx.garmentMatch.updateMany({where: {userId: current.userId, garmentId: {in: ids}}, data: {confirmedProductId: null, status: 'unmatched'}});
      }
    }
    await tx.shopifySyncRun.updateMany({where: {installationId: current.id, status: 'running'}, data: {status: 'cancelled', errorCode: 'SHOPIFY_INSTALLATION_NOT_ACTIVE', completedAt: new Date()}});
    return installation;
  });

export const requireActiveShopifyCatalog = async (tx: Prisma.TransactionClient, id: number, shop: string, epoch: number, userId: number) => {
  await lockShopifyLifecycle(tx, shop);
  const current = await tx.shopifyInstallation.findUnique({where: {id}});
  if (!current || current.shopDomain !== shop || current.status !== 'active' || current.catalogEpoch !== epoch || current.userId !== userId) throw new Error('SHOPIFY_CATALOG_STATE_CHANGED');
  return current;
};
