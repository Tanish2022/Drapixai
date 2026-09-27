import {
  CreateBucketCommand,
  GetPublicAccessBlockCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketVersioningCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { loadExternalSecrets } from '../lib/external-secrets';

const retryDelayMs = 1000;
const retryCount = 30;

const isMissingBucket = (error: unknown) => {
  const code = String((error as { name?: string; Code?: string })?.name
    || (error as { Code?: string })?.Code || '');
  return code === 'NotFound' || code === 'NoSuchBucket' || code === '404';
};

const isOwnedBucket = (error: unknown) => {
  const code = String((error as { name?: string; Code?: string })?.name
    || (error as { Code?: string })?.Code || '');
  // `BucketAlreadyExists` can belong to a different AWS account. Continuing in
  // that case could direct a deployment at storage outside DrapixAI's control.
  return code === 'BucketAlreadyOwnedByYou';
};

export const initializeStorageBucket = async () => {
  // Import after mounted credentials are loaded. `storage.ts` reads credentials
  // while creating its client, so importing it before the mounted-file provider
  // would silently select the wrong credential source.
  const { createStorageClient, STORAGE_BUCKET } = await import('../lib/storage');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(STORAGE_BUCKET)) {
    throw new Error('STORAGE_BUCKET_INVALID');
  }
  const storage = createStorageClient();
  const region = (process.env.AWS_REGION || 'us-east-1').trim();
  const isAwsS3 = !(process.env.S3_ENDPOINT || '').trim();
  const publicAccessBlock = {
    BlockPublicAcls: true,
    IgnorePublicAcls: true,
    BlockPublicPolicy: true,
    RestrictPublicBuckets: true,
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      try {
        await storage.send(new HeadBucketCommand({ Bucket: STORAGE_BUCKET }));
      } catch (error) {
        if (!isMissingBucket(error)) throw error;
        try {
          await storage.send(new CreateBucketCommand({
            Bucket: STORAGE_BUCKET,
            ...(isAwsS3 && region !== 'us-east-1'
              ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
              : {}),
            ...(process.env.DRAPIXAI_STORAGE_OBJECT_LOCK_ENABLED === '1'
              ? { ObjectLockEnabledForBucket: true }
              : {}),
          }));
        } catch (createError) {
          if (!isOwnedBucket(createError)) throw createError;
        }
      }
      const versioning = await storage.send(new GetBucketVersioningCommand({ Bucket: STORAGE_BUCKET }));
      if (versioning.Status !== 'Enabled') {
        await storage.send(new PutBucketVersioningCommand({
          Bucket: STORAGE_BUCKET,
          VersioningConfiguration: { Status: 'Enabled' },
        }));
      }
      const verified = await storage.send(new GetBucketVersioningCommand({ Bucket: STORAGE_BUCKET }));
      if (verified.Status !== 'Enabled') throw new Error('STORAGE_BUCKET_VERSIONING_NOT_ENABLED');
      if (isAwsS3) {
        await storage.send(new PutPublicAccessBlockCommand({ Bucket: STORAGE_BUCKET, PublicAccessBlockConfiguration: publicAccessBlock }));
        const publicAccess = await storage.send(new GetPublicAccessBlockCommand({ Bucket: STORAGE_BUCKET }));
        if (Object.entries(publicAccessBlock).some(([key, value]) => publicAccess.PublicAccessBlockConfiguration?.[key as keyof typeof publicAccessBlock] !== value)) {
          throw new Error('STORAGE_BUCKET_PUBLIC_ACCESS_BLOCK_INCOMPLETE');
        }
      }
      return STORAGE_BUCKET;
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`STORAGE_BUCKET_INITIALIZATION_FAILED:${String((lastError as Error)?.message || 'UNKNOWN')}`);
};

const main = async () => {
  await loadExternalSecrets();
  const storageBucket = await initializeStorageBucket();
  console.log(`Storage bucket ${storageBucket} exists with versioning enabled.`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Storage bucket initialization failed:', error instanceof Error ? error.message : 'UNKNOWN');
    process.exit(1);
  });
}
