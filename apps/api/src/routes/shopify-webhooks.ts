import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeShopDomain, verifyShopifyWebhookHmac } from '../lib/shopify-auth';
import { formatLogError } from '../lib/security';
import { markShopifyCatalogDirty } from '../services/shopify';
import { redactShopifyInstallationData } from '../services/shopify-redaction';
import { deactivateShopifyInstallation } from '../services/shopify-catalog-state';

const router = Router();
const prisma = new PrismaClient();

type WebhookClaim = {state: 'claimed'; receivedAt: Date} | {state: 'processed' | 'busy' | 'conflict'};
const claimWebhook = async (webhookId: string, shopDomain: string, topic: string): Promise<WebhookClaim> => {
  const existing = await prisma.shopifyWebhookEvent.findUnique({ where: { webhookId } });
  if (existing && (existing.topic !== topic || (existing.shopDomain !== shopDomain
    && !(existing.status === 'processed' && existing.shopDomain === 'redacted.invalid')))) return {state: 'conflict'};
  if (existing?.status === 'processed') return {state: 'processed'};
  const receivedAt = new Date();
  if (existing) {
    const claimed = await prisma.shopifyWebhookEvent.updateMany({
      where: {
        webhookId,
        shopDomain,
        topic,
        OR: [
          { status: { in: ['received', 'failed'] } },
          { status: 'processing', receivedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      data: { status: 'processing', receivedAt, errorCode: null, processedAt: null },
    });
    return claimed.count === 1 ? {state: 'claimed', receivedAt} : {state: 'busy'};
  }

  try {
    await prisma.shopifyWebhookEvent.create({
      data: { webhookId, shopDomain, topic, status: 'processing', receivedAt },
    });
    return {state: 'claimed', receivedAt};
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return {state: 'busy'};
    throw error;
  }
};

router.post('/', async (req, res) => {
  if (!Buffer.isBuffer(req.body)) return res.status(401).end();
  const rawBody = req.body;
  const shop = normalizeShopDomain(req.headers['x-shopify-shop-domain']);
  const topic = String(req.headers['x-shopify-topic'] || '').toLowerCase();
  const webhookId = String(req.headers['x-shopify-webhook-id'] || '');
  if (!shop || !/^[a-z_]+\/[a-z_]+$/.test(topic) || !/^[A-Za-z0-9_-]{1,128}$/.test(webhookId) || !verifyShopifyWebhookHmac(rawBody, req.headers['x-shopify-hmac-sha256'])) {
    return res.status(401).end();
  }

  const claim = await claimWebhook(webhookId, shop, topic);
  if (claim.state === 'processed') return res.status(200).end();
  if (claim.state !== 'claimed') {
    res.setHeader('Retry-After', '5');
    return res.status(409).end();
  }

  try {
    if (topic === 'app/uninstalled') {
      await deactivateShopifyInstallation(prisma, shop, 'uninstalled');
    } else if (topic === 'shop/redact') {
      await redactShopifyInstallationData(prisma, shop);
    } else if (['products/create', 'products/update', 'products/delete'].includes(topic)) {
      await markShopifyCatalogDirty(prisma, shop, topic.replace('/', '_').toUpperCase());
    }

    const completed = await prisma.shopifyWebhookEvent.updateMany({
      where: { webhookId, topic, status: 'processing', receivedAt: claim.receivedAt },
      data: { status: 'processed', processedAt: new Date() },
    });
    if (completed.count !== 1) throw new Error('SHOPIFY_WEBHOOK_LEASE_LOST');
    return res.status(200).end();
  } catch (error) {
    console.error('Shopify webhook error:', formatLogError(error));
    const errorCode = error instanceof Error && /^SHOPIFY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'SHOPIFY_WEBHOOK_FAILED';
    await prisma.shopifyWebhookEvent.updateMany({
      where: { webhookId, topic, status: 'processing', receivedAt: claim.receivedAt },
      data: { status: 'failed', errorCode, processedAt: new Date() },
    });
    return res.status(500).end();
  }
});

export default router;
