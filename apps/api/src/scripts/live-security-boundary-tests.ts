import assert from 'assert';

const requiredValue = (name: string, env: NodeJS.ProcessEnv) => {
  const value = (env[name] || '').trim();
  if (!value || value.startsWith('REPLACE_') || /[\r\n]/.test(value)) throw new Error(`${name}_REQUIRED`);
  return value;
};

const readBoundedInteger = (name: string, minimum: number, maximum: number, env: NodeJS.ProcessEnv) => {
  const value = Number(requiredValue(name, env));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_MUST_BE_AN_INTEGER_BETWEEN_${minimum}_AND_${maximum}`);
  }
  return value;
};

export const validateLiveSecurityTarget = (env: NodeJS.ProcessEnv) => {
  const baseUrl = requiredValue('DRAPIXAI_SECURITY_TEST_API_URL', env).replace(/\/+$/, '');
  const url = new URL(baseUrl);
  const apiHost = url.hostname.toLowerCase();
  if (env.DRAPIXAI_SECURITY_TEST_ENVIRONMENT !== 'staging' || apiHost === 'api.drapixai.com') {
    throw new Error('STAGING_ONLY_SECURITY_TEST_REQUIRED');
  }
  if (url.protocol !== 'https:' || url.origin !== baseUrl || !/(^|[.-])staging([.-]|$)/.test(apiHost)) {
    throw new Error('EXACT_HTTPS_STAGING_ORIGIN_REQUIRED');
  }
  if (requiredValue('DRAPIXAI_SECURITY_TEST_APPROVED_API_ORIGIN', env) !== baseUrl) throw new Error('APPROVED_ORIGIN_MISMATCH');
  requiredValue('DRAPIXAI_SECURITY_TEST_AUTHORIZATION_REF', env);
  const releaseCommit = requiredValue('DRAPIXAI_EXPECTED_GIT_REF', env);
  if (!/^[a-f0-9]{40}$/.test(releaseCommit)) throw new Error('EXACT_RELEASE_COMMIT_REQUIRED');
  const mode = env.DRAPIXAI_SECURITY_TEST_MODE || 'full';
  if (!['full', 'cpu'].includes(mode)) throw new Error('INVALID_SECURITY_TEST_MODE');
  return { baseUrl, mode, releaseCommit };
};

// A bounded deterministic probe, not an exploit scanner or a load generator.
// Redirects never receive credentials. Reject unavailable services and cap body
// reads as well as headers; errors never echo provider bodies or bearer values.
export const createSecurityProbe = (baseUrl: string, transport: typeof fetch = globalThis.fetch, timeoutMs = 10000) => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('INVALID_PROBE_DEADLINE');
  let requests = 0;
  const deadline = Date.now() + 120000;
  return async (url: string, options: RequestInit = {}) => {
    if (new URL(url).origin !== baseUrl || ++requests > 250 || Date.now() >= deadline) throw new Error('SECURITY_PROBE_SCOPE_OR_BUDGET');
    const response = await transport(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, deadline - Date.now()))) });
    if (response.status >= 300 && response.status < 400 || response.status >= 500) {
      // The CPU intake-pause probe handles its one explicit 503 below.
      if (!(response.status === 503 && new URL(url).pathname === '/sdk/tryon')) {
        await response.body?.cancel();
        throw new Error('SECURITY_PROBE_UNEXPECTED_STATUS');
      }
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        bytes += item.value.length;
        if (bytes > 65536) throw new Error('SECURITY_PROBE_RESPONSE_LIMIT');
        chunks.push(item.value);
      }
    } finally { await reader.cancel(); }
    return new Response(response.status === 204 || response.status === 304 ? null : Buffer.concat(chunks), {
      status: response.status, headers: response.headers,
    });
  };
};

export const runLiveSecurityBoundaryTests = async (env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch) => {
  const target = validateLiveSecurityTarget(env);
  const required = (name: string) => requiredValue(name, env);
  const baseUrl = required('DRAPIXAI_SECURITY_TEST_API_URL').replace(/\/+$/, '');
  const serverKeyA = required('DRAPIXAI_SECURITY_TEST_SERVER_KEY_A');
  const shopperTokenA = required('DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A');
  const shopperTokenB = required('DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_B');
  const expiredShopperTokenA = required('DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A');
  const productA = required('DRAPIXAI_SECURITY_TEST_PRODUCT_A');
  const productB = required('DRAPIXAI_SECURITY_TEST_PRODUCT_B');
  const resultB = required('DRAPIXAI_SECURITY_TEST_RESULT_B');
  const originA = required('DRAPIXAI_SECURITY_TEST_ORIGIN_A');
  const originB = required('DRAPIXAI_SECURITY_TEST_ORIGIN_B');
  const publicApiTokenA = required('DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A');
  const rateLimitPath = required('DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH');
  const rateLimitAttempts = readBoundedInteger('DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS', 1, 200, env);
  if (productA === productB || shopperTokenA === shopperTokenB || shopperTokenA === expiredShopperTokenA) throw new Error('DISTINCT_TENANT_FIXTURES_REQUIRED');
  if (!/^[1-9]\d*$/.test(resultB)) throw new Error('NUMERIC_RESULT_FIXTURE_REQUIRED');
  for (const origin of [originA, originB]) if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('EXACT_SHOPPER_ORIGIN_REQUIRED');
  if (rateLimitPath !== '/v1/usage') throw new Error('RATE_LIMIT_PATH_MUST_BE_V1_USAGE');
  const fetch = createSecurityProbe(baseUrl, transport);
  for (const [token, origin, product] of [[shopperTokenA, originA, productA], [shopperTokenB, originB, productB]]) {
    const ownProduct = await fetch(`${baseUrl}/sdk/validate`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product }) });
    assert.equal(ownProduct.status, 200, 'Both tenants must positively validate their own ready products');
    assert.equal((await ownProduct.json() as { valid?: boolean }).valid, true);
  }
  const ownFeedback = await fetch(`${baseUrl}/sdk/tryon-feedback`, { method: 'POST', headers: { Authorization: `Bearer ${shopperTokenB}`, Origin: originB, 'Content-Type': 'application/json' }, body: JSON.stringify({ tryOnResultId: resultB, looksReal: true }) });
  assert.equal(ownFeedback.status, 200, 'Tenant B result must exist and accept owner feedback');
  assert.equal((await ownFeedback.json() as { ok?: boolean }).ok, true);
  const ownUsage = await fetch(`${baseUrl}/v1/usage`, { headers: { Authorization: `Bearer ${publicApiTokenA}` } });
  assert.equal(ownUsage.status, 200, 'Public API credential must work before denial probes');
  assert.ok(Number.isFinite((await ownUsage.json() as { quota?: number }).quota));
  const allowedCors = await fetch(`${baseUrl}/sdk/validate`, { method: 'OPTIONS', headers: { Origin: originA, 'Access-Control-Request-Method': 'POST' } });
  assert.ok([200, 204].includes(allowedCors.status));
  assert.equal(allowedCors.headers.get('access-control-allow-origin'), originA);

  const tokenForForeignProduct = await fetch(`${baseUrl}/sdk/storefront-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverKeyA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'web', productIds: [productB] }),
  });
  assert.equal(tokenForForeignProduct.status, 409, 'Tenant A must not mint a token for tenant B product');

  for (const [shopperToken, origin, foreignProduct] of [[shopperTokenA, originA, productB], [shopperTokenB, originB, productA]]) {
  const scopedValidation = await fetch(`${baseUrl}/sdk/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${shopperToken}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productId: foreignProduct }),
  });
  assert.equal(scopedValidation.status, 403, 'Each shopper token must reject the other tenant product');
  const scopedPayload = await scopedValidation.json() as { error?: string };
  assert.equal(scopedPayload.error, 'TOKEN_PRODUCT_SCOPE_DENIED');
  }

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

  if (target.mode === 'cpu') {
    const paused = await fetch(`${baseUrl}/sdk/tryon`, { method: 'POST', headers: { Authorization: `Bearer ${shopperTokenA}`, Origin: originA, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(paused.status, 503);
    assert.equal(paused.headers.get('x-drapixai-intake-status'), 'paused');
    assert.ok(Number(paused.headers.get('retry-after')) > 0);
    assert.equal((await paused.json() as { error?: string }).error, 'TRYON_TEMPORARILY_UNAVAILABLE');
  } else {
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
  }

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
  assert.ok([200, 204, 403].includes(corsPreflight.status), 'A missing or unavailable endpoint cannot prove CORS rejection');
  assert.notEqual(corsPreflight.headers.get('access-control-allow-origin'), attackerOrigin, 'CORS must not approve an unverified storefront origin');

  const csrfStyleAttempt = await fetch(`${baseUrl}/sdk/tryon-feedback`, {
    method: 'POST',
    headers: {
      Origin: attackerOrigin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tryOnResultId: resultB, looksReal: true }),
  });
  assert.ok([401, 403].includes(csrfStyleAttempt.status), 'Unauthenticated cross-origin state changes must be rejected by authentication/authorization');
  assert.notEqual(csrfStyleAttempt.headers.get('access-control-allow-origin'), attackerOrigin, 'Rejected cross-origin state changes must not receive CORS approval');

  const rateLimitStatuses: number[] = [];
  for (let attempt = 0; attempt < rateLimitAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}${rateLimitPath}`, {
      headers: { Authorization: `Bearer ${publicApiTokenA}` },
    });
    rateLimitStatuses.push(response.status);
    if (response.status === 429) {
      assert.ok(Number(response.headers.get('retry-after')) > 0, 'Rate-limited responses must include a positive Retry-After');
      break;
    }
    assert.equal(response.status, 200, 'Service errors and invalid credentials cannot prove rate limiting');
  }
  assert.ok(rateLimitStatuses.includes(429), 'Configured staging API-key rate limit was not enforced');
  assert.ok(rateLimitStatuses.includes(200), 'Rate-limit probe must observe admitted traffic before denial');

  return {
    status: target.mode === 'cpu' ? 'PARTIAL_CPU' : 'PASS',
    releaseCommit: target.releaseCommit,
    environment: 'staging',
    pending: target.mode === 'cpu' ? ['malicious_upload'] : [],
    checks: [
      'tenant_isolation',
      'credential_replay',
      target.mode === 'cpu' ? 'intake_disabled' : 'malicious_upload',
      'authorization',
      'webhook_ssrf',
      'cors',
      'csrf_style_request',
      'rate_limit',
    ],
    rate_limit_statuses: rateLimitStatuses,
  };
};

export const securityProbeExitCode = (report: { status: string }) => report.status === 'PASS' ? 0 : report.status === 'PARTIAL_CPU' ? 2 : 1;

if (require.main === module) runLiveSecurityBoundaryTests().then(report => {
  console.log(JSON.stringify(report));
  process.exitCode = securityProbeExitCode(report);
}).catch(() => { console.error('LIVE_SECURITY_BOUNDARY_TEST_FAILED'); process.exitCode = 1; });
