import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { issueStorefrontToken } from '../lib/api-key-auth';
import {
  normalizeOriginHost,
  normalizeShopDomain,
  verifyShopifyAppProxyQuery,
} from '../lib/shopify-auth';
import { getShopifyStorefrontConfig, getShopifyStorefrontSessionConfig } from '../services/shopify';
import { resolveConfirmedGarmentForProduct } from '../lib/catalog-matching';

const router = Router();
const prisma = new PrismaClient();

router.options('/storefront/config', async (req, res) => {
  const shop = normalizeShopDomain(req.query.shop);
  const origin = String(req.headers.origin || '');
  const originHost = normalizeOriginHost(origin);
  const installation = shop ? await prisma.shopifyInstallation.findUnique({ where: { shopDomain: shop } }) : null;
  const allowed = installation && originHost && [installation.shopDomain, installation.primaryDomain].filter(Boolean).includes(originHost);
  if (!allowed) return res.status(403).end();
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  return res.status(204).end();
});

router.get('/storefront/config', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(410).json({ error: 'SHOPIFY_APP_PROXY_REQUIRED' });
  }
  const shop = normalizeShopDomain(req.query.shop);
  const origin = String(req.headers.origin || '');
  const originHost = normalizeOriginHost(origin);
  if (!shop || !originHost) return res.status(400).json({ error: 'INVALID_STOREFRONT_REQUEST' });
  const installation = await prisma.shopifyInstallation.findUnique({ where: { shopDomain: shop } });
  if (!installation || ![installation.shopDomain, installation.primaryDomain].filter(Boolean).includes(originHost)) {
    return res.status(403).json({ error: 'STOREFRONT_NOT_AUTHORIZED' });
  }
  const config = await getShopifyStorefrontConfig(prisma, shop);
  if (!config) return res.status(404).json({ error: 'SHOPIFY_INSTALLATION_NOT_READY' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store, private');
  return res.json({ sdkUrl: config.sdkUrl, baseUrl: config.apiBaseUrl, apiKey: config.apiKey, quality: 'standard' });
});

router.get(['/storefront/proxy', '/storefront/proxy/'], async (req, res) => {
  const rawQuery = req.originalUrl.split('?')[1] || '';
  if (!verifyShopifyAppProxyQuery(rawQuery)) {
    return res.status(401).json({ error: 'INVALID_SHOPIFY_APP_PROXY_SIGNATURE' });
  }
  const shop = normalizeShopDomain(req.query.shop);
  if (!shop) return res.status(400).json({ error: 'INVALID_SHOP_DOMAIN' });
  const productId = String(req.query.product_id || req.query.productId || '').trim();
  if (!productId) return res.status(400).json({ error: 'PRODUCT_ID_REQUIRED' });
  const config = await getShopifyStorefrontSessionConfig(prisma, shop);
  if (!config) return res.status(404).json({ error: 'SHOPIFY_INSTALLATION_NOT_READY' });
  const garment = await resolveConfirmedGarmentForProduct(prisma, config.userId, productId);
  if (!garment) return res.status(409).json({ error: 'PRODUCT_NOT_DRAPIXAI_READY' });

  const token = issueStorefrontToken({
    apiKeyId: config.apiKeyId,
    userId: config.userId,
    shopDomain: config.shopDomain,
    allowedDomain: config.allowedDomain,
    productIds: [productId],
  });
  res.setHeader('Cache-Control', 'no-store, private');
  return res.json({
    sdkUrl: config.sdkUrl,
    baseUrl: config.apiBaseUrl,
    token,
    quality: 'standard',
    expiresInSeconds: 300,
  });
});

export default router;
