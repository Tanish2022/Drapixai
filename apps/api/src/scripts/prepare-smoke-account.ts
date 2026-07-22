import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const domain = String(process.argv[3] || '').trim().toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMOKE_ACCOUNT_PREPARE_DISABLED_IN_PRODUCTION');
  }
  if (process.env.DRAPIXAI_ALLOW_SMOKE_ACCOUNT_PREPARE !== '1') {
    throw new Error('SMOKE_ACCOUNT_PREPARE_NOT_ENABLED');
  }
  if (!/^deploy-smoke-[0-9]+@example\.com$/.test(email)) {
    throw new Error('SMOKE_ACCOUNT_EMAIL_INVALID');
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('SMOKE_ACCOUNT_DOMAIN_INVALID');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('SMOKE_ACCOUNT_NOT_FOUND');
  const updatedKeys = await prisma.apiKey.updateMany({
    where: { userId: user.id, kind: 'dashboard', isActive: true },
    data: { domainWhitelist: domain },
  });
  if (updatedKeys.count !== 1) {
    throw new Error(`SMOKE_ACCOUNT_ACTIVE_KEY_COUNT_INVALID:${updatedKeys.count}`);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { storeVerifiedAt: new Date() },
  });
  console.log(JSON.stringify({ ok: true, email, domain }));
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'SMOKE_ACCOUNT_PREPARE_FAILED');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
