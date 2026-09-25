import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadExternalSecrets } from '../lib/external-secrets';
import { createStorageClient, STORAGE_BUCKET } from '../lib/storage';
import { formatLogError } from '../lib/security';
import { inventoryShopperMedia } from '../lib/shopper-media-inventory';

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

    const inventory = await inventoryShopperMedia(storage, STORAGE_BUCKET);

    const failures: string[] = [];
    if (persistentReferences > 0) failures.push('PERSISTENT_SHOPPER_MEDIA_REFERENCES');
    if (legacyRenderReferences > 0) failures.push('LEGACY_RENDER_MEDIA_REFERENCES');
    if (inventory.shopperMediaObjectCount > 0) failures.push('ORPHANED_SHOPPER_MEDIA_OBJECTS');
    if (inventory.legacyRenderMediaObjectCount > 0) failures.push('LEGACY_RENDER_MEDIA_OBJECTS');
    if (inventory.shopperMediaVersionCount > 0) failures.push('RETAINED_SHOPPER_MEDIA_VERSIONS');
    if (inventory.legacyRenderMediaVersionCount > 0) failures.push('RETAINED_LEGACY_MEDIA_VERSIONS');
    if (inventory.unclassifiedReviewObjectCount + inventory.unclassifiedReviewVersionCount > 0) {
      failures.push('UNCLASSIFIED_REVIEW_STORAGE_OBJECTS');
    }
    if (consentEvents < 1) failures.push('CONSENT_AUDIT_EVIDENCE_MISSING');
    if (nonRetentionEvents < 1) failures.push('NON_RETENTION_AUDIT_EVIDENCE_MISSING');

    const report = {
      generatedAt: new Date().toISOString(),
      environment: process.env.DRAPIXAI_API_ENVIRONMENT || 'unknown',
      persistentShopperMediaReferences: persistentReferences,
      legacyRenderMediaReferences: legacyRenderReferences,
      ...inventory,
      scannedShopperMediaObjects: inventory.scannedObjects,
      consentAuditEvents: consentEvents,
      nonRetentionAuditEvents: nonRetentionEvents,
      scope: 'database references, consent events and configured storage prefixes including object versions',
      trainingUse: 'not_assessed_by_this_check',
      passed: failures.length === 0,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) process.exitCode = 2;
  } finally {
    storage.destroy();
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('Shopper-media privacy verification failed:', formatLogError(error));
  process.exitCode = 1;
});
