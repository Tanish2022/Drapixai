import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { reencryptWebhookSecret } from '../services/webhooks';
import { formatLogError } from '../lib/security';

const prisma = new PrismaClient();

const main = async () => {
  if (process.env.DRAPIXAI_KEY_ROTATION_APPROVAL !== 'I_APPROVE_WEBHOOK_KEY_ROTATION') {
    throw new Error('DRAPIXAI_KEY_ROTATION_APPROVAL_REQUIRED');
  }
  if (!(process.env.DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS || '').trim()) {
    throw new Error('PREVIOUS_WEBHOOK_ENCRYPTION_KEY_REQUIRED');
  }
  let updated = 0;
  while (true) {
    const endpoints = await prisma.webhookEndpoint.findMany({
      orderBy: { id: 'asc' },
      skip: updated,
      take: 100,
      select: { id: true, encryptedSecret: true },
    });
    if (endpoints.length === 0) break;
    await prisma.$transaction(endpoints.map((endpoint) => prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { encryptedSecret: reencryptWebhookSecret(endpoint.encryptedSecret) },
    })));
    updated += endpoints.length;
  }
  console.log(JSON.stringify({ rotated: updated, status: 'PASS' }));
};

main()
  .catch((error) => {
    console.error(formatLogError(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
