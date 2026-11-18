import type { PrismaClient } from '@prisma/client';

const BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const retentionDays = (raw = '0') => {
  if (!/^(0|[1-9]\d{0,3})$/.test(raw) || Number(raw) > 3650) throw new Error('DELIVERY_RETENTION_CONFIG_INVALID');
  return Number(raw);
};

export const getDeliveryRetention = () => ({
  emailDays: retentionDays(process.env.DRAPIXAI_EMAIL_LOG_RETENTION_DAYS),
  webhookDays: retentionDays(process.env.DRAPIXAI_WEBHOOK_DELIVERY_RETENTION_DAYS),
});

export const purgeDeliveryMetadata = async (
  prisma: PrismaClient, policy: ReturnType<typeof getDeliveryRetention>, now = new Date(),
) => {
  let email = 0;
  let webhooks = 0;
  if (policy.emailDays) {
    const where = { createdAt: { lt: new Date(now.getTime() - policy.emailDays * DAY_MS) } };
    const expired = await prisma.emailLog.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH_SIZE });
    if (expired.length) email = (await prisma.emailLog.deleteMany({ where: { ...where, id: { in: expired.map(row => row.id) } } })).count;
  }
  if (policy.webhookDays) {
    const where = { status: { in: ['delivered', 'disabled'] }, updatedAt: { lt: new Date(now.getTime() - policy.webhookDays * DAY_MS) } };
    const expired = await prisma.webhookDelivery.findMany({ where, select: { id: true }, orderBy: { updatedAt: 'asc' }, take: BATCH_SIZE });
    if (expired.length) webhooks = (await prisma.webhookDelivery.deleteMany({ where: { ...where, id: { in: expired.map(row => row.id) } } })).count;
  }
  return { email, webhooks };
};
