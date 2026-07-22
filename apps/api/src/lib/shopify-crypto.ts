import crypto from 'crypto';

const ENCRYPTION_VERSION = 'v1';

const getEncryptionKey = () => {
  const encoded = (process.env.DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!encoded) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY_INVALID');
  return key;
};

export const encryptShopifySecret = (value: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptShopifySecret = (value: string) => {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('SHOPIFY_ENCRYPTED_SECRET_INVALID');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};
