import assert from 'node:assert/strict';
import { createVerifiedStorefrontOriginCache } from '../lib/cors-origin-cache';

let manualQueries = 0;
let shopifyQueries = 0;
const prisma = {
  apiKey: {
    async findMany() {
      manualQueries += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [{ domainWhitelist: 'store.example.com' }];
    },
  },
  shopifyInstallation: {
    async findMany() {
      shopifyQueries += 1;
      return [{ shopDomain: 'brand.myshopify.com', primaryDomain: 'www.brand.example' }];
    },
  },
};

async function main() {
  const cache = createVerifiedStorefrontOriginCache(prisma, { shopifyEnabled: true, ttlMs: 30_000 });
  const results = await Promise.all([
    cache.allows('https://store.example.com'),
    cache.allows('https://brand.myshopify.com'),
    cache.allows('https://www.brand.example'),
    ...Array.from({ length: 50 }, (_, index) => cache.allows(`https://attacker-${index}.invalid`)),
  ]);

  assert.equal(results[0], true);
  assert.equal(results[1], true);
  assert.equal(results[2], true);
  assert.equal(results.slice(3).some(Boolean), false);
  assert.equal(manualQueries, 1, 'concurrent origins must share one manual-domain refresh');
  assert.equal(shopifyQueries, 1, 'concurrent origins must share one Shopify-domain refresh');

  assert.equal(await cache.allows('https://another.invalid'), false);
  assert.equal(manualQueries, 1, 'negative origins must not trigger database queries during the TTL');

  cache.invalidate();
  assert.equal(await cache.allows('https://store.example.com'), true);
  assert.equal(manualQueries, 2, 'explicit invalidation must refresh the allowlist');
  assert.equal(shopifyQueries, 2, 'explicit invalidation must refresh Shopify domains');
  console.log('CORS origin cache tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
