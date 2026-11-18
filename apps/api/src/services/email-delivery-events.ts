import { Prisma, PrismaClient } from '@prisma/client';
import {
  EmailEventError, EMAIL_EVENT_RETENTION_DAYS, getEmailDeliveryConfig, normalizeMailRecipient,
  recipientDigests, type VerifiedEmailEvent,
} from '../lib/email-delivery-policy';
import { withOperationTimeout } from '../lib/operation-timeout';

export const persistEmailDeliveryEvent = async (prisma: PrismaClient, event: VerifiedEmailEvent) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const existing = await tx.emailDeliveryEvent.findUnique({ where: { webhookId: event.webhookId } });
        if (existing) {
          if (![event.eventDigest, ...event.priorEventDigests].includes(existing.eventDigest)) throw new EmailEventError('EMAIL_WEBHOOK_REPLAY_CONFLICT', 409);
          return { duplicate: true };
        }
        const { suppression, priorEventDigests, ...metadata } = event;
        await tx.emailDeliveryEvent.create({ data: metadata });
        if (suppression) {
          const priority = suppression === 'complaint' ? 2 : 1;
          await tx.emailRecipientSuppression.upsert({
            where: { recipientHash: event.recipientHash },
            create: { recipientHash: event.recipientHash, reason: suppression, priority, providerEmailId: event.providerEmailId },
            update: {},
          });
          await tx.emailRecipientSuppression.updateMany({
            where: { recipientHash: event.recipientHash, priority: { lte: priority } },
            data: { reason: suppression, priority, providerEmailId: event.providerEmailId },
          });
        }
        return { duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (attempt < 2 && ['P2002', 'P2034'].includes((error as { code?: string }).code || '')) continue;
      throw error;
    }
  }
  throw new Error('EMAIL_EVENT_PERSISTENCE_FAILED');
};

export const canSendTransactionalEmail = async (prisma: PrismaClient, recipient: string): Promise<boolean> => {
  const config = getEmailDeliveryConfig();
  if (!config) return true;
  const normalized = normalizeMailRecipient(recipient);
  if (!normalized) return false;
  const record = await withOperationTimeout(prisma.emailRecipientSuppression.findFirst({
    where: { recipientHash: { in: recipientDigests(normalized, config) } }, select: { recipientHash: true },
  }), 3000, 'EMAIL_SUPPRESSION_CHECK_TIMEOUT');
  return !record;
};

export const purgeExpiredEmailEvents = async (prisma: PrismaClient, now = new Date()) => {
  const before = new Date(now.getTime() - EMAIL_EVENT_RETENTION_DAYS * 86400000);
  const candidates = await prisma.emailDeliveryEvent.findMany({ where: { receivedAt: { lt: before } }, select: { webhookId: true }, orderBy: { receivedAt: 'asc' }, take: 500 });
  if (!candidates.length) return 0;
  // Only callback metadata expires. Never automatically erase suppression here.
  const result = await prisma.emailDeliveryEvent.deleteMany({ where: { webhookId: { in: candidates.map(row => row.webhookId) }, receivedAt: { lt: before } } });
  return result.count;
};
