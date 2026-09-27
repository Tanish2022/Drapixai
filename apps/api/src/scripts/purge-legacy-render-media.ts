import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { appendSecurityAudit } from '../lib/audit-log';
import { loadExternalSecrets } from '../lib/external-secrets';
import { formatLogError, removeLocalStoredFile } from '../lib/security';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { eraseStoredObjectVersions, listStoredObjectVersions } from '../lib/storage-erasure';

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
      legacyVersionsScanned: 0,
      failures: 0,
    };

    // Include historical objects hidden by delete markers. Finish inventory
    // before any mutation, and keep dry runs read-only.
    const orphanKeys = new Set<string>();
    for (const prefix of LEGACY_PREFIXES) {
      const versions = await listStoredObjectVersions(storage, STORAGE_BUCKET, prefix);
      summary.legacyVersionsScanned += versions.length;
      for (const version of versions) orphanKeys.add(version.key);
    }
    summary.legacyObjectsScanned = orphanKeys.size;
    if (!confirmed) {
      console.log(JSON.stringify(summary, null, 2));
      console.log('Dry run only. Re-run with --confirm to delete legacy render media.');
      return;
    }

    for (const render of renders) {
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
            await eraseStoredObjectVersions(storage, STORAGE_BUCKET, key);
          }
          const cleared = await prisma.render.updateMany({
            where: { id: render.id, [field]: storedUrl }, data: { [field]: null },
          });
          if (cleared.count !== 1) throw new Error('LEGACY_MEDIA_REFERENCE_CHANGED');
          summary.renderReferencesCleared += 1;
        } catch (error) {
          summary.failures += 1;
          console.error(`Legacy render ${render.id} ${field} cleanup failed:`, formatLogError(error));
        }
      }
    }

    for (const key of orphanKeys) {
      try {
        await eraseStoredObjectVersions(storage, STORAGE_BUCKET, key);
        summary.legacyObjectsDeleted += 1;
      } catch (error) {
        summary.failures += 1;
        console.error('Legacy render object cleanup failed:', formatLogError(error));
      }
    }

    // A successful per-key delete does not prove the prefix stayed empty.
    // Refuse a success audit if a concurrent writer or retained version remains.
    for (const prefix of LEGACY_PREFIXES) {
      try {
        if ((await listStoredObjectVersions(storage, STORAGE_BUCKET, prefix)).length > 0) {
          throw new Error('LEGACY_MEDIA_VERSIONS_REMAIN');
        }
      } catch (error) {
        summary.failures += 1;
        console.error('Legacy render final inventory failed:', formatLogError(error));
      }
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
    storage.destroy();
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('Legacy render media purge failed:', formatLogError(error));
  process.exitCode = 1;
});
