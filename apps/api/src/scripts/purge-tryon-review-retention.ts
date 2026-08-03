import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { formatLogError } from '../lib/security';
import { runTryOnReviewRetention } from '../services/review-retention';

const prisma = new PrismaClient();
const DEFAULT_RETENTION_DAYS = 0;
const DEFAULT_BATCH_SIZE = 200;

const getNumberArg = (name: string, fallback: number, minimum = 1) => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  const value = raw ? Number(raw.split('=')[1]) : fallback;
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
};

const main = async () => {
  const confirmed = process.argv.includes('--confirm');
  const summary = await runTryOnReviewRetention(prisma, {
    retentionDays: getNumberArg('days', DEFAULT_RETENTION_DAYS, 0),
    batchSize: getNumberArg('batch-size', DEFAULT_BATCH_SIZE),
    dryRun: !confirmed,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (!confirmed) console.log('Dry run only. Re-run with --confirm to delete expired shopper review images.');
  if (summary.failures.length > 0) process.exitCode = 2;
};

main()
  .catch((error) => {
    console.error('Try-on review retention purge failed.');
    console.error(formatLogError(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
