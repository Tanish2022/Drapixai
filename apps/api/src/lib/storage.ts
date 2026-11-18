import fs from 'fs';
import path from 'path';
import { addAbortSignal, Readable } from 'stream';
import { GetObjectCommand, PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = (process.env.S3_ENDPOINT || '').trim();
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const sessionToken = (process.env.AWS_SESSION_TOKEN || '').trim();
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
            ...(sessionToken ? { sessionToken } : {}),
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

const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
const isReplayKey = (key: string) => /^(session|outputs|tryon-review)\/.+/.test(key)
  && !/[\x00-\x1f\x7f\\]/.test(key)
  && !key.split('/').some(part => ['', '.', '..'].includes(part));

const readReplayStream = async (body: Readable, signal: AbortSignal, length?: number) => {
  if (length !== undefined && (length <= 0 || length > MAX_REPLAY_BYTES)) {
    body.destroy();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of addAbortSignal(signal, body)) {
    size += chunk.length;
    if (size > MAX_REPLAY_BYTES) return null;
    chunks.push(Buffer.from(chunk));
  }
  return size > 0 && (length === undefined || size === length) ? Buffer.concat(chunks, size) : null;
};

export const readStoredObject = async (storedUrl: string | null | undefined): Promise<Buffer | null> => {
  if (!storedUrl) return null;
  const signal = AbortSignal.timeout(5000);
  try {
    if (storedUrl.startsWith('local:') && STORAGE_LOCAL_FALLBACK_ALLOWED) {
      const root = await fs.promises.realpath(process.env.DRAPIXAI_UPLOAD_DIR || 'uploads');
      const target = await fs.promises.realpath(storedUrl.slice('local:'.length));
      const relative = path.relative(root, target);
      if (path.isAbsolute(relative) || !isReplayKey(relative.split(path.sep).join('/'))) return null;
      const info = await fs.promises.stat(target);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_REPLAY_BYTES) return null;
      signal.throwIfAborted();
      return await readReplayStream(fs.createReadStream(target), signal, info.size);
    }
    const prefix = `s3://${STORAGE_BUCKET}/`;
    if (!storedUrl.startsWith(prefix)) return null;
    const key = storedUrl.slice(prefix.length);
    if (!isReplayKey(key)) return null;
    const client = createStorageClient();
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }), { abortSignal: signal });
      if (!(response.Body instanceof Readable)) return null;
      return await readReplayStream(response.Body, signal, response.ContentLength);
    } finally {
      client.destroy();
    }
  } catch {
    return null;
  }
};
