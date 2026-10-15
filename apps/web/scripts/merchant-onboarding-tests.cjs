// Run with Node 22: node --experimental-strip-types scripts/merchant-onboarding-tests.cjs
const assert = require('node:assert/strict');
const { getMerchantSetup, setupErrorMessage } = require('../app/lib/merchant-onboarding.ts');

const summary = { quotaRemaining: 10, storeVerified: true, approvedTryOnResultCount: 1, warningFreeTryOnCount: 1, recentRenders: [{ productId: 'shirt-1', status: 'complete' }] };
const ready = { garmentId: 'photo-1', garmentType: 'upper', status: 'ready', cacheKey: 'cache-1', confirmedProductId: 'shirt-1' };
assert.equal(getMerchantSetup(summary, []).stage, 0);
for (const change of [{ status: 'pending' }, { status: 'rejected' }, { cacheKey: null }, { confirmedProductId: null }, { garmentType: 'lower' }]) {
  const state = getMerchantSetup(summary, [{ ...ready, ...change }]);
  assert.equal(state.stage, 0);
  assert.equal(state.canInstall, false);
}
for (const recentRenders of [[], [{ productId: 'shirt-1', status: 'failed' }], [{ productId: 'another-product', status: 'complete' }]]) {
  const state = getMerchantSetup({ ...summary, recentRenders }, [ready]);
  assert.equal(state.stage, 1);
  assert.equal(state.canInstall, false);
}
assert.equal(getMerchantSetup(summary, [ready]).stage, 2);
assert.equal(getMerchantSetup(summary, [ready]).canInstall, true);
for (const change of [{ storeVerified: false }, { approvedTryOnResultCount: 0 }, { warningFreeTryOnCount: 0 }, { quotaRemaining: 0 }, { quotaRemaining: -1 }]) {
  assert.equal(getMerchantSetup({ ...summary, ...change }, [ready]).canInstall, false);
}
assert.equal(getMerchantSetup({ ...summary, recentRenders: undefined }, [ready]).stage, 1);
assert.equal(getMerchantSetup(summary, [{ ...ready, garmentType: null }]).stage, 2);
assert.ok(!setupErrorMessage('INTERNAL_SECRET_ERROR').includes('INTERNAL_SECRET_ERROR'));
assert.match(setupErrorMessage('GARMENT_NOT_APPROVED'), /review/);
console.log('Merchant onboarding state checks passed (pending/rejected photos, cache, mappings, product-specific previews, approval, ownership, allowance and safe errors).');
