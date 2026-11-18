import { PrismaClient, ShopifyInstallation } from '@prisma/client';
import crypto from 'crypto';
import { generateApiKey, hashApiKey } from '../lib/api-key-auth';
import { CatalogSyncInputItem } from '../lib/catalog-feed';
import { recomputeGarmentMatchesForUser, upsertCatalogProductsForUser } from '../lib/catalog-matching';
import { decryptShopifySecret, encryptShopifySecret } from '../lib/shopify-crypto';
import { queueShopifyCatalogPreparation } from './catalog-preparation';
import { normalizeShopDomain } from '../lib/shopify-auth';
import { DatabaseLockBusy, runDatabaseTransaction } from '../lib/database-transaction';
import { getShopifyAccessToken, requestShopifyOfflineTokens } from './shopify-tokens';
import { lockShopifyLifecycle, requireActiveShopifyCatalog } from './shopify-catalog-state';

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

const readShopifyJson = async (response: Response) => {
  const limit = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('SHOPIFY_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('SHOPIFY_RESPONSE_INVALID');
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('SHOPIFY_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
};

const shopifyGraphql = async <T>(shop: string, accessToken: string, query: string, variables?: Record<string, unknown>, timeoutMs = 30000) => {
  if (normalizeShopDomain(shop) !== shop) throw new Error('SHOPIFY_SHOP_DOMAIN_INVALID');
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(30000, timeoutMs))),
  });
  const payload = (await readShopifyJson(response)) as ShopifyGraphqlResponse<T> | null;
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error('SHOPIFY_GRAPHQL_FAILED');
  }
  return payload.data;
};

export const exchangeShopifyCode = async (shop: string, code: string) => {
  return requestShopifyOfflineTokens(shop, {code});
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
  return runDatabaseTransaction(prisma, async (transaction) => {
  await lockShopifyLifecycle(transaction, installation.shopDomain);
  const [lock] = await transaction.$queryRaw<Array<{acquired: boolean}>>`SELECT pg_try_advisory_xact_lock(hashtext('drapixai-shopify-link'), ${installation.id}::integer) AS acquired`;
  if (!lock?.acquired) throw new DatabaseLockBusy();
  const current = await transaction.shopifyInstallation.findUnique({where: {id: installation.id}});
  if (!current || !current.linkTokenHash || current.linkTokenHash !== installation.linkTokenHash
    || !current.linkTokenExpiresAt || current.linkTokenExpiresAt <= new Date()
    || !['pending_link', 'active'].includes(current.status) || !current.encryptedAccessToken) {
    throw new Error('SHOPIFY_LINK_EXPIRED');
  }
  if (current.userId && current.userId !== userId) throw new Error('SHOPIFY_LINK_ALREADY_OWNED');
  const consumed = await transaction.shopifyInstallation.updateMany({
    where: {id: current.id, linkTokenHash: current.linkTokenHash, linkTokenExpiresAt: {gt: new Date()},
      status: {in: ['pending_link', 'active']}, OR: [{userId: null}, {userId}]},
    data: {linkTokenHash: null, linkTokenExpiresAt: null},
  });
  if (consumed.count !== 1) throw new Error('SHOPIFY_LINK_EXPIRED');
  const allowedDomain = current.primaryDomain || current.shopDomain;
  let apiKeyId = current.storefrontApiKeyId;
  let encryptedStorefrontKey = current.encryptedStorefrontKey;

  if (!apiKeyId || !encryptedStorefrontKey) {
    const storefrontKey = generateApiKey();
    const apiKey = await transaction.apiKey.create({
      data: {
        userId,
        keyHash: hashApiKey(storefrontKey),
        kind: 'shopify',
        label: current.shopDomain,
        domainWhitelist: allowedDomain,
      },
    });
    apiKeyId = apiKey.id;
    encryptedStorefrontKey = encryptShopifySecret(storefrontKey);
  } else {
    const existingKey = await transaction.apiKey.findFirst({where: {id: apiKeyId, userId}});
    if (!existingKey) throw new Error('SHOPIFY_LINK_KEY_OWNER_MISMATCH');
    await transaction.apiKey.update({
      where: { id: apiKeyId },
      data: { kind: 'shopify', label: current.shopDomain, domainWhitelist: allowedDomain, isActive: true, revokedAt: null, expiresAt: null },
    });
  }

    const linked = await transaction.shopifyInstallation.update({
      where: { id: current.id },
      data: {
        userId,
        status: 'active',
        linkedAt: new Date(),
        uninstalledAt: null,
        linkTokenHash: null,
        linkTokenExpiresAt: null,
        storefrontApiKeyId: apiKeyId,
        encryptedStorefrontKey,
        catalogRequestedVersion: {increment: 1},
        catalogNextAttemptAt: new Date(),
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
  deadline: number,
) => {
  if (!initialCursor) throw new Error('SHOPIFY_VARIANT_PAGINATION_INVALID');
  const variants: ShopifyVariantNode[] = [];
  let cursor: string | null = initialCursor;
  let hasNextPage = Boolean(cursor);
  const cursors = new Set(cursor ? [cursor] : []); let pages = 0;
  while (hasNextPage) {
    if (++pages > 100 || Date.now() >= deadline) throw new Error('SHOPIFY_VARIANT_PAGINATION_LIMIT');
    const data: {product: {variants: {nodes: ShopifyVariantNode[]; pageInfo: {hasNextPage: boolean; endCursor?: string | null}}} | null} = await shopifyGraphql<{
      product: { variants: { nodes: ShopifyVariantNode[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } } | null;
    }>(shop, accessToken, `query DrapixAIProductVariants($productId: ID!, $cursor: String) {
      product(id: $productId) {
        variants(first: 100, after: $cursor) {
          nodes { legacyResourceId title image { url } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { productId, cursor }, deadline - Date.now());
    if (!data.product) throw new Error('SHOPIFY_CATALOG_CHANGED_RETRY');
    variants.push(...data.product.variants.nodes);
    if (variants.length > 10000) throw new Error('SHOPIFY_VARIANT_PAGINATION_LIMIT');
    hasNextPage = data.product.variants.pageInfo.hasNextPage;
    cursor = data.product.variants.pageInfo.endCursor || null;
    if (hasNextPage && (!cursor || cursors.has(cursor))) throw new Error('SHOPIFY_VARIANT_PAGINATION_INVALID');
    if (cursor) cursors.add(cursor);
  }
  return variants;
};

export const syncShopifyCatalog = async (
  prisma: PrismaClient,
  installationId: number,
  trigger = 'manual',
) => {
  const initial = await prisma.shopifyInstallation.findUnique({where: {id: installationId}});
  if (!initial?.userId) throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
  const owner = crypto.randomUUID();
  const claim = await runDatabaseTransaction(prisma, async tx => {
    await lockShopifyLifecycle(tx, initial.shopDomain);
    const current = await tx.shopifyInstallation.findUnique({where: {id: installationId}});
    if (!current?.userId || current.status !== 'active') throw new Error('SHOPIFY_INSTALLATION_NOT_ACTIVE');
    const requested = trigger === 'scheduled' ? current.catalogRequestedVersion : current.catalogRequestedVersion + 1;
    await tx.shopifyInstallation.update({where: {id: current.id}, data: {catalogRequestedVersion: requested}});
    if (current.catalogLeaseOwner && current.catalogLeaseExpiresAt && current.catalogLeaseExpiresAt > new Date()) return null;
    await tx.shopifySyncRun.updateMany({where: {installationId, status: 'running'}, data: {status: 'failed', errorCode: 'SHOPIFY_SYNC_INTERRUPTED', completedAt: new Date()}});
    const installation = await tx.shopifyInstallation.update({where: {id: installationId}, data: {
      catalogLeaseOwner: owner, catalogLeaseExpiresAt: new Date(Date.now() + 180000),
      catalogSyncAttempts: {increment: 1}, lastSyncStatus: 'SYNCING',
    }});
    const run = await tx.shopifySyncRun.create({data: {installationId, trigger}});
    return {installation, run, requested};
  });
  if (!claim) throw new Error('SHOPIFY_SYNC_BUSY');
  const {installation, run: syncRun, requested} = claim;
  const userId = installation.userId!;

  try {
    const accessToken = await getShopifyAccessToken(prisma, installation.id);
    const sourceItems: CatalogSyncInputItem[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    const cursors = new Set<string>(); let pages = 0; const deadline = Date.now() + 120000;

    while (hasNextPage) {
      if (++pages > 100 || Date.now() > deadline) throw new Error('SHOPIFY_CATALOG_PAGINATION_LIMIT');
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
        deadline - Date.now(),
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
        if (sourceItems.length > 10000) throw new Error('SHOPIFY_CATALOG_PAGINATION_LIMIT');
        const variants = [...product.variants.nodes];
        if (product.variants.pageInfo.hasNextPage) {
          variants.push(...await fetchRemainingProductVariants(
            installation.shopDomain,
            accessToken,
            product.id,
            product.variants.pageInfo.endCursor || null,
            deadline,
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
          if (sourceItems.length > 10000) throw new Error('SHOPIFY_CATALOG_PAGINATION_LIMIT');
        }
      }

      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor || null;
      if (hasNextPage && (!cursor || cursors.has(cursor))) throw new Error('SHOPIFY_CATALOG_PAGINATION_INVALID');
      if (cursor) cursors.add(cursor);
    }

    // Fetch the complete bounded snapshot outside SQL, then atomically commit
    // only while this owner still holds the same active installation epoch.
    return await runDatabaseTransaction(prisma, async tx => {
    const current = await requireActiveShopifyCatalog(tx, installation.id, installation.shopDomain, installation.catalogEpoch, userId);
    if (current.catalogLeaseOwner !== owner || !current.catalogLeaseExpiresAt || current.catalogLeaseExpiresAt <= new Date()) throw new Error('SHOPIFY_SYNC_LEASE_LOST');
    const source = `shopify:${installation.shopDomain}`;
    const result = await upsertCatalogProductsForUser(tx, userId, sourceItems, source, false);
    const discoveredIds = result.discovered.map((item) => item.productId);
    const preparation = await queueShopifyCatalogPreparation(tx, userId, discoveredIds);
    await tx.catalogProduct.updateMany({
      where: {
        userId,
        source,
        ...(discoveredIds.length > 0 ? { productId: { notIn: discoveredIds } } : {}),
      },
      data: { status: 'archived', preparationStatus: 'cancelled' },
    });
    await recomputeGarmentMatchesForUser(tx, userId);
    await tx.shopifySyncRun.update({
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
      });
    await tx.shopifyInstallation.update({
        where: { id: installation.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: `SYNCED_${result.discovered.length}_SKIPPED_${result.skipped.length}`,
          catalogSyncedVersion: requested, catalogLeaseOwner: null, catalogLeaseExpiresAt: null, catalogSyncAttempts: 0,
          catalogNextAttemptAt: current.catalogRequestedVersion > requested ? new Date() : null },
      });
    await tx.user.update({
        where: { id: userId },
        data: { catalogLastSyncedAt: new Date(), catalogLastSyncStatus: `SYNCED_${result.discovered.length}_SKIPPED_${result.skipped.length}` },
      });
    return {
      seen: sourceItems.length,
      eligible: result.discovered.length,
      ready: preparation.alreadyPrepared,
      queued: preparation.queued,
      missingImage: preparation.missingImage,
      skipped: result.skipped.length,
      deferred: preparation.deferred,
    };
    });
  } catch (error) {
    await runDatabaseTransaction(prisma, async tx => {
      await lockShopifyLifecycle(tx, installation.shopDomain);
      const current = await tx.shopifyInstallation.findUnique({where: {id: installation.id}});
      if (!current || current.catalogEpoch !== installation.catalogEpoch || current.catalogLeaseOwner !== owner) return;
      await tx.shopifySyncRun.updateMany({
        where: { id: syncRun.id, status: 'running' },
        data: { status: 'failed', errorCode: error instanceof Error && /^SHOPIFY_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SHOPIFY_SYNC_FAILED', completedAt: new Date() },
      });
      await tx.shopifyInstallation.update({
        where: { id: installation.id },
        data: { lastSyncStatus: 'FAILED', catalogLeaseOwner: null, catalogLeaseExpiresAt: null,
          catalogNextAttemptAt: new Date(Date.now() + Math.min(900000, 30000 * 2 ** Math.min(5, installation.catalogSyncAttempts - 1))) },
      });
    });
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
  await runDatabaseTransaction(prisma, async tx => {
    await lockShopifyLifecycle(tx, shopDomain);
    const installation = await tx.shopifyInstallation.findUnique({where: {shopDomain}});
    if (!installation || installation.status !== 'active') return;
    await tx.shopifyInstallation.update({where: {id: installation.id}, data: {
      lastSyncStatus: `WEBHOOK_${trigger}_PENDING`, catalogRequestedVersion: {increment: 1},
      catalogNextAttemptAt: installation.catalogNextAttemptAt || new Date(),
    }});
  });
};

export const processPendingShopifySyncs = async (prisma: PrismaClient) => {
  const now = new Date();
  const installations = await prisma.shopifyInstallation.findMany({where: {
    status: 'active', catalogRequestedVersion: {gt: prisma.shopifyInstallation.fields.catalogSyncedVersion},
    AND: [{OR: [{catalogNextAttemptAt: null}, {catalogNextAttemptAt: {lte: now}}]},
      {OR: [{catalogLeaseOwner: null}, {catalogLeaseExpiresAt: {lte: now}}]}],
  }, orderBy: [{catalogNextAttemptAt: 'asc'}, {id: 'asc'}], take: 20, select: {id: true}});
  for (const installation of installations) await syncShopifyCatalog(prisma, installation.id, 'scheduled').catch(() => undefined);
};
