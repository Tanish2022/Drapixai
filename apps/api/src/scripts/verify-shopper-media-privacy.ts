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
    const [persistentReferences, consentEvents, nonRetentionEvents] = await Promise.all([
      prisma.tryOnResult.count({
        where: {
          OR: [{ personImageUrl: { not: null } }, { resultImageUrl: { not: null } }],
        },
      }),
      prisma.securityAuditLog.count({ where: { action: 'privacy.tryon_consent.accepted' } }),
      prisma.securityAuditLog.count({ where: { action: 'privacy.tryon_media.not_retained' } }),
    ]);

    let continuationToken: string | undefined;
    let scannedObjects = 0;
    const shopperMediaObjects: string[] = [];
    do {
      const page = await storage.send(new ListObjectsV2Command({
        Bucket: STORAGE_BUCKET,
        Prefix: 'tryon-review/',
        ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents || []) {
        const key = object.Key || '';
        scannedObjects += 1;
        if (isShopperMediaKey(key)) shopperMediaObjects.push(key);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    const failures: string[] = [];
    if (persistentReferences > 0) failures.push('PERSISTENT_SHOPPER_MEDIA_REFERENCES');
    if (shopperMediaObjects.length > 0) failures.push('ORPHANED_SHOPPER_MEDIA_OBJECTS');
    if (consentEvents < 1) failures.push('CONSENT_AUDIT_EVIDENCE_MISSING');
    if (nonRetentionEvents < 1) failures.push('NON_RETENTION_AUDIT_EVIDENCE_MISSING');

    const report = {
      generatedAt: new Date().toISOString(),
      environment: process.env.DRAPIXAI_API_ENVIRONMENT || 'unknown',
      persistentShopperMediaReferences: persistentReferences,
      scannedReviewObjects: scannedObjects,
      shopperMediaObjectCount: shopperMediaObjects.length,
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
