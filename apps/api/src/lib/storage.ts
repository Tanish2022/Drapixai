import { PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = (process.env.S3_ENDPOINT || '').trim();
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const hasStaticCredentials = accessKeyId.length > 0 && secretAccessKey.length > 0;
const isCustomEndpoint = endpoint.length > 0;
const serverSideEncryption = (
  process.env.DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION
  || (process.env.NODE_ENV === 'production' ? 'AES256' : '')
).trim();
const kmsKeyId = (process.env.DRAPIXAI_S3_KMS_KEY_ID || '').trim();

export const STORAGE_BUCKET = process.env.S3_BUCKET || 'drapixai';
export const STORAGE_FORCE_PATH_STYLE =
  (process.env.S3_FORCE_PATH_STYLE || (isCustomEndpoint ? '1' : '0')) === '1';
export const STORAGE_LOCAL_FALLBACK_ALLOWED =
  process.env.NODE_ENV !== 'production'
  && (process.env.DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK || '1') === '1';

export const getStorageEncryptionParams = (): Partial<Pick<PutObjectCommandInput, 'ServerSideEncryption' | 'SSEKMSKeyId'>> => {
  if (!serverSideEncryption && process.env.NODE_ENV !== 'production') return {};
  if (serverSideEncryption === 'aws:kms') {
    if (!kmsKeyId) throw new Error('S3_KMS_KEY_ID_NOT_CONFIGURED');
    return { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId };
  }
  if (serverSideEncryption !== 'AES256') {
    throw new Error('S3_SERVER_SIDE_ENCRYPTION_INVALID');
  }
  return { ServerSideEncryption: 'AES256' };
};

export function createStorageClient() {
  const client = new S3Client({
    region,
    ...(isCustomEndpoint ? { endpoint } : {}),
    ...(hasStaticCredentials
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        }
      : {}),
    forcePathStyle: STORAGE_FORCE_PATH_STYLE,
  });

  return client;
}

export function getStorageSummary() {
  return {
    bucket: STORAGE_BUCKET,
    mode: isCustomEndpoint ? 'custom-endpoint' : 'aws-default',
    endpoint: endpoint || null,
    forcePathStyle: STORAGE_FORCE_PATH_STYLE,
    usingStaticCredentials: hasStaticCredentials,
    serverSideEncryption,
    kmsKeyConfigured: Boolean(kmsKeyId),
    localFallbackAllowed: STORAGE_LOCAL_FALLBACK_ALLOWED,
  };
}
