import { ListObjectsV2Command, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';

const PREFIXES = ['tryon-review/', 'session/', 'outputs/'] as const;
const MAX_PAGES_PER_LISTING = 10000;

const classify = (key: string, prefix: string) => {
  if (!key || !key.startsWith(prefix)) throw new Error('MEDIA_INVENTORY_INVALID_KEY');
  if (prefix !== 'tryon-review/') return 'legacy';
  if (/\/(person|result)\.[A-Za-z0-9]+$/.test(key)) return 'shopper';
  if (/\/garment\.(png|jpe?g|webp)$/i.test(key)) return 'garment';
  // Unknown review objects need operator review; a renamed shopper image must
  // not disappear from privacy certification merely because its name differs.
  return 'unclassified';
};

const isTruncated = (value: unknown) => {
  if (typeof value !== 'boolean') throw new Error('MEDIA_INVENTORY_INVALID_PAGINATION');
  return value;
};

const acceptCursor = (seen: Set<string>, cursor: string) => {
  if (seen.has(cursor)) throw new Error('MEDIA_INVENTORY_REPEATED_CURSOR');
  if (seen.size >= MAX_PAGES_PER_LISTING) throw new Error('MEDIA_INVENTORY_PAGE_LIMIT');
  seen.add(cursor);
};

// Read-only inventory. Version listing is mandatory even when current listings
// are empty: an ordinary DELETE can hide recoverable bytes behind a marker.
// Only aggregate counts leave this function; object keys/version IDs stay local.
export const inventoryShopperMedia = async (storage: S3Client, bucket: string) => {
  if (!bucket.trim()) throw new Error('MEDIA_INVENTORY_BUCKET_REQUIRED');
  const counts = {
    scannedObjects: 0,
    shopperMediaObjectCount: 0,
    legacyRenderMediaObjectCount: 0,
    unclassifiedReviewObjectCount: 0,
    scannedObjectVersions: 0,
    shopperMediaVersionCount: 0,
    legacyRenderMediaVersionCount: 0,
    unclassifiedReviewVersionCount: 0,
    deleteMarkerCount: 0,
  };

  for (const prefix of PREFIXES) {
    let continuationToken: string | undefined;
    const objectCursors = new Set<string>();
    while (true) {
      acceptCursor(objectCursors, continuationToken || '');
      const page = await storage.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuationToken,
      }));
      if (page.CommonPrefixes?.length) throw new Error('MEDIA_INVENTORY_UNEXPECTED_DELIMITER');
      for (const object of page.Contents || []) {
        const kind = classify(object.Key || '', prefix);
        counts.scannedObjects++;
        if (kind === 'shopper') counts.shopperMediaObjectCount++;
        if (kind === 'legacy') counts.legacyRenderMediaObjectCount++;
        if (kind === 'unclassified') counts.unclassifiedReviewObjectCount++;
      }
      if (!isTruncated(page.IsTruncated)) break;
      if (!page.NextContinuationToken) throw new Error('MEDIA_INVENTORY_MISSING_CURSOR');
      continuationToken = page.NextContinuationToken;
    }

    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    const versionCursors = new Set<string>();
    while (true) {
      acceptCursor(versionCursors, JSON.stringify([keyMarker, versionIdMarker]));
      const page = await storage.send(new ListObjectVersionsCommand({
        Bucket: bucket, Prefix: prefix, MaxKeys: 1000,
        KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
      }));
      if (page.CommonPrefixes?.length) throw new Error('MEDIA_INVENTORY_UNEXPECTED_DELIMITER');
      for (const version of page.Versions || []) {
        if (!version.VersionId) throw new Error('MEDIA_INVENTORY_INVALID_VERSION');
        const kind = classify(version.Key || '', prefix);
        counts.scannedObjectVersions++;
        if (kind === 'shopper') counts.shopperMediaVersionCount++;
        if (kind === 'legacy') counts.legacyRenderMediaVersionCount++;
        if (kind === 'unclassified') counts.unclassifiedReviewVersionCount++;
      }
      for (const marker of page.DeleteMarkers || []) {
        classify(marker.Key || '', prefix);
        if (!marker.VersionId) throw new Error('MEDIA_INVENTORY_INVALID_VERSION');
        counts.deleteMarkerCount++;
      }
      if (!isTruncated(page.IsTruncated)) break;
      if (!page.NextKeyMarker || !page.NextKeyMarker.startsWith(prefix)) {
        throw new Error('MEDIA_INVENTORY_MISSING_CURSOR');
      }
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
    }
  }
  return counts;
};
