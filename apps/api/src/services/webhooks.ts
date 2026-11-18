import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { safePostJson } from '../lib/remote-fetch';
import { formatLogError } from '../lib/security';
import { observeWebhookFailure } from '../lib/operational-metrics';

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const CLAIM_TIMEOUT_MS = 5 * 60_000;

const parseEncryptionKey = (encoded: string) => {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length !== 32) throw new Error('WEBHOOK_ENCRYPTION_KEY_NOT_CONFIGURED');
  return raw;
};

const encryptionKey = () => parseEncryptionKey(process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY || '');

const decryptionKeys = () => {
  const current = encryptionKey();
  const previous = (process.env.DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
    .map(parseEncryptionKey);
  return [current, ...previous];
};

export const createWebhookSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

export const signWebhookPayload = (secret: string, timestamp: string, eventId: string, body: string) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${eventId}.${body}`).digest('hex');

export const encryptWebhookSecret = (secret: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
};

const decryptWebhookSecret = (encrypted: string) => {
  const [ivRaw, tagRaw, ciphertextRaw] = encrypted.split('.');
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error('WEBHOOK_SECRET_INVALID');
  for (const key of decryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Continue through the bounded rotation key ring.
    }
  }
  throw new Error('WEBHOOK_SECRET_DECRYPTION_FAILED');
};

export const reencryptWebhookSecret = (encrypted: string) => encryptWebhookSecret(decryptWebhookSecret(encrypted));

export const queueWebhookEvent = async (
  transaction: Prisma.TransactionClient,
  userId: number,
  eventId: string,
  eventType: string,
  data: Record<string, unknown>,
) => {
  const endpoints = await transaction.webhookEndpoint.findMany({
    where: { userId, isActive: true }, select: { id: true, events: true },
  });
  const payload = {
    id: eventId,
    type: eventType,
    created: new Date().toISOString(),
    livemode: (process.env.DRAPIXAI_API_ENVIRONMENT || 'sandbox') === 'live',
    data,
  };
  const matching = endpoints.filter((endpoint) =>
    endpoint.events.split(',').some((event) => event === eventType || event === '*'));
  if (matching.length === 0) return eventId;
  await transaction.webhookDelivery.createMany({
    data: matching.map((endpoint) => ({
      endpointId: endpoint.id,
      eventId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return eventId;
};

export const claimWebhookDelivery = async (
  prisma: PrismaClient,
  deliveryId: string,
  previousAttemptCount: number,
  now: Date,
  staleClaimAt: Date,
) => prisma.webhookDelivery.updateMany({
  where: {
    id: deliveryId,
    attemptCount: previousAttemptCount,
    OR: [
      { status: { in: ['pending', 'retrying'] }, nextAttemptAt: { lte: now } },
      { status: 'processing', updatedAt: { lte: staleClaimAt } },
    ],
  },
  data: previousAttemptCount >= MAX_ATTEMPTS
    ? { status: 'failed', errorCode: 'WEBHOOK_ATTEMPTS_EXHAUSTED' }
    : { status: 'processing', attemptCount: { increment: 1 } },
});

export const processPendingWebhookDeliveries = async (prisma: PrismaClient, limit = 20, postWebhook = safePostJson) => {
  const now = new Date();
  const staleClaimAt = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      OR: [
        { status: { in: ['pending', 'retrying'] }, nextAttemptAt: { lte: now } },
        { status: 'processing', updatedAt: { lte: staleClaimAt } },
      ],
    },
    include: { endpoint: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  for (const delivery of deliveries) {
    const claim = await claimWebhookDelivery(prisma, delivery.id, delivery.attemptCount, now, staleClaimAt);
    if (claim.count !== 1 || delivery.attemptCount >= MAX_ATTEMPTS) continue;
    const attemptCount = delivery.attemptCount + 1;
    const owned = { id: delivery.id, status: 'processing', attemptCount };

    if (!delivery.endpoint.isActive) {
      await prisma.webhookDelivery.updateMany({ where: owned, data: { status: 'disabled' } });
      continue;
    }
    let responseCode: number;
    try {
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = decryptWebhookSecret(delivery.endpoint.encryptedSecret);
      const signature = signWebhookPayload(secret, timestamp, delivery.eventId, body);
      const response = await postWebhook(delivery.endpoint.url, body, {
        'DrapixAI-Event-Id': delivery.eventId,
        'DrapixAI-Event-Type': delivery.eventType,
        'DrapixAI-Timestamp': timestamp,
        'DrapixAI-Signature': `v1=${signature}`,
      }, { timeoutMs: 8000, maxBytes: 64 * 1024 });
      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error('WEBHOOK_NON_2XX'), { responseCode: response.status });
      }
      responseCode = response.status;
    } catch (error: any) {
      observeWebhookFailure();
      const exhausted = attemptCount >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.webhookDelivery.updateMany({
        where: owned,
        data: {
          status: exhausted ? 'failed' : 'retrying',
          responseCode: Number(error?.responseCode) || null,
          errorCode: /^[A-Z0-9_]{3,64}$/.test(error?.message || '') ? error.message : 'WEBHOOK_DELIVERY_FAILED',
          nextAttemptAt: new Date(Date.now() + delay),
        },
      });
      console.error('Webhook delivery error:', formatLogError(error));
      continue;
    }
    await prisma.webhookDelivery.updateMany({
      where: owned,
      data: { status: 'delivered', responseCode, deliveredAt: new Date(), errorCode: null },
    });
  }
  return deliveries.length;
};
