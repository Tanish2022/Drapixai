import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createSecurityProbe, runLiveSecurityBoundaryTests, securityProbeExitCode, validateLiveSecurityTarget } from './live-security-boundary-tests';

const token = () => crypto.randomBytes(32).toString('hex');
const environment = (): NodeJS.ProcessEnv => ({
  DRAPIXAI_SECURITY_TEST_API_URL: 'https://api.staging.example.invalid',
  DRAPIXAI_SECURITY_TEST_APPROVED_API_ORIGIN: 'https://api.staging.example.invalid',
  DRAPIXAI_SECURITY_TEST_AUTHORIZATION_REF: 'owned-synthetic-harness-contract-only',
  DRAPIXAI_EXPECTED_GIT_REF: 'a'.repeat(40), DRAPIXAI_SECURITY_TEST_ENVIRONMENT: 'staging',
  DRAPIXAI_SECURITY_TEST_SERVER_KEY_A: token(), DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A: token(),
  DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_B: token(), DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A: token(),
  DRAPIXAI_SECURITY_TEST_PRODUCT_A: 'owned-a', DRAPIXAI_SECURITY_TEST_PRODUCT_B: 'owned-b',
  DRAPIXAI_SECURITY_TEST_RESULT_B: '2', DRAPIXAI_SECURITY_TEST_ORIGIN_A: 'https://a.staging.example.invalid',
  DRAPIXAI_SECURITY_TEST_ORIGIN_B: 'https://b.staging.example.invalid',
  DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A: token(),
  DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH: '/v1/usage', DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS: '3',
});
const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
const fixture = (env: NodeJS.ProcessEnv, fault = '') => {
  const calls: { path: string; body: unknown }[] = [];
  let usage = 0;
  const transport: typeof fetch = async (input, options = {}) => {
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    const path = new URL(String(input)).pathname;
    const headers = new Headers(options.headers), bearer = headers.get('authorization');
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    calls.push({ path, body });
    if (fault === 'redirect') return response(307, {}, { location: 'https://unowned.example.invalid' });
    if (options.method === 'OPTIONS') {
      if (headers.get('origin') === env.DRAPIXAI_SECURITY_TEST_ORIGIN_A) return response(204, null, { 'access-control-allow-origin': headers.get('origin')! });
      if (fault === 'cors404') return response(404);
      return response(204);
    }
    if (path === '/v1/usage') {
      usage++;
      if (fault === 'badUsageCredential') return response(401);
      if (fault === 'rate503' && usage > 1) return response(503);
      if (fault === 'rate401' && usage > 1) return response(401);
      if (fault === 'neverRateLimits') return response(200, { quota: 10 });
      return usage < 3 ? response(200, { quota: 10 }) : response(429, {}, { 'retry-after': fault === 'badRetry' ? '0' : '10' });
    }
    if (path === '/sdk/validate') {
      if (fault === 'invalidPositive') return response(403);
      if (bearer === `Bearer ${env.DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A}`) return response(fault === 'expiredAccepted' ? 200 : 401);
      if (headers.get('origin') === 'https://replay-attacker.invalid') return response(403);
      if (bearer === `Bearer ${env.DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A}` && body.productId === 'owned-b') return response(403, { error: 'TOKEN_PRODUCT_SCOPE_DENIED' });
      if (bearer === `Bearer ${env.DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_B}` && body.productId === 'owned-a') return response(fault === 'reverseScopeAllowed' ? 200 : 403, { error: 'TOKEN_PRODUCT_SCOPE_DENIED' });
      return response(200, { valid: true });
    }
    if (path === '/sdk/tryon-feedback') {
      if (!bearer) return response(fault === 'csrf503' ? 503 : fault === 'csrf400' ? 400 : 401);
      return bearer === `Bearer ${env.DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_B}` ? response(200, { ok: true }) : response(404);
    }
    if (path === '/sdk/storefront-token') return response(409);
    if (path === '/sdk/tryon') return env.DRAPIXAI_SECURITY_TEST_MODE === 'cpu'
      ? response(503, { error: 'TRYON_TEMPORARILY_UNAVAILABLE' }, { 'x-drapixai-intake-status': 'paused', 'retry-after': '60' })
      : response(400, { error: 'INVALID_IMAGE_CONTENT' });
    if (path === '/admin/verify') return response(403);
    if (path === '/v1/webhook-endpoints') return response(400, { error: { code: 'INVALID_WEBHOOK_URL' } });
    throw new Error('UNEXPECTED_FIXTURE_ROUTE');
  };
  return { transport, calls };
};

async function main() {
  const checks: string[] = [];
  const env = environment();
  validateLiveSecurityTarget(env);
  for (const url of ['http://api.staging.example.invalid', 'https://api.drapixai.com', 'https://api.example.invalid',
    'https://api.staging.example.invalid/path', 'https://api.staging.example.invalid?x=1',
    'https://user:pass@api.staging.example.invalid', 'https://api.staging.example.invalid#fragment']) {
    assert.throws(() => validateLiveSecurityTarget({ ...env, DRAPIXAI_SECURITY_TEST_API_URL: url }));
  }
  for (const [key, value] of [['DRAPIXAI_SECURITY_TEST_ENVIRONMENT', 'production'], ['DRAPIXAI_SECURITY_TEST_APPROVED_API_ORIGIN', 'https://different.staging.example.invalid'],
    ['DRAPIXAI_SECURITY_TEST_AUTHORIZATION_REF', ''], ['DRAPIXAI_EXPECTED_GIT_REF', 'short'], ['DRAPIXAI_SECURITY_TEST_MODE', 'skip']]) {
    assert.throws(() => validateLiveSecurityTarget({ ...env, [key]: value }));
  }
  checks.push('Twelve unsafe or unapproved target/configurations rejected before transport');
  const full = fixture(env);
  const complete = await runLiveSecurityBoundaryTests(env, full.transport);
  assert.equal(complete.status, 'PASS'); assert.equal(securityProbeExitCode(complete), 0);
  assert.deepEqual(complete.pending, []);
  checks.push('Complete modeled contract reaches all positive and negative probes');
  const cpuEnv = { ...env, DRAPIXAI_SECURITY_TEST_MODE: 'cpu' }, cpu = fixture(cpuEnv);
  const partial = await runLiveSecurityBoundaryTests(cpuEnv, cpu.transport);
  assert.equal(partial.status, 'PARTIAL_CPU'); assert.equal(securityProbeExitCode(partial), 2);
  assert.deepEqual(partial.pending, ['malicious_upload']);
  assert.equal(cpu.calls.some(call => call.body instanceof FormData), false);
  assert.ok(cpu.calls.some(call => call.path === '/sdk/tryon' && JSON.stringify(call.body) === '{}'));
  checks.push('CPU mode proves explicit paused response, sends no multipart and cannot exit as a full pass');
  for (const fault of ['redirect', 'invalidPositive', 'badUsageCredential', 'expiredAccepted', 'reverseScopeAllowed', 'csrf503', 'csrf400', 'cors404', 'rate503', 'rate401', 'neverRateLimits', 'badRetry']) {
    await assert.rejects(runLiveSecurityBoundaryTests(env, fixture(env, fault).transport));
  }
  checks.push('Twelve false-pass scenarios rejected, including reverse tenant scope, service failure, missing CORS, invalid credentials and replay');
  for (const changes of [{ DRAPIXAI_SECURITY_TEST_PRODUCT_B: env.DRAPIXAI_SECURITY_TEST_PRODUCT_A },
    { DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_B: env.DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A },
    { DRAPIXAI_SECURITY_TEST_RESULT_B: 'not-numeric' }, { DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS: '201' }]) {
    let calls = 0;
    await assert.rejects(runLiveSecurityBoundaryTests({ ...env, ...changes }, async () => { calls++; return response(200); }));
    assert.equal(calls, 0);
  }
  checks.push('Invalid fixture identities and rate budget reject before any request');
  let requests = 0;
  const probe = createSecurityProbe(env.DRAPIXAI_SECURITY_TEST_API_URL!, async () => { requests++; return response(200); });
  await assert.rejects(probe('https://unowned.example.invalid/')); assert.equal(requests, 0);
  for (let i = 0; i < 250; i++) await probe(`${env.DRAPIXAI_SECURITY_TEST_API_URL}/health`);
  await assert.rejects(probe(`${env.DRAPIXAI_SECURITY_TEST_API_URL}/health`)); assert.equal(requests, 250);
  await assert.rejects(createSecurityProbe(env.DRAPIXAI_SECURITY_TEST_API_URL!, async () => new Response('x'.repeat(65537)))(env.DRAPIXAI_SECURITY_TEST_API_URL!));
  checks.push('Exact-origin request budget and response-size cap enforced');
  // The actual fetch implementation is tested only against owned loopback
  // sockets. The CLI target policy still rejects HTTP and localhost.
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(307, { location: '/destination' }); res.end(); }
    else if (req.url === '/stall') { res.writeHead(200); res.write('incomplete'); }
    else { requests++; res.end('{}'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  try {
    const before = requests, native = createSecurityProbe(origin, globalThis.fetch, 200);
    await assert.rejects(native(`${origin}/redirect`, { headers: { Authorization: `Bearer ${token()}` } }));
    assert.equal(requests, before, 'Real fetch must not follow redirect to destination');
    await assert.rejects(native(`${origin}/stall`));
    checks.push('Native fetch rejects redirects and aborts a response body stalled after headers');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  console.log(JSON.stringify({ passed: true, scope: 'HARNESS_CONTRACT_ONLY: modeled tenants and owned loopback transport; not deployed application security', checks }));
}
if (require.main === module) main().catch(() => { console.error('LIVE_SECURITY_HARNESS_TEST_FAILED'); process.exitCode = 1; });
