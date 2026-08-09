import assert from 'assert';

const required = (name: string) => {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const readBoundedInteger = (name: string, minimum: number, maximum: number) => {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_MUST_BE_AN_INTEGER_BETWEEN_${minimum}_AND_${maximum}`);
  }
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
  const publicApiTokenA = required('DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A');
  const rateLimitPath = required('DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH');
  const rateLimitAttempts = readBoundedInteger('DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS', 1, 200);
  if (!baseUrl.startsWith('https://')) throw new Error('HTTPS_API_URL_REQUIRED');
  const apiHost = new URL(baseUrl).hostname.toLowerCase();
  if (process.env.DRAPIXAI_SECURITY_TEST_ENVIRONMENT !== 'staging' || apiHost === 'api.drapixai.com') {
    throw new Error('STAGING_ONLY_SECURITY_TEST_REQUIRED');
  }
  if (rateLimitPath !== '/v1/usage') throw new Error('RATE_LIMIT_PATH_MUST_BE_V1_USAGE');

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

  const webhookSsrfAttempt = await fetch(`${baseUrl}/v1/webhook-endpoints`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicApiTokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: 'http://127.0.0.1:8080/internal-only',
      events: ['tryon.completed'],
    }),
  });
  assert.equal(webhookSsrfAttempt.status, 400, 'Public API webhooks must reject localhost SSRF destinations');
  const webhookSsrfPayload = await webhookSsrfAttempt.json() as { error?: { code?: string } };
  assert.equal(webhookSsrfPayload.error?.code, 'INVALID_WEBHOOK_URL');

  const attackerOrigin = 'https://replay-attacker.invalid';
  const corsPreflight = await fetch(`${baseUrl}/sdk/validate`, {
    method: 'OPTIONS',
    headers: {
      Origin: attackerOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.notEqual(corsPreflight.headers.get('access-control-allow-origin'), attackerOrigin, 'CORS must not approve an unverified storefront origin');

  const csrfStyleAttempt = await fetch(`${baseUrl}/sdk/tryon-feedback`, {
    method: 'POST',
    headers: {
      Origin: attackerOrigin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tryOnResultId: resultB, looksReal: true }),
  });
  assert.ok(csrfStyleAttempt.status >= 400, 'Unauthenticated cross-origin state changes must be rejected');
  assert.notEqual(csrfStyleAttempt.headers.get('access-control-allow-origin'), attackerOrigin, 'Rejected cross-origin state changes must not receive CORS approval');

  const rateLimitStatuses: number[] = [];
  for (let attempt = 0; attempt < rateLimitAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}${rateLimitPath}`, {
      headers: { Authorization: `Bearer ${publicApiTokenA}` },
    });
    rateLimitStatuses.push(response.status);
    if (response.status === 429) {
      assert.ok(response.headers.get('retry-after'), 'Rate-limited responses must include Retry-After');
      break;
    }
  }
  assert.ok(rateLimitStatuses.includes(429), 'Configured staging API-key rate limit was not enforced');

  console.log(JSON.stringify({
    status: 'PASS',
    environment: 'staging',
    checks: [
      'tenant_isolation',
      'credential_replay',
      'malicious_upload',
      'authorization',
      'webhook_ssrf',
      'cors',
      'csrf_style_request',
      'rate_limit',
    ],
    rate_limit_statuses: rateLimitStatuses,
  }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'LIVE_SECURITY_BOUNDARY_TEST_FAILED');
  process.exitCode = 1;
});
