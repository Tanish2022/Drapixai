import { PrismaClient, ShopifyInstallation } from '@prisma/client';
import { generateApiKey, hashApiKey } from '../lib/api-key-auth';
import { CatalogSyncInputItem } from '../lib/catalog-feed';
import { recomputeGarmentMatchesForUser, upsertCatalogProductsForUser } from '../lib/catalog-matching';
import { decryptShopifySecret, encryptShopifySecret } from '../lib/shopify-crypto';
import { queueShopifyCatalogPreparation } from './catalog-preparation';

const API_VERSION = (process.env.SHOPIFY_API_VERSION || '2026-07').trim();
const WEB_BASE_URL = (process.env.DRAPIXAI_WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const buildShopifyThemeEditorUrl = (shopDomain: string) => {
  const clientId = (process.env.SHOPIFY_API_KEY || '').trim();
  if (!clientId) return null;
  const url = new URL(`https://${shopDomain}/admin/themes/current/editor`);
  url.searchParams.set('template', 'product');
  url.searchParams.set('addAppBlockId', `${clientId}/tryon-button`);
  url.searchParams.set('target', 'mainSection');
  return url.toString();
};

type ShopifyGraphqlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

const shopifyGraphql = async <T>(shop: string, accessToken: string, query: string, variables?: Record<string, unknown>) => {
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = (await response.json().catch(() => null)) as ShopifyGraphqlResponse<T> | null;
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error('SHOPIFY_GRAPHQL_FAILED');
  }
  return payload.data;
};

export const exchangeShopifyCode = async (shop: string, code: string) => {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json().catch(() => null)) as { access_token?: string; scope?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error('SHOPIFY_TOKEN_EXCHANGE_FAILED');
  return { accessToken: payload.access_token, scopes: payload.scope || '' };
};

export const fetchShopifyShop = async (shop: string, accessToken: string) => {
  const data = await shopifyGraphql<{
    shop: { name: string; primaryDomain?: { host?: string; url?: string } | null };
  }>(shop, accessToken, `query DrapixAIShop { shop { name primaryDomain { host url } } }`);
  return {
    name: data.shop.name,
    primaryDomain: data.shop.primaryDomain?.host || shop,
  };
};

export const linkShopifyInstallation = async (
  prisma: PrismaClient,
  installation: ShopifyInstallation,
  userId: number,
) => {
  const allowedDomain = installation.primaryDomain || installation.shopDomain;
  let apiKeyId = installation.storefrontApiKeyId;
  let encryptedStorefrontKey = installation.encryptedStorefrontKey;

  if (!apiKeyId || !encryptedStorefrontKey) {
    const storefrontKey = generateApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        keyHash: hashApiKey(storefrontKey),
        kind: 'shopify',
        label: installation.shopDomain,
        domainWhitelist: allowedDomain,
      },
    });
    apiKeyId = apiKey.id;
    encryptedStorefrontKey = encryptShopifySecret(storefrontKey);
  } else {
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { userId, kind: 'shopify', label: installation.shopDomain, domainWhitelist: allowedDomain, isActive: true },
    });
  }

  return prisma.$transaction(async (transaction) => {
    const linked = await transaction.shopifyInstallation.update({
      where: { id: installation.id },
      data: {
        userId,
        status: 'active',
        linkedAt: new Date(),
        uninstalledAt: null,
        linkTokenHash: null,
        linkTokenExpiresAt: null,
        storefrontApiKeyId: apiKeyId,
        encryptedStorefrontKey,
      },
    });
    await transaction.user.update({
      where: { id: userId },
      data: {
        storeVerifiedAt: new Date(),
        catalogSyncSource: 'shopify',
      },
    });
    return linked;
  });
};

type ShopifyProductNode = {
  id: string;
  legacyResourceId: string;
  title: string;
  productType?: string;
  featuredImage?: { url?: string } | null;
  variants: {
    nodes: ShopifyVariantNode[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

type ShopifyVariantNode = {
  legacyResourceId: string;
  title: string;
  image?: { url?: string } | null;
};

const fetchRemainingProductVariants = async (
  shop: string,
  accessToken: string,
  productId: string,
  initialCursor: string | null,
) => {
  const variants: ShopifyVariantNode[] = [];
  let cursor = initialCursor;
  let hasNextPage = Boolean(cursor);
  while (hasNextPage) {
    const data = await shopifyGraphql<{
      product: { variants: { nodes: ShopifyVariantNode[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } } | null;
    }>(shop, accessToken, `query DrapixAIProductVariants($productId: ID!, $cursor: String) {
      product(id: $productId) {
        variants(first: 100, after: $cursor) {
          nodes { legacyResourceId title image { url } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { productId, cursor });
    if (!data.product) break;
    variants.push(...data.product.variants.nodes);
    hasNextPage = data.product.variants.pageInfo.hasNextPage;
    cursor = data.product.variants.pageInfo.endCursor || null;
  }
  return variants;
};

export const syncShopifyCatalog = async (
  prisma: PrismaClient,
  installationId: number,
  trigger = 'manual',
) => {
  const installation = await prisma.shopifyInstallation.findUnique({ where: { id: installationId } });
  if (!installation?.userId || installation.status !== 'active') throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
  const syncRun = await prisma.shopifySyncRun.create({ data: { installationId, trigger } });

  try {
    const accessToken = decryptShopifySecret(installation.encryptedAccessToken);
    const sourceItems: CatalogSyncInputItem[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: {
        products: {
          nodes: ShopifyProductNode[];
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      } = await shopifyGraphql(
        installation.shopDomain,
        accessToken,
        `query DrapixAIProducts($cursor: String) {
          products(first: 100, after: $cursor) {
            nodes {
              id legacyResourceId title productType featuredImage { url }
              variants(first: 100) {
                nodes { legacyResourceId title image { url } }
                pageInfo { hasNextPage endCursor }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { cursor },
      );

      for (const product of data.products.nodes) {
        const base: CatalogSyncInputItem = {
          productId: String(product.legacyResourceId),
          isVariant: false,
          productName: product.title,
          category: product.productType || product.title,
          imageUrl: product.featuredImage?.url || '',
        };
        sourceItems.push(base);
        const variants = [...product.variants.nodes];
        if (product.variants.pageInfo.hasNextPage) {
          variants.push(...await fetchRemainingProductVariants(
            installation.shopDomain,
            accessToken,
            product.id,
            product.variants.pageInfo.endCursor || null,
          ));
        }
        for (const variant of variants) {
          if (!variant.legacyResourceId || variant.title === 'Default Title') continue;
          sourceItems.push({
            ...base,
            productId: String(variant.legacyResourceId),
            parentProductId: String(product.legacyResourceId),
            isVariant: true,
            productName: `${product.title} - ${variant.title}`,
            imageUrl: variant.image?.url || base.imageUrl,
          });
        }
      }

      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor || null;
    }

    const source = `shopify:${installation.shopDomain}`;
    const result = await upsertCatalogProductsForUser(prisma, installation.userId, sourceItems, source);
    const discoveredIds = result.discovered.map((item) => item.productId);
    const preparation = await queueShopifyCatalogPreparation(prisma, installation.userId, discoveredIds);
    await prisma.catalogProduct.updateMany({
      where: {
        userId: installation.userId,
        source,
        ...(discoveredIds.length > 0 ? { productId: { notIn: discoveredIds } } : {}),
      },
      data: { status: 'archived' },
    });
    await recomputeGarmentMatchesForUser(prisma, installation.userId);

    await prisma.$transaction([
      prisma.shopifySyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'completed',
          productsSeen: sourceItems.length,
          productsReady: result.discovered.length,
          productsSkipped: result.skipped.length,
          productsQueued: preparation.queued,
          productsPrepared: preparation.alreadyPrepared,
          completedAt: new Date(),
        },
      }),
      prisma.shopifyInstallation.update({
        where: { id: installation.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: `SYNCED_${result.discovered.length}_SKIPPED_${result.skipped.length}` },
      }),
      prisma.user.update({
        where: { id: installation.userId },
        data: { catalogLastSyncedAt: new Date(), catalogLastSyncStatus: `SYNCED_${result.discovered.length}_SKIPPED_${result.skipped.length}` },
      }),
    ]);
    return {
      seen: sourceItems.length,
      eligible: result.discovered.length,
      ready: preparation.alreadyPrepared,
      queued: preparation.queued,
      missingImage: preparation.missingImage,
      skipped: result.skipped.length,
    };
  } catch (error) {
    await prisma.$transaction([
      prisma.shopifySyncRun.update({
        where: { id: syncRun.id },
        data: { status: 'failed', errorCode: error instanceof Error ? error.message : 'SHOPIFY_SYNC_FAILED', completedAt: new Date() },
      }),
      prisma.shopifyInstallation.update({
        where: { id: installation.id },
        data: { lastSyncStatus: 'FAILED' },
      }),
    ]);
    throw error;
  }
};

export const getShopifyStorefrontConfig = async (prisma: PrismaClient, shopDomain: string) => {
  const installation = await prisma.shopifyInstallation.findUnique({ where: { shopDomain } });
  if (!installation?.userId || installation.status !== 'active' || !installation.encryptedStorefrontKey) return null;
  return {
    apiKey: decryptShopifySecret(installation.encryptedStorefrontKey),
    sdkUrl: `${WEB_BASE_URL}/sdk.js`,
    apiBaseUrl: (process.env.DRAPIXAI_PUBLIC_API_BASE_URL || process.env.DRAPIXAI_API_BASE_URL || '').replace(/\/+$/, ''),
    primaryDomain: installation.primaryDomain || installation.shopDomain,
  };
};

export const getShopifyStorefrontSessionConfig = async (prisma: PrismaClient, shopDomain: string) => {
  const installation = await prisma.shopifyInstallation.findUnique({
    where: { shopDomain },
    select: {
      userId: true,
      shopDomain: true,
      primaryDomain: true,
      status: true,
      storefrontApiKeyId: true,
    },
  });
  if (
    !installation?.userId
    || installation.status !== 'active'
    || !installation.storefrontApiKeyId
  ) return null;
  return {
    userId: installation.userId,
    apiKeyId: installation.storefrontApiKeyId,
    shopDomain: installation.shopDomain,
    allowedDomain: installation.primaryDomain || installation.shopDomain,
    sdkUrl: `${WEB_BASE_URL}/sdk.js`,
    apiBaseUrl: (process.env.DRAPIXAI_PUBLIC_API_BASE_URL || process.env.DRAPIXAI_API_BASE_URL || '').replace(/\/+$/, ''),
  };
};

export const markShopifyCatalogDirty = async (prisma: PrismaClient, shopDomain: string, trigger: string) => {
  const installation = await prisma.shopifyInstallation.findUnique({ where: { shopDomain } });
  if (!installation) return;
  await prisma.shopifyInstallation.update({
    where: { id: installation.id },
    data: { lastSyncStatus: `WEBHOOK_${trigger}_PENDING` },
  });
  if (installation.userId && installation.status === 'active') {
    void syncShopifyCatalog(prisma, installation.id, `webhook:${trigger}`).catch(() => undefined);
  }
};
