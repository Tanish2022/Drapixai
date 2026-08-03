import assert from 'assert';
import crypto from 'crypto';
import {
  issuePublicApiToken,
  resolvePublicApiToken,
} from '../lib/api-key-auth';
import {
  createWebhookSecret,
  encryptWebhookSecret,
  reencryptWebhookSecret,
  signWebhookPayload,
} from '../services/webhooks';

process.env.DRAPIXAI_STOREFRONT_TOKEN_SECRET = 'public-api-test-secret-with-at-least-32-characters';
process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.DRAPIXAI_API_ENVIRONMENT = 'sandbox';

const apiKey = {
  id: 41,
  userId: 7,
  kind: 'manual',
  scopes: 'api:token:issue,api:tryon,api:usage,api:webhooks',
  isActive: true,
  revokedAt: null,
  expiresAt: null,
};
const prisma = {
  apiKey: {
    findFirst: async ({ where }: any) =>
      where.id === apiKey.id && where.userId === apiKey.userId ? apiKey : null,
  },
} as any;

const main = async () => {
  const token = issuePublicApiToken({
    apiKeyId: apiKey.id,
    userId: apiKey.userId,
    scopes: ['api:tryon'],
    productIds: ['SH-1042'],
    environment: 'sandbox',
  });
  const resolved = await resolvePublicApiToken(prisma, token);
  assert.ok(resolved, 'Matching sandbox API token must resolve');
  assert.deepStrictEqual(resolved?.context.productIds, ['SH-1042']);
  assert.deepStrictEqual(resolved?.context.scopes, ['api:tryon']);
  assert.deepStrictEqual(resolved?.scopes, ['api:tryon']);

  const originalSigningSecret = process.env.DRAPIXAI_STOREFRONT_TOKEN_SECRET!;
  process.env.DRAPIXAI_STOREFRONT_TOKEN_SECRET = 'rotated-public-api-test-secret-with-at-least-32-characters';
  process.env.DRAPIXAI_STOREFRONT_TOKEN_PREVIOUS_SECRETS = originalSigningSecret;
  assert.ok(await resolvePublicApiToken(prisma, token), 'Tokens issued before signing-key rotation must remain valid during the overlap window');

  process.env.DRAPIXAI_API_ENVIRONMENT = 'live';
  assert.strictEqual(await resolvePublicApiToken(prisma, token), null, 'Sandbox token must fail closed on live');
  process.env.DRAPIXAI_API_ENVIRONMENT = 'sandbox';

  const previousWebhookKey = process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY!;
  const secret = createWebhookSecret();
  const encrypted = encryptWebhookSecret(secret);
  assert.ok(secret.startsWith('whsec_'));
  assert.ok(!encrypted.includes(secret), 'Webhook secret must be encrypted at rest');
  assert.strictEqual(
    signWebhookPayload(secret, '1700000000', 'evt_test', '{"ok":true}'),
    signWebhookPayload(secret, '1700000000', 'evt_test', '{"ok":true}'),
    'Webhook signatures must be deterministic for exact raw payloads',
  );
  assert.notStrictEqual(
    signWebhookPayload(secret, '1700000000', 'evt_test', '{"ok":true}'),
    signWebhookPayload(secret, '1700000000', 'evt_test', '{"ok":false}'),
    'Webhook signatures must bind the raw payload',
  );
  process.env.DRAPIXAI_WEBHOOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS = previousWebhookKey;
  const rotatedCiphertext = reencryptWebhookSecret(encrypted);
  process.env.DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS = '';
  assert.doesNotThrow(
    () => reencryptWebhookSecret(rotatedCiphertext),
    'Re-encrypted webhook secrets must no longer depend on the previous key',
  );

  console.log('Public API v1 security contract tests passed.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
