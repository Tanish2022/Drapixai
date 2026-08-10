import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient, ShopifyInstallation } from '@prisma/client';
import { removeLocalStoredFile } from '../lib/security';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { aiFetch } from '../lib/ai-client';

const AI_URL = (process.env.DRAPIXAI_AI_URL || 'http://localhost:8080').replace(/\/+$/, '');
const AI_SERVICE_TOKEN = (process.env.DRAPIXAI_AI_SERVICE_TOKEN || '').trim();
const storage = createStorageClient();

const deleteAiCache = async (cacheKey: string | null) => {
  if (!cacheKey) return;
  const response = await aiFetch(`${AI_URL}/ai/garment/cache/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AI_SERVICE_TOKEN ? { 'x-drapixai-service-token': AI_SERVICE_TOKEN } : {}),
    },
    body: JSON.stringify({ cache_key: cacheKey }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('SHOPIFY_AI_CACHE_DELETE_FAILED');
};

const deleteStoredGarmentAsset = async (storedUrl: string | null) => {
  if (!storedUrl) return;
  if (storedUrl.startsWith('local:')) {
    removeLocalStoredFile(storedUrl, 'garments');
    return;
  }
  if (!storedUrl.startsWith('s3://')) return;

  const location = new URL(storedUrl);
  const key = location.pathname.replace(/^\/+/, '');
  if (location.hostname !== STORAGE_BUCKET || !key.startsWith('garments/') || key.includes('..')) {
    throw new Error('SHOPIFY_STORED_ASSET_OUTSIDE_GARMENT_PREFIX');
  }
  await storage.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
};

export const redactShopifyInstallationData = async (
  prisma: PrismaClient,
  installation: ShopifyInstallation,
) => {
  const shopSource = `shopify:${installation.shopDomain}`;
  const catalogProducts = installation.userId
    ? await prisma.catalogProduct.findMany({
        where: { userId: installation.userId, source: shopSource },
        select: { preparedGarmentId: true },
      })
    : [];
  const garmentIds = [...new Set(
    catalogProducts
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

  await prisma.$transaction(async (transaction) => {
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
    if (installation.storefrontApiKeyId) {
      await transaction.apiKey.deleteMany({ where: { id: installation.storefrontApiKeyId } });
    }
    await transaction.shopifyWebhookEvent.updateMany({
      where: { shopDomain: installation.shopDomain },
      data: { shopDomain: 'redacted.invalid' },
    });
  });
};
