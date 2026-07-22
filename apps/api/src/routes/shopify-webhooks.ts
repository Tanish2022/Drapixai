import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeShopDomain, verifyShopifyWebhookHmac } from '../lib/shopify-auth';
import { formatLogError } from '../lib/security';
import { markShopifyCatalogDirty } from '../services/shopify';
import { redactShopifyInstallationData } from '../services/shopify-redaction';

const router = Router();
const prisma = new PrismaClient();

const claimWebhook = async (webhookId: string, shopDomain: string, topic: string) => {
  const existing = await prisma.shopifyWebhookEvent.findUnique({ where: { webhookId } });
  if (existing?.status === 'processed') return false;
  if (existing) {
    const claimed = await prisma.shopifyWebhookEvent.updateMany({
      where: {
        webhookId,
        OR: [
          { status: { in: ['received', 'failed'] } },
          { status: 'processing', receivedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      data: { status: 'processing', errorCode: null, processedAt: null },
    });
    return claimed.count === 1;
  }

  try {
    await prisma.shopifyWebhookEvent.create({
      data: { webhookId, shopDomain, topic, status: 'processing' },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
};

router.post('/', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const shop = normalizeShopDomain(req.headers['x-shopify-shop-domain']);
  const topic = String(req.headers['x-shopify-topic'] || '').toLowerCase();
  const webhookId = String(req.headers['x-shopify-webhook-id'] || '');
  if (!shop || !topic || !webhookId || !verifyShopifyWebhookHmac(rawBody, req.headers['x-shopify-hmac-sha256'])) {
    return res.status(401).end();
  }

  if (!(await claimWebhook(webhookId, shop, topic))) return res.status(200).end();

  try {
    if (topic === 'app/uninstalled') {
      const installation = await prisma.shopifyInstallation.findUnique({ where: { shopDomain: shop } });
      if (installation) {
        await prisma.$transaction([
          prisma.shopifyInstallation.update({
            where: { id: installation.id },
            data: { status: 'uninstalled', uninstalledAt: new Date(), encryptedAccessToken: '' },
          }),
          ...(installation.storefrontApiKeyId ? [prisma.apiKey.update({ where: { id: installation.storefrontApiKeyId }, data: { isActive: false } })] : []),
        ]);
      }
    } else if (topic === 'shop/redact') {
      const installation = await prisma.shopifyInstallation.findUnique({ where: { shopDomain: shop } });
      if (installation) await redactShopifyInstallationData(prisma, installation);
    } else if (['products/create', 'products/update', 'products/delete'].includes(topic)) {
      await markShopifyCatalogDirty(prisma, shop, topic.replace('/', '_').toUpperCase());
    }

    await prisma.shopifyWebhookEvent.update({ where: { webhookId }, data: { status: 'processed', processedAt: new Date() } });
    return res.status(200).end();
  } catch (error) {
    console.error('Shopify webhook error:', formatLogError(error));
    const errorCode = error instanceof Error && /^SHOPIFY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'SHOPIFY_WEBHOOK_FAILED';
    await prisma.shopifyWebhookEvent.update({
      where: { webhookId },
      data: { status: 'failed', errorCode, processedAt: new Date() },
    });
    return res.status(500).end();
  }
});

export default router;
