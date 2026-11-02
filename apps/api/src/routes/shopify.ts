import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import {
  SHOPIFY_STATE_COOKIE,
  createShopifyState,
  generateLinkToken,
  hashLinkToken,
  normalizeShopDomain,
  readCookie,
  verifyShopifyQueryHmac,
  verifyShopifyState,
} from '../lib/shopify-auth';
import { assertShopifyTokenLease, encryptedShopifyTokenData, withShopifyTokenLease } from '../services/shopify-tokens';
import { runDatabaseTransaction } from '../lib/database-transaction';
import { formatLogError } from '../lib/security';
import { requireTryOnIntake } from '../lib/tryon-intake';
import { processShopifyCatalogPreparationBatch, retryShopifyPreparation } from '../services/catalog-preparation';
import { deactivateShopifyInstallation, lockShopifyLifecycle } from '../services/shopify-catalog-state';
import {
  buildShopifyThemeEditorUrl,
  exchangeShopifyCode,
  fetchShopifyShop,
  linkShopifyInstallation,
  syncShopifyCatalog,
} from '../services/shopify';

const router = Router();
const prisma = new PrismaClient();
const scopes = (process.env.SHOPIFY_SCOPES || 'read_products,write_app_proxy').split(',').map((value) => value.trim()).filter(Boolean).join(',');
const useLegacyInstallFlow = process.env.SHOPIFY_USE_LEGACY_INSTALL_FLOW === '1';
const publicApiBaseUrl = (process.env.DRAPIXAI_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
const webBaseUrl = (process.env.DRAPIXAI_WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const requireShopifyConfig = () => {
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !publicApiBaseUrl) {
    throw new Error('SHOPIFY_CONFIGURATION_INCOMPLETE');
  }
};

const authMiddleware = async (req: any, res: any, next: any) => {
  const apiKey = await resolveActiveApiKey(prisma, req.headers.authorization);
  if (!apiKey) return res.status(401).json({ error: 'INVALID_API_KEY' });
  if (apiKey.kind !== 'dashboard') return res.status(403).json({ error: 'DASHBOARD_KEY_REQUIRED' });
  const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
  if (!user) return res.status(401).json({ error: 'INVALID_API_KEY' });
  req.apiKey = apiKey;
  req.user = user;
  return next();
};

router.get('/install', (req, res) => {
  try {
    requireShopifyConfig();
    const shop = normalizeShopDomain(req.query.shop);
    if (!shop) return res.status(400).json({ error: 'INVALID_SHOP_DOMAIN' });
    const rawQuery = req.originalUrl.split('?')[1] || '';
    if ((process.env.NODE_ENV === 'production' || req.query.hmac) && !verifyShopifyQueryHmac(rawQuery)) {
      return res.status(401).json({ error: 'INVALID_SHOPIFY_SIGNATURE' });
    }

    const { state, nonce } = createShopifyState(shop);
    res.cookie(SHOPIFY_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/shopify',
    });
    const redirectUri = `${publicApiBaseUrl}/shopify/callback`;
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set('client_id', process.env.SHOPIFY_API_KEY || '');
    if (useLegacyInstallFlow) authorize.searchParams.set('scope', scopes);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);
    return res.redirect(authorize.toString());
  } catch (error) {
    console.error('Shopify install error:', formatLogError(error));
    return res.status(500).json({ error: 'SHOPIFY_INSTALL_FAILED' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    requireShopifyConfig();
    const shop = normalizeShopDomain(req.query.shop);
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const rawQuery = req.originalUrl.split('?')[1] || '';
    const statePayload = verifyShopifyState(state);
    const cookieNonce = readCookie(req.headers.cookie, SHOPIFY_STATE_COOKIE);
    if (!shop || !code || !statePayload || statePayload.shop !== shop || cookieNonce !== statePayload.nonce) {
      return res.status(401).json({ error: 'INVALID_SHOPIFY_STATE' });
    }
    if (!verifyShopifyQueryHmac(rawQuery)) {
      return res.status(401).json({ error: 'INVALID_SHOPIFY_SIGNATURE' });
    }

    const {installation, linkToken} = await withShopifyTokenLease(prisma, shop, async lease => {
    const tokens = await exchangeShopifyCode(shop, code);
    const { accessToken, scopes: grantedScopes } = tokens;
    const granted = new Set(grantedScopes.split(',').map((value) => value.trim()).filter(Boolean));
    const missingScopes = scopes.split(',').filter((scope) => !granted.has(scope));
    if (missingScopes.length > 0) throw new Error('SHOPIFY_REQUIRED_SCOPES_MISSING');
    const shopInfo = await fetchShopifyShop(shop, accessToken);
    const linkToken = generateLinkToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const installation = await runDatabaseTransaction(prisma, async transaction => {
    await lockShopifyLifecycle(transaction, shop);
    await assertShopifyTokenLease(transaction, lease);
    const existing = await transaction.shopifyInstallation.findUnique({ where: { shopDomain: shop } });
    if (existing?.status === 'redacting') throw new Error('SHOPIFY_REDACTION_PENDING');
    return transaction.shopifyInstallation.upsert({
      where: { shopDomain: shop },
      update: {
        catalogEpoch: {increment: 1}, catalogRequestedVersion: {increment: 1}, catalogNextAttemptAt: new Date(),
        catalogLeaseOwner: null, catalogLeaseExpiresAt: null,
        shopName: shopInfo.name,
        primaryDomain: shopInfo.primaryDomain,
        ...encryptedShopifyTokenData(tokens),
        status: existing?.userId ? 'active' : 'pending_link',
        installedAt: new Date(),
        uninstalledAt: null,
        linkTokenHash: hashLinkToken(linkToken),
        linkTokenExpiresAt: expiresAt,
      },
      create: {
        shopDomain: shop,
        shopName: shopInfo.name,
        primaryDomain: shopInfo.primaryDomain,
        ...encryptedShopifyTokenData(tokens),
        linkTokenHash: hashLinkToken(linkToken),
        linkTokenExpiresAt: expiresAt,
      },
    });
    });
    return {installation, linkToken};
    });

    res.clearCookie(SHOPIFY_STATE_COOKIE, { path: '/shopify' });
    const redirect = new URL('/shopify/connect', webBaseUrl);
    redirect.searchParams.set('installation', String(installation.id));
    redirect.searchParams.set('token', linkToken);
    return res.redirect(redirect.toString());
  } catch (error) {
    console.error('Shopify callback error:', formatLogError(error));
    const redirect = new URL('/shopify/connect', webBaseUrl);
    redirect.searchParams.set('error', 'SHOPIFY_AUTH_FAILED');
    return res.redirect(redirect.toString());
  }
});

router.post('/link-preview', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  const id = Number(req.body?.installationId), token = req.body?.token;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof token !== 'string' || token.length > 256) return res.status(400).json({error:'SHOPIFY_LINK_INVALID'});
  const installation = await prisma.shopifyInstallation.findUnique({where:{id}});
  if (!installation || !['pending_link','active'].includes(installation.status) || !installation.linkTokenHash
    || !installation.linkTokenExpiresAt || installation.linkTokenExpiresAt <= new Date()) return res.status(400).json({error:'SHOPIFY_LINK_EXPIRED'});
  if (installation.linkTokenHash !== hashLinkToken(token)) return res.status(403).json({error:'SHOPIFY_LINK_INVALID'});
  if (installation.userId && installation.userId !== req.user.id) return res.status(409).json({error:'SHOPIFY_STORE_ALREADY_LINKED'});
  return res.set('Cache-Control','no-store').json({shopDomain:installation.shopDomain});
});

router.post('/link', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  try {
    const installationId = Number(req.body?.installationId);
    const token = String(req.body?.token || '');
    const installation = await prisma.shopifyInstallation.findUnique({ where: { id: installationId } });
    if (!installation || !token || !installation.linkTokenHash || installation.linkTokenExpiresAt && installation.linkTokenExpiresAt < new Date()) {
      return res.status(400).json({ error: 'SHOPIFY_LINK_EXPIRED' });
    }
    if (installation.linkTokenHash !== hashLinkToken(token)) {
      return res.status(403).json({ error: 'SHOPIFY_LINK_INVALID' });
    }
    if (installation.userId && installation.userId !== req.user.id) {
      return res.status(409).json({ error: 'SHOPIFY_STORE_ALREADY_LINKED' });
    }

    const linked = await linkShopifyInstallation(prisma, installation, req.user.id);
    // Linking is already committed; a provider outage leaves durable sync work.
    const sync = await syncShopifyCatalog(prisma, linked.id, 'initial_link').catch(() => ({status: 'pending'}));
    return res.json({
      ok: true,
      shop: linked.shopDomain,
      sync,
      themeEditorUrl: buildShopifyThemeEditorUrl(linked.shopDomain),
    });
  } catch (error) {
    console.error('Shopify link error:', formatLogError(error));
    return res.status(500).json({ error: 'SHOPIFY_LINK_FAILED' });
  }
});

router.get('/status', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  const installation = await prisma.shopifyInstallation.findFirst({
    where: { userId: req.user.id, status: { not: 'deleted' } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, shopDomain: true, shopName: true, primaryDomain: true, status: true,
      installedAt: true, linkedAt: true, lastSyncedAt: true, lastSyncStatus: true,
    },
  });
  return res.json({
    installation: installation
      ? { ...installation, themeEditorUrl: buildShopifyThemeEditorUrl(installation.shopDomain) }
      : null,
  });
});

router.post('/sync', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  try {
    const installation = await prisma.shopifyInstallation.findFirst({ where: { userId: req.user.id, status: 'active' } });
    if (!installation) return res.status(404).json({ error: 'SHOPIFY_INSTALLATION_NOT_FOUND' });
    return res.json({ ok: true, ...(await syncShopifyCatalog(prisma, installation.id, 'dashboard')) });
  } catch (error) {
    console.error('Shopify sync error:', formatLogError(error));
    if (error instanceof Error && error.message === 'SHOPIFY_SYNC_BUSY') return res.status(202).set('Retry-After','5').json({ok:true,status:'pending'});
    return res.status(500).json({ error: 'SHOPIFY_SYNC_FAILED' });
  }
});

router.get('/preparation', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  const [groups, failures] = await Promise.all([
    prisma.catalogProduct.groupBy({
      by: ['preparationStatus'],
      where: { userId: req.user.id, source: { startsWith: 'shopify:' }, isVariant: false, status: { not: 'archived' } },
      _count: { _all: true },
    }),
    prisma.catalogProduct.findMany({
      where: {
        userId: req.user.id,
        source: { startsWith: 'shopify:' },
        isVariant: false,
        preparationStatus: {in: ['failed', 'reconciliation_required']},
      },
      select: { productId: true, productName: true, preparationError: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
  ]);
  const counts = Object.fromEntries(groups.map((group) => [group.preparationStatus, group._count._all]));
  return res.json({ counts, failures });
});

router.post('/prepare', authMiddleware, requireDashboardProxy, requireTryOnIntake, async (req: any, res) => {
  try {
    const requestedLimit = Number(req.body?.limit || 3);
    const result = await processShopifyCatalogPreparationBatch(prisma, requestedLimit, req.user.id);
    return res.json({ ok: true, busy: result.busy, processed: result.items.length, items: result.items });
  } catch (error) {
    console.error('Shopify preparation error:', formatLogError(error));
    return res.status(503).json({
      error: 'SHOPIFY_PREPARATION_UNAVAILABLE',
      message: 'Garment preparation is temporarily unavailable. Queued products remain safe and can be retried when the AI worker is ready.',
    });
  }
});

router.post('/preparation/retry', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  const productId = String(req.body?.productId || '').trim();
  const result = await retryShopifyPreparation(prisma, req.user.id, productId || undefined);
  return res.json({ok: true, ...result});
});

router.delete('/disconnect', authMiddleware, requireDashboardProxy, async (req: any, res) => {
  const installation = await prisma.shopifyInstallation.findFirst({ where: { userId: req.user.id, status: 'active' } });
  if (!installation) return res.status(404).json({ error: 'SHOPIFY_INSTALLATION_NOT_FOUND' });
  await deactivateShopifyInstallation(prisma, installation.shopDomain, 'disconnected');
  return res.json({ ok: true });
});

export default router;
