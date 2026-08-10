import 'dotenv/config';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { loadExternalSecrets } from '../lib/external-secrets';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { formatLogError } from '../lib/security';

const isShopperMediaKey = (key: string) => /\/(person|result)\.[A-Za-z0-9]+$/.test(key);

const main = async () => {
  await loadExternalSecrets();
  const prisma = new PrismaClient();
  const storage = createStorageClient();
  try {
    const [persistentReferences, legacyRenderReferences, consentEvents, nonRetentionEvents] = await Promise.all([
      prisma.tryOnResult.count({
        where: {
          OR: [{ personImageUrl: { not: null } }, { resultImageUrl: { not: null } }],
        },
      }),
      prisma.render.count({
        where: { OR: [{ inputUrl: { not: null } }, { outputUrl: { not: null } }] },
      }),
      prisma.securityAuditLog.count({ where: { action: 'privacy.tryon_consent.accepted' } }),
      prisma.securityAuditLog.count({ where: { action: 'privacy.tryon_media.not_retained' } }),
    ]);

    let scannedObjects = 0;
    const shopperMediaObjects: string[] = [];
    const legacyRenderMediaObjects: string[] = [];
    for (const prefix of ['tryon-review/', 'session/', 'outputs/']) {
      let continuationToken: string | undefined;
      do {
        const page = await storage.send(new ListObjectsV2Command({
          Bucket: STORAGE_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents || []) {
          const key = object.Key || '';
          scannedObjects += 1;
          if (prefix === 'tryon-review/' && isShopperMediaKey(key)) shopperMediaObjects.push(key);
          if (prefix !== 'tryon-review/') legacyRenderMediaObjects.push(key);
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    const failures: string[] = [];
    if (persistentReferences > 0) failures.push('PERSISTENT_SHOPPER_MEDIA_REFERENCES');
    if (legacyRenderReferences > 0) failures.push('LEGACY_RENDER_MEDIA_REFERENCES');
    if (shopperMediaObjects.length > 0) failures.push('ORPHANED_SHOPPER_MEDIA_OBJECTS');
    if (legacyRenderMediaObjects.length > 0) failures.push('LEGACY_RENDER_MEDIA_OBJECTS');
    if (consentEvents < 1) failures.push('CONSENT_AUDIT_EVIDENCE_MISSING');
    if (nonRetentionEvents < 1) failures.push('NON_RETENTION_AUDIT_EVIDENCE_MISSING');

    const report = {
      generatedAt: new Date().toISOString(),
      environment: process.env.DRAPIXAI_API_ENVIRONMENT || 'unknown',
      persistentShopperMediaReferences: persistentReferences,
      legacyRenderMediaReferences: legacyRenderReferences,
      scannedShopperMediaObjects: scannedObjects,
      shopperMediaObjectCount: shopperMediaObjects.length,
      legacyRenderMediaObjectCount: legacyRenderMediaObjects.length,
      consentAuditEvents: consentEvents,
      nonRetentionAuditEvents: nonRetentionEvents,
      trainingUse: 'none',
      passed: failures.length === 0,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('Shopper-media privacy verification failed:', formatLogError(error));
  process.exitCode = 1;
});
