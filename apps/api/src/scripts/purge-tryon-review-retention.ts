import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createStorageClient } from '../lib/storage';
import { removeLocalStoredFile } from '../lib/security';

const prisma = new PrismaClient();
const s3 = createStorageClient();

const REVIEW_PREFIX = 'tryon-review/';
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 200;

type StoredUrlKind = 'personImageUrl' | 'resultImageUrl';

const getNumberArg = (name: string, fallback: number) => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const shouldConfirm = () => process.argv.includes('--confirm');

const parseS3Url = (storedUrl: string) => {
  if (!storedUrl.startsWith('s3://')) return null;
  const rest = storedUrl.replace('s3://', '');
  const [bucket, ...keyParts] = rest.split('/');
  const key = keyParts.join('/');
  if (!bucket || !key.startsWith(REVIEW_PREFIX)) return null;
  return { bucket, key };
};

const deleteStoredReviewImage = async (storedUrl: string | null | undefined) => {
  if (!storedUrl) return { deleted: false, skipped: false };

  if (storedUrl.startsWith('local:')) {
    return { deleted: removeLocalStoredFile(storedUrl, REVIEW_PREFIX), skipped: false };
  }

  const s3Url = parseS3Url(storedUrl);
  if (!s3Url) return { deleted: false, skipped: true };

  await s3.send(new DeleteObjectCommand({ Bucket: s3Url.bucket, Key: s3Url.key }));
  return { deleted: true, skipped: false };
};

const main = async () => {
  const confirmed = shouldConfirm();
  const retentionDays = getNumberArg('days', DEFAULT_RETENTION_DAYS);
  const batchSize = Math.min(getNumberArg('batch-size', DEFAULT_BATCH_SIZE), 1000);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const expiredResults = await prisma.tryOnResult.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [
        { personImageUrl: { not: null } },
        { resultImageUrl: { not: null } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: {
      id: true,
      requestId: true,
      createdAt: true,
      personImageUrl: true,
      resultImageUrl: true,
    },
  });

  const summary = {
    mode: confirmed ? 'confirm' : 'dry-run',
    retentionDays,
    cutoff: cutoff.toISOString(),
    scanned: expiredResults.length,
    imagesDeleted: 0,
    imagesSkipped: 0,
    rowsUpdated: 0,
  };

  for (const result of expiredResults) {
    const imageFields: StoredUrlKind[] = ['personImageUrl', 'resultImageUrl'];
    if (!confirmed) {
      console.log(JSON.stringify({
        id: result.id,
        requestId: result.requestId,
        createdAt: result.createdAt.toISOString(),
        wouldClear: imageFields.filter((field) => Boolean(result[field])),
      }));
      continue;
    }

    for (const field of imageFields) {
      const deletion = await deleteStoredReviewImage(result[field]);
      if (deletion.deleted) summary.imagesDeleted += 1;
      if (deletion.skipped) summary.imagesSkipped += 1;
    }

    await prisma.tryOnResult.update({
      where: { id: result.id },
      data: {
        personImageUrl: null,
        resultImageUrl: null,
      },
    });
    summary.rowsUpdated += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!confirmed) {
    console.log('Dry run only. Re-run with --confirm to delete stored shopper review images and clear TryOnResult URLs.');
  }
};

main()
  .catch((error) => {
    console.error('Try-on review retention purge failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });