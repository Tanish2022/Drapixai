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

  const adminAttempt = await fetch(`${baseUrl}/admin/verify`, {
    headers: { Authorization: `Bearer ${serverKeyA}` },
  });
  assert.equal(adminAttempt.status, 403, 'Brand credentials must never access system administration');

  console.log('Live RBAC, product-scope, and cross-tenant boundary tests passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'LIVE_SECURITY_BOUNDARY_TEST_FAILED');
  process.exitCode = 1;
});
