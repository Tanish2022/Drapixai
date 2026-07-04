import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from '../services/emailer';

const prisma = new PrismaClient();

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : '';
};

const maskEmail = (email: string) => email.replace(/^(.).+(@.+)$/, '$1***$2');

const main = async () => {
  const to = getArg('to') || process.env.SMTP_TEST_TO || '';
  const subject = getArg('subject') || 'DrapixAI SMTP launch verification';

  if (!to) {
    console.error('Missing test recipient. Pass --to=brand-admin@example.com or set SMTP_TEST_TO.');
    process.exitCode = 1;
    return;
  }

  for (const name of ['DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
    if (!process.env[name]) {
      console.error(`Missing required SMTP verification env: ${name}`);
      process.exitCode = 1;
      return;
    }
  }

  const user = await prisma.user.findUnique({ where: { email: to.toLowerCase() } });
  if (!user) {
    console.error('SMTP verification requires an existing DrapixAI account email so EmailLog can prove delivery status.');
    console.error(`No User found for ${maskEmail(to)}.`);
    process.exitCode = 1;
    return;
  }

  const text = [
    'This is a DrapixAI SMTP launch verification email.',
    '',
    'If you received this, the API email path can send account-critical messages such as signup OTPs, password reset OTPs, and garment approval notifications.',
    '',
    `Sent at: ${new Date().toISOString()}`,
  ].join('\n');

  const result = await sendEmail(user.id, user.email, 'smtp_launch_test', subject, text);
  if (!result.sent || !result.logId) {
    console.error('SMTP launch verification failed.');
    console.error(JSON.stringify({ sent: result.sent, skipped: result.skipped, logId: result.logId, error: result.error }, null, 2));
    process.exitCode = 1;
    return;
  }

  const log = await prisma.emailLog.findUnique({ where: { id: result.logId } });
  if (!log || log.status !== 'sent') {
    console.error('SMTP email was sent but EmailLog verification failed.');
    console.error(JSON.stringify({ logId: result.logId, status: log?.status || null }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    to: maskEmail(user.email),
    event: log.event,
    status: log.status,
    emailLogId: log.id,
    createdAt: log.createdAt.toISOString(),
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('SMTP launch verification command failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
