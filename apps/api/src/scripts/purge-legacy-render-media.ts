import 'dotenv/config';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { appendSecurityAudit } from '../lib/audit-log';
import { loadExternalSecrets } from '../lib/external-secrets';
import { formatLogError, removeLocalStoredFile } from '../lib/security';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';

const LEGACY_PREFIXES = ['session/', 'outputs/'];
const confirmed = process.argv.includes('--confirm');

const legacyKeyFromUrl = (storedUrl: string) => {
  if (storedUrl.startsWith('s3://')) {
    const bucketAndKey = storedUrl.slice('s3://'.length);
    const firstSlash = bucketAndKey.indexOf('/');
    if (firstSlash < 1) return null;
    const bucket = bucketAndKey.slice(0, firstSlash);
    const key = bucketAndKey.slice(firstSlash + 1);
    return bucket === STORAGE_BUCKET && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)) ? key : null;
  }
  return LEGACY_PREFIXES.some((prefix) => storedUrl.startsWith(prefix)) ? storedUrl : null;
};

const main = async () => {
  await loadExternalSecrets();
  const prisma = new PrismaClient();
  const storage = createStorageClient();
  try {
    const renders = await prisma.render.findMany({
      where: { OR: [{ inputUrl: { not: null } }, { outputUrl: { not: null } }] },
      select: { id: true, inputUrl: true, outputUrl: true },
    });
    const summary = {
      mode: confirmed ? 'confirmed' : 'dry-run',
      rendersScanned: renders.length,
      renderReferencesCleared: 0,
      legacyObjectsScanned: 0,
      legacyObjectsDeleted: 0,
      failures: 0,
    };

    if (!confirmed) {
      console.log(JSON.stringify(summary, null, 2));
      console.log('Dry run only. Re-run with --confirm to delete legacy render media.');
      return;
    }

    for (const render of renders) {
      const update: { inputUrl?: null; outputUrl?: null } = {};
      for (const field of ['inputUrl', 'outputUrl'] as const) {
        const storedUrl = render[field];
        if (!storedUrl) continue;
        try {
          if (storedUrl.startsWith('local:')) {
            const deleted = LEGACY_PREFIXES.some((prefix) => removeLocalStoredFile(storedUrl, prefix));
            if (!deleted) throw new Error('UNRECOGNIZED_LOCAL_LEGACY_MEDIA_URL');
          } else {
            const key = legacyKeyFromUrl(storedUrl);
            if (!key) throw new Error('UNRECOGNIZED_LEGACY_MEDIA_URL');
            await storage.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
          }
          update[field] = null;
          summary.renderReferencesCleared += 1;
        } catch (error) {
          summary.failures += 1;
          console.error(`Legacy render ${render.id} ${field} cleanup failed:`, formatLogError(error));
        }
      }
      if (Object.keys(update).length > 0) {
        await prisma.render.update({ where: { id: render.id }, data: update });
      }
    }

    for (const prefix of LEGACY_PREFIXES) {
      let continuationToken: string | undefined;
      do {
        const page = await storage.send(new ListObjectsV2Command({
          Bucket: STORAGE_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents || []) {
          if (!object.Key) continue;
          summary.legacyObjectsScanned += 1;
          try {
            await storage.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: object.Key }));
            summary.legacyObjectsDeleted += 1;
          } catch (error) {
            summary.failures += 1;
            console.error('Legacy render object cleanup failed:', formatLogError(error));
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    await appendSecurityAudit(prisma, {
      actorRole: 'system',
      action: 'privacy.legacy_render_media.purged',
      targetType: 'legacy_render_storage',
      outcome: summary.failures > 0 ? 'failure' : 'success',
      metadata: summary,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('Legacy render media purge failed:', formatLogError(error));
  process.exitCode = 1;
});
