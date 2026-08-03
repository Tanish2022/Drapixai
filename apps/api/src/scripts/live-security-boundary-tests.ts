import assert from 'assert';

const required = (name: string) => {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const main = async () => {
  const baseUrl = required('DRAPIXAI_SECURITY_TEST_API_URL').replace(/\/+$/, '');
  const serverKeyA = required('DRAPIXAI_SECURITY_TEST_SERVER_KEY_A');
  const shopperTokenA = required('DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A');
  const expiredShopperTokenA = required('DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A');
  const productA = required('DRAPIXAI_SECURITY_TEST_PRODUCT_A');
  const productB = required('DRAPIXAI_SECURITY_TEST_PRODUCT_B');
  const resultB = required('DRAPIXAI_SECURITY_TEST_RESULT_B');
  const originA = required('DRAPIXAI_SECURITY_TEST_ORIGIN_A');
  if (!baseUrl.startsWith('https://')) throw new Error('HTTPS_API_URL_REQUIRED');

  const tokenForForeignProduct = await fetch(`${baseUrl}/sdk/storefront-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverKeyA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'web', productIds: [productB] }),
  });
  assert.equal(tokenForForeignProduct.status, 409, 'Tenant A must not mint a token for tenant B product');

  const scopedValidation = await fetch(`${baseUrl}/sdk/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${shopperTokenA}`,
      Origin: originA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productId: productB }),
  });
  assert.equal(scopedValidation.status, 403, 'Tenant A shopper token must reject tenant B product');
  const scopedPayload = await scopedValidation.json() as { error?: string };
  assert.equal(scopedPayload.error, 'TOKEN_PRODUCT_SCOPE_DENIED');

  const foreignFeedback = await fetch(`${baseUrl}/sdk/tryon-feedback`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${shopperTokenA}`,
      Origin: originA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tryOnResultId: resultB, looksReal: true }),
  });
  assert.equal(foreignFeedback.status, 404, 'Cross-tenant try-on result lookup must be indistinguishable from missing data');

  const replayedExpiredToken = await fetch(`${baseUrl}/sdk/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${expiredShopperTokenA}`,
      Origin: originA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productId: productA }),
  });
  assert.equal(replayedExpiredToken.status, 401, 'Expired shopper credentials must not be replayable');

  const replayedFromForeignOrigin = await fetch(`${baseUrl}/sdk/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${shopperTokenA}`,
      Origin: 'https://replay-attacker.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productId: productA }),
  });
  assert.equal(replayedFromForeignOrigin.status, 403, 'Origin-bound shopper credentials must not be replayable from another storefront');

  const uploadAttack = new FormData();
  uploadAttack.append(
    'person_image',
    new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/jpeg' }),
    'polyglot.jpg',
  );
  uploadAttack.append('productId', productA);
  const maliciousUpload = await fetch(`${baseUrl}/sdk/tryon`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${shopperTokenA}`,
      Origin: originA,
    },
    body: uploadAttack,
  });
  assert.equal(maliciousUpload.status, 400, 'A file with a forged image MIME type must be rejected before generation');
  const maliciousUploadPayload = await maliciousUpload.json() as { error?: string };
  assert.equal(maliciousUploadPayload.error, 'INVALID_IMAGE_CONTENT');

  const adminAttempt = await fetch(`${baseUrl}/admin/verify`, {
    headers: { Authorization: `Bearer ${serverKeyA}` },
  });
  assert.equal(adminAttempt.status, 403, 'Brand credentials must never access system administration');

  console.log('Live tenant-isolation, replay, file-upload, and authorization attack tests passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'LIVE_SECURITY_BOUNDARY_TEST_FAILED');
  process.exitCode = 1;
});
