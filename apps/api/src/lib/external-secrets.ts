import fs from 'fs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const MANAGED_SECRET_NAMES = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'DRAPIXAI_AUTH_SYNC_TOKEN',
  'DRAPIXAI_DASHBOARD_PROXY_TOKEN',
  'DRAPIXAI_AI_SERVICE_TOKEN',
  'DRAPIXAI_ADMIN_TOKEN',
  'DRAPIXAI_ADMIN_PASSWORD',
  'DRAPIXAI_ADMIN_TOTP_SECRET',
  'DRAPIXAI_STOREFRONT_TOKEN_SECRET',
  'DRAPIXAI_STOREFRONT_TOKEN_PREVIOUS_SECRETS',
  'DRAPIXAI_AUDIT_LOG_SECRET',
  'DRAPIXAI_AUDIT_LOG_PREVIOUS_SECRETS',
  'DRAPIXAI_WEBHOOK_ENCRYPTION_KEY',
  'DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS',
  'DRAPIXAI_METRICS_TOKEN',
  'DRAPIXAI_STRIPE_SECRET_KEY',
  'DRAPIXAI_STRIPE_WEBHOOK_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SMTP_USER',
  'SMTP_PASS',
  'SHOPIFY_API_SECRET',
  'DRAPIXAI_SHOPIFY_STATE_SECRET',
  'DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY',
]);

const REQUIRED_PRODUCTION_MANAGED_SECRET_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'DRAPIXAI_AUTH_SYNC_TOKEN',
  'DRAPIXAI_DASHBOARD_PROXY_TOKEN',
  'DRAPIXAI_AI_SERVICE_TOKEN',
  'DRAPIXAI_ADMIN_TOKEN',
  'DRAPIXAI_ADMIN_PASSWORD',
  'DRAPIXAI_ADMIN_TOTP_SECRET',
  'DRAPIXAI_STOREFRONT_TOKEN_SECRET',
  'DRAPIXAI_AUDIT_LOG_SECRET',
  'DRAPIXAI_WEBHOOK_ENCRYPTION_KEY',
  'DRAPIXAI_METRICS_TOKEN',
  'DRAPIXAI_STRIPE_SECRET_KEY',
  'DRAPIXAI_STRIPE_WEBHOOK_SECRET',
  'SMTP_PASS',
] as const;

const parseSecretObject = (raw: string, source: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`MANAGED_SECRET_JSON_INVALID:${source}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`MANAGED_SECRET_OBJECT_REQUIRED:${source}`);
  }
  return parsed as Record<string, unknown>;
};

const applySecrets = (values: Record<string, unknown>) => {
  if (process.env.NODE_ENV === 'production') {
    const required = [
      ...REQUIRED_PRODUCTION_MANAGED_SECRET_NAMES,
      ...(process.env.DRAPIXAI_SHOPIFY_ENABLED === '1'
        ? ['SHOPIFY_API_SECRET', 'DRAPIXAI_SHOPIFY_STATE_SECRET', 'DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY']
        : []),
    ];
    const missing = required.filter((name) => typeof values[name] !== 'string' || String(values[name]).length === 0);
    if (missing.length > 0) {
      throw new Error(`MANAGED_SECRET_SET_INCOMPLETE:${missing.sort().join(',')}`);
    }
  }
  let applied = 0;
  for (const [name, value] of Object.entries(values)) {
    if (!MANAGED_SECRET_NAMES.has(name)) continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`MANAGED_SECRET_VALUE_INVALID:${name}`);
    }
    process.env[name] = value;
    applied += 1;
  }
  if (applied === 0) throw new Error('MANAGED_SECRET_ALLOWLIST_EMPTY');
  return applied;
};

const loadAwsSecrets = async () => {
  const secretId = (process.env.DRAPIXAI_AWS_SECRET_ID || '').trim();
  const region = (process.env.AWS_REGION || '').trim();
  if (!secretId) throw new Error('DRAPIXAI_AWS_SECRET_ID_REQUIRED');
  if (!region) throw new Error('AWS_REGION_REQUIRED');
  const client = new SecretsManagerClient({ region });
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) throw new Error('AWS_SECRET_STRING_REQUIRED');
  return applySecrets(parseSecretObject(result.SecretString, 'aws-secrets-manager'));
};

const loadMountedSecrets = () => {
  const filePath = (process.env.DRAPIXAI_MOUNTED_SECRET_FILE || '/run/secrets/drapixai-api').trim();
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error('MOUNTED_SECRET_FILE_REQUIRED');
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    throw new Error('MOUNTED_SECRET_FILE_PERMISSIONS_TOO_OPEN');
  }
  return applySecrets(parseSecretObject(fs.readFileSync(filePath, 'utf8'), 'mounted-file'));
};

export const loadExternalSecrets = async () => {
  const provider = (process.env.DRAPIXAI_SECRETS_PROVIDER || 'env').trim().toLowerCase();
  if (provider === 'aws-secrets-manager') return loadAwsSecrets();
  if (provider === 'mounted-file') return loadMountedSecrets();
  if (provider === 'env') {
    if (process.env.NODE_ENV === 'production' && process.env.DRAPIXAI_ALLOW_ENV_SECRETS !== '1') {
      throw new Error('MANAGED_SECRETS_REQUIRED_IN_PRODUCTION');
    }
    return 0;
  }
  throw new Error('UNSUPPORTED_SECRETS_PROVIDER');
};
