import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { appendSecurityAudit } from '../lib/audit-log';
import { createStorageClient } from '../lib/storage';
import { formatLogError, removeLocalStoredFile } from '../lib/security';

const REVIEW_PREFIX = 'tryon-review/';
const s3 = createStorageClient();

type StoredUrlKind = 'personImageUrl' | 'resultImageUrl';

const parseS3Url = (storedUrl: string) => {
  if (!storedUrl.startsWith('s3://')) return null;
  const rest = storedUrl.replace('s3://', '');
  const [bucket, ...keyParts] = rest.split('/');
  const key = keyParts.join('/');
  if (!bucket || !key.startsWith(REVIEW_PREFIX)) return null;
  return { bucket, key };
};

const deleteStoredReviewImage = async (storedUrl: string) => {
  if (storedUrl.startsWith('local:')) {
    if (!removeLocalStoredFile(storedUrl, REVIEW_PREFIX)) throw new Error('LOCAL_REVIEW_DELETE_FAILED');
    return;
  }
  const s3Url = parseS3Url(storedUrl);
  if (!s3Url) throw new Error('UNRECOGNIZED_REVIEW_STORAGE_URL');
  await s3.send(new DeleteObjectCommand({ Bucket: s3Url.bucket, Key: s3Url.key }));
};

export const runTryOnReviewRetention = async (
  prisma: PrismaClient,
  options: { retentionDays: number; batchSize: number; dryRun?: boolean },
) => {
  const retentionDays = Math.max(1, Math.floor(options.retentionDays));
  const batchSize = Math.min(1000, Math.max(1, Math.floor(options.batchSize)));
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const expiredResults = await prisma.tryOnResult.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ personImageUrl: { not: null } }, { resultImageUrl: { not: null } }],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, requestId: true, personImageUrl: true, resultImageUrl: true },
  });
  const summary = {
    mode: options.dryRun ? 'dry-run' : 'automatic',
    retentionDays,
    cutoff: cutoff.toISOString(),
    scanned: expiredResults.length,
    imagesDeleted: 0,
    rowsUpdated: 0,
    failures: [] as Array<{ resultId: number; field: StoredUrlKind; code: string }>,
  };

  if (options.dryRun) return summary;

  for (const result of expiredResults) {
    const updates: Partial<Record<StoredUrlKind, null>> = {};
    for (const field of ['personImageUrl', 'resultImageUrl'] as StoredUrlKind[]) {
      const storedUrl = result[field];
      if (!storedUrl) continue;
      try {
        await deleteStoredReviewImage(storedUrl);
        updates[field] = null;
        summary.imagesDeleted += 1;
      } catch (error) {
        summary.failures.push({ resultId: result.id, field, code: formatLogError(error) });
      }
    }
    if (Object.keys(updates).length > 0) {
      await prisma.tryOnResult.update({ where: { id: result.id }, data: updates });
      summary.rowsUpdated += 1;
    }
  }

  await appendSecurityAudit(prisma, {
    actorRole: 'system',
    action: 'retention.tryon_review.completed',
    targetType: 'tryon_review_storage',
    outcome: summary.failures.length > 0 ? 'failure' : 'success',
    metadata: {
      retentionDays,
      scanned: summary.scanned,
      imagesDeleted: summary.imagesDeleted,
      rowsUpdated: summary.rowsUpdated,
      failureCount: summary.failures.length,
    },
  });
  return summary;
};
