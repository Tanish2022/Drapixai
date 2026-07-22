import assert from 'assert';
import crypto from 'crypto';

process.env.SHOPIFY_API_SECRET = 'shopify-test-secret-with-more-than-32-characters';
process.env.DRAPIXAI_SHOPIFY_STATE_SECRET = 'shopify-state-secret-with-more-than-32-characters';
process.env.DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.DRAPIXAI_SHOPIFY_IMAGE_HOSTS = 'cdn.shopify.com,*.shopifycdn.com';

import {
  createShopifyState,
  hashLinkToken,
  normalizeShopDomain,
  verifyShopifyAppProxyQuery,
  verifyShopifyQueryHmac,
  verifyShopifyState,
  verifyShopifyWebhookHmac,
} from '../lib/shopify-auth';
import { decryptShopifySecret, encryptShopifySecret } from '../lib/shopify-crypto';
import { validateShopifyImageUrl } from '../services/catalog-preparation';

assert.strictEqual(normalizeShopDomain('https://Demo-Store.myshopify.com/admin'), 'demo-store.myshopify.com');
assert.strictEqual(normalizeShopDomain('demo-store.example.com'), null);

const rawWithoutHmac = 'shop=demo-store.myshopify.com&timestamp=1783890000';
const queryHmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(rawWithoutHmac).digest('hex');
assert.strictEqual(verifyShopifyQueryHmac(`${rawWithoutHmac}&hmac=${queryHmac}`), true);
assert.strictEqual(verifyShopifyQueryHmac(`${rawWithoutHmac}&hmac=${'0'.repeat(64)}`), false);

const appProxyTimestamp = Math.floor(Date.now() / 1000);
const appProxyMessage = `logged_in_customer_id=path_prefix=/apps/drapixaishop=demo-store.myshopify.comtimestamp=${appProxyTimestamp}`;
const appProxySignature = crypto
  .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
  .update(appProxyMessage)
  .digest('hex');
const appProxyQuery = `shop=demo-store.myshopify.com&logged_in_customer_id=&path_prefix=%2Fapps%2Fdrapixai&timestamp=${appProxyTimestamp}&signature=${appProxySignature}`;
assert.strictEqual(verifyShopifyAppProxyQuery(appProxyQuery), true);
assert.strictEqual(
  verifyShopifyAppProxyQuery(appProxyQuery.replace('demo-store', 'attacker-store')),
  false,
);
assert.strictEqual(
  verifyShopifyAppProxyQuery(`shop=demo-store.myshopify.com&timestamp=1&signature=${appProxySignature}`),
  false,
);

const state = createShopifyState('demo-store.myshopify.com');
assert.strictEqual(verifyShopifyState(state.state)?.shop, 'demo-store.myshopify.com');
assert.strictEqual(verifyShopifyState(`${state.state}broken`), null);

const secret = 'shpat_test_offline_token';
const encrypted = encryptShopifySecret(secret);
assert.notStrictEqual(encrypted, secret);
assert.strictEqual(decryptShopifySecret(encrypted), secret);

assert.strictEqual(hashLinkToken('one-time-token'), hashLinkToken('one-time-token'));
assert.notStrictEqual(hashLinkToken('one-time-token'), hashLinkToken('different-token'));

const webhookBody = Buffer.from('{"id":123}');
const webhookHmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(webhookBody).digest('base64');
assert.strictEqual(verifyShopifyWebhookHmac(webhookBody, webhookHmac), true);
assert.strictEqual(verifyShopifyWebhookHmac(webhookBody, 'invalid'), false);

assert.strictEqual(validateShopifyImageUrl('https://cdn.shopify.com/s/files/1/product.jpg'), true);
assert.strictEqual(validateShopifyImageUrl('https://images.shopifycdn.com/product.webp'), true);
assert.strictEqual(validateShopifyImageUrl('http://cdn.shopify.com/s/files/1/product.jpg'), false);
assert.strictEqual(validateShopifyImageUrl('https://user:pass@cdn.shopify.com/product.jpg'), false);
assert.strictEqual(validateShopifyImageUrl('https://cdn.shopify.com.evil.example/product.jpg'), false);
assert.strictEqual(validateShopifyImageUrl('https://shopifycdn.com/product.jpg'), false);
assert.strictEqual(validateShopifyImageUrl('https://127.0.0.1/product.jpg'), false);

console.log('Shopify foundation tests passed.');
