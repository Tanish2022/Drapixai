import { DeleteObjectCommand, GetBucketVersioningCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';

type StoredVersion = { key: string; versionId: string; latest: boolean; etag?: string };
const MAX_ENTRIES = 100000;
const MAX_PAGES = 1000;

// Collect the complete bounded plan before mutation. Deleting while paginating
// can invalidate cursors. A failed/incomplete inventory must never authorize deletion.
export const listStoredObjectVersions = async (storage: S3Client, bucket: string, prefix: string) => {
  if (!bucket.trim() || !prefix) throw new Error('STORAGE_ERASURE_SCOPE_REQUIRED');
  const versions: StoredVersion[] = [];
  const cursors = new Set<string>();
  const identities = new Set<string>();
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  while (true) {
    const cursor = JSON.stringify([keyMarker, versionIdMarker]);
    if (cursors.has(cursor) || cursors.size >= MAX_PAGES) throw new Error('STORAGE_ERASURE_INVALID_PAGINATION');
    cursors.add(cursor);
    const page = await storage.send(new ListObjectVersionsCommand({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker,
    }));
    if (typeof page.IsTruncated !== 'boolean' || page.CommonPrefixes?.length) {
      throw new Error('STORAGE_ERASURE_INCOMPLETE_INVENTORY');
    }
    for (const entry of [...(page.Versions || []), ...(page.DeleteMarkers || [])]) {
      if (!entry.Key?.startsWith(prefix) || !entry.VersionId || typeof entry.IsLatest !== 'boolean') {
        throw new Error('STORAGE_ERASURE_INVALID_ENTRY');
      }
      const identity = JSON.stringify([entry.Key, entry.VersionId]);
      if (identities.has(identity) || identities.size >= MAX_ENTRIES) throw new Error('STORAGE_ERASURE_INVALID_INVENTORY');
      identities.add(identity);
    }
    for (const entry of page.Versions || []) {
      // Keep an ETag as an additional precondition where the provider supports it.
      // Correctness must not depend on If-Match: some MinIO builds ignore it.
      if (entry.VersionId === 'null' && !entry.ETag) throw new Error('STORAGE_ERASURE_ETAG_REQUIRED');
      versions.push({ key: entry.Key!, versionId: entry.VersionId!, latest: entry.IsLatest!, etag: entry.ETag });
    }
    if (!page.IsTruncated) return versions;
    if (!page.NextKeyMarker?.startsWith(prefix) || !page.NextVersionIdMarker) {
      throw new Error('STORAGE_ERASURE_MISSING_CURSOR');
    }
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
  }
};

// Caller must authorize the bucket/key against its owned retention scope.
// Versioning must stay enabled and writers must not have permission to suspend
// it. This makes even pre-existing null versions immutable to new PutObject calls.
// Keys must be immutable or writers drained during erasure. This proves a
// post-delete observation, not absence of future writes or replica/backup erasure.
export const eraseStoredObjectVersions = async (storage: S3Client, bucket: string, key: string) => {
  if (!bucket.trim() || !key || /[\u0000-\u001f\u007f]/.test(key)
    || key.split('/').some(part => ['', '.', '..'].includes(part))) {
    throw new Error('STORAGE_ERASURE_OBJECT_KEY_REQUIRED');
  }
  const requireVersioning = async () => {
    const policy = await storage.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (policy.Status !== 'Enabled') throw new Error('STORAGE_ERASURE_VERSIONING_REQUIRED');
  };
  await requireVersioning();
  const versions = (await listStoredObjectVersions(storage, bucket, key))
    .filter((version) => version.key === key)
    .sort((a, b) => Number(a.latest) - Number(b.latest));
  if (versions.length) await requireVersioning();
  for (const version of versions) {
    // Preserve delete markers. Deleting them could expose older retained data
    // after a partial failure. Remove noncurrent data before current data.
    const result = await storage.send(new DeleteObjectCommand({
      Bucket: bucket, Key: key, VersionId: version.versionId,
      ...(version.versionId === 'null' ? { IfMatch: version.etag } : {}),
    }));
    if (result.DeleteMarker) throw new Error('STORAGE_ERASURE_UNEXPECTED_DELETE_MARKER');
  }
  await requireVersioning();
  if ((await listStoredObjectVersions(storage, bucket, key)).some((version) => version.key === key)) {
    throw new Error('STORAGE_ERASURE_VERSIONS_REMAIN');
  }
  try {
    await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 && ['NotFound', 'NoSuchKey'].includes(error?.name)) {
      return { deletedVersions: versions.length };
    }
    throw error;
  }
  throw new Error('STORAGE_ERASURE_CURRENT_OBJECT_REMAINS');
};
