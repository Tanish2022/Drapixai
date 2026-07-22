import assert from 'assert';
import jwt from 'jsonwebtoken';
import {
  isStorefrontProductAllowed,
  issueGenericStorefrontToken,
  resolveActiveApiKey,
  resolveSdkApiKey,
} from '../lib/api-key-auth';

process.env.DRAPIXAI_STOREFRONT_TOKEN_SECRET = 'test-storefront-secret-that-is-longer-than-32-characters';
process.env.NODE_ENV = 'production';

const apiKey = {
  id: 17,
  userId: 9,
  kind: 'manual',
  isActive: true,
  revokedAt: null,
  expiresAt: null,
};
let lastUsedUpdates = 0;
const prisma = {
  apiKey: {
    findFirst: async ({ where }: any) => where.id === apiKey.id && where.userId === apiKey.userId ? apiKey : null,
    findUnique: async () => null,
    findMany: async () => [],
    update: async () => {
      lastUsedUpdates += 1;
      return apiKey;
    },
  },
} as any;

const main = async () => {
const token = issueGenericStorefrontToken({
  apiKeyId: apiKey.id,
  userId: apiKey.userId,
  channel: 'web',
  allowedDomain: 'shop.example.com',
  productIds: ['SKU-1'],
});
assert.ok(token.startsWith('dpxsf_'));
const claims = jwt.decode(token.slice('dpxsf_'.length)) as jwt.JwtPayload;
assert.equal(claims.kind, 'generic-storefront');
assert.equal(claims.purpose, 'tryon');
assert.deepStrictEqual(claims.productIds, ['SKU-1']);
assert.ok(Number(claims.exp) - Number(claims.iat) === 300);

const sdkCredential = await resolveSdkApiKey(prisma, `Bearer ${token}`);
assert.equal(sdkCredential?.apiKey.id, apiKey.id);
assert.equal(sdkCredential?.storefront?.allowedDomain, 'shop.example.com');
assert.equal(isStorefrontProductAllowed(sdkCredential?.storefront, 'SKU-1'), true);
assert.equal(isStorefrontProductAllowed(sdkCredential?.storefront, 'SKU-2'), false);
assert.equal(lastUsedUpdates, 1);

const generalCredential = await resolveActiveApiKey(prisma, `Bearer ${token}`);
assert.equal(generalCredential, null, 'A shopper token must never authenticate a general API route');

console.log('Short-lived storefront token tests passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'STOREFRONT_TOKEN_TEST_FAILED');
  process.exitCode = 1;
});
