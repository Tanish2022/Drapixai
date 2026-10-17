// Executes real route/module code with synthetic identities, fake DB/transport
// adapters and bounded streams. No network, GPU, mail, secrets or real records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const ts = require('../apps/web/node_modules/typescript');
const root = path.resolve(__dirname, '..');

function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, {
      exports, Buffer, URL, Headers, Request, Response, AbortController, AbortSignal,
      TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Date, crypto: require('node:crypto').webcrypto,
      atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      console, process: { env: { NODE_ENV: 'test' } },
      ...globals,
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), `${name}.ts`))) return load(path.resolve(path.dirname(file), `${name}.ts`));
        return createRequire(file)(name);
      },
    }, { filename: file });
    return exports;
  }
  return load;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
function routeFixture(user, key = { kind: 'dashboard', scopes: 'dashboard', userId: 1 }) {
  const routes = new Map();
  const uses = [];
  const issued = [];
  let writes = 0;
  const router = { use(...handlers) { uses.push(...handlers); } };
  for (const method of ['post', 'get', 'delete']) router[method] = (name, ...handlers) => routes.set(`${method}:${name}`, handlers);
  const database = {
    user: { findUnique: async () => user, create: async () => { writes++; return user; }, update: async () => { writes++; return user; } },
  };
  class FixedDate extends Date { constructor(value = 59000) { super(value); } static now() { return 59000; } }
  const env = { NODE_ENV: 'production', DRAPIXAI_AUTH_SYNC_TOKEN: 'local-fixture-auth-sync-only', DRAPIXAI_ADMIN_EMAIL: 'operator@example.test', DRAPIXAI_ADMIN_TOTP_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
  const load = loader({
    express: { Router: () => router }, '@prisma/client': { PrismaClient: class { constructor() { return database; } } },
    bcryptjs: { compare: async (password) => password === 'correct-fixture-password', hash: async () => 'fixture-hash' },
    '../lib/rate-limit': { createRateLimitMiddleware: () => (_q, _s, next) => next() },
    redis: { createClient: () => ({ on() {}, connect: async () => {} }) },
    '../lib/api-key-auth': { issueApiKeyForUser: async (_db, _id, options) => { issued.push(options); return 'synthetic-key'; }, resolveActiveApiKey: async () => key },
    '../lib/audit-log': { appendSecurityAudit: async () => {} },
    '../services/emailer': { sendOtpEmail: async () => { throw Error('MAIL_NOT_ALLOWED'); }, sendWelcomeEmail: async () => {} },
  }, { process: { env }, Date: FixedDate });
  return { load, routes, uses, issued, writes: () => writes, env };
}

test('OAuth cannot issue a privileged key without local MFA', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin', companyName: 'Fixture' });
  f.load('apps/api/src/routes/auth.ts');
  const res = response();
  await f.routes.get('post:/oauth/google').at(-1)({ headers: { 'x-drapixai-auth-sync-token': f.env.DRAPIXAI_AUTH_SYNC_TOKEN }, body: { email: 'operator@example.test', issueNewKey: true } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(f.issued.length, 0);
  assert.equal(f.writes(), 0);
});

test('Verified merchant OAuth remains usable', async () => {
  const f = routeFixture({ id: 2, email: 'merchant@example.test', role: 'brand_admin', companyName: 'Fixture' });
  f.load('apps/api/src/routes/auth.ts');
  const res = response();
  await f.routes.get('post:/oauth/google').at(-1)({ headers: { 'x-drapixai-auth-sync-token': f.env.DRAPIXAI_AUTH_SYNC_TOKEN }, body: { email: 'merchant@example.test', issueNewKey: true } }, res);
  assert.equal(res.statusCode, 200); assert.equal(f.issued.length, 1);
});

test('Password/TOTP admin login issues bounded MFA-assured key; missing code denied', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin', emailVerifiedAt: new Date(0) });
  f.load('apps/api/src/routes/auth.ts');
  const handler = f.routes.get('post:/login').at(-1);
  const denied = response();
  await handler({ body: { email: 'operator@example.test', password: 'correct-fixture-password' } }, denied);
  assert.equal(denied.statusCode, 401); assert.equal(f.issued.length, 0);
  const accepted = response();
  await handler({ body: { email: 'operator@example.test', password: 'correct-fixture-password', mfaCode: '287082' } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.ok(f.issued[0]?.scopes.includes('admin:mfa'));
  assert.equal(f.issued[0].expiresAt.getTime(), 59000 + 8 * 60 * 60 * 1000);
});

test('Admin API denies older/non-MFA keys even for an operator identity', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin' });
  f.load('apps/api/src/routes/admin.ts');
  const middleware = f.uses.at(-1);
  const res = response(); let nextCalled = false;
  await middleware({ headers: { authorization: 'Bearer synthetic-key' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false); assert.equal(res.statusCode, 403);
});

test('Admin API accepts a password/TOTP-assured dashboard key for the configured operator', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin' }, { kind: 'dashboard', scopes: 'dashboard,admin:mfa', userId: 1 });
  f.load('apps/api/src/routes/admin.ts');
  let accepted = false;
  await f.uses.at(-1)({ headers: { authorization: 'Bearer synthetic-key' } }, response(), () => { accepted = true; });
  assert.equal(accepted, true);
});

test('Google callback rejects unverified email before syncing or issuing a key', async () => {
  let options; let calls = 0;
  const load = loader({ 'next-auth': (value) => { options = value; return () => {}; }, 'next-auth/providers/google': () => ({}) }, {
    process: { env: { GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture' } },
    fetch: async () => { calls++; return { ok: true, json: async () => ({ apiKey: 'synthetic-key' }) }; },
  });
  load('apps/web/app/api/auth/[...nextauth]/route.ts');
  const accepted = await options.callbacks.signIn({ user: { email: 'merchant@example.test' }, profile: { email: 'merchant@example.test', email_verified: false } });
  assert.equal(accepted, false); assert.equal(calls, 0);
  assert.equal(await options.callbacks.signIn({ user: { email: 'merchant@example.test' }, profile: { email: 'merchant@example.test', email_verified: true } }), true);
  assert.equal(calls, 1);
});

test('Chunked proxy body is cancelled at the limit without a whole-body read', async () => {
  const load = loader({}, { process: { env: { DRAPIXAI_WEB_PROXY_MAX_BODY_BYTES: '8' } } });
  const { readLimitedProxyBody } = load('apps/web/app/lib/request-guard.ts');
  let bulkRead = false, cancelled = false, reads = 0;
  const request = { method: 'POST', headers: new Headers(), body: { getReader: () => ({
    read: async () => { reads++; return reads < 100 ? { done: false, value: new Uint8Array(8) } : { done: true }; },
    cancel: async () => { cancelled = true; }, releaseLock() {},
  }) }, arrayBuffer: async () => { bulkRead = true; return new ArrayBuffer(800); } };
  const result = await readLimitedProxyBody(request);
  assert.equal(result.rejection?.status, 413); assert.equal(bulkRead, false); assert.equal(cancelled, true); assert.ok(reads <= 2);
});

test('Proxy preserves a valid binary body at the exact configured boundary', async () => {
  const { readLimitedProxyBody } = loader({}, { process: { env: { DRAPIXAI_WEB_PROXY_MAX_BODY_BYTES: '8' } } })('apps/web/app/lib/request-guard.ts');
  const expected = new Uint8Array([0, 1, 13, 10, 255, 2, 3, 4]);
  const request = new Request('https://app.example.test', { method: 'POST', body: expected });
  const result = await readLimitedProxyBody(request);
  assert.equal(result.rejection, null); assert.deepEqual(Buffer.from(result.body), Buffer.from(expected));
});

test('CSRF rejects null/malformed/foreign Origin even with a same-site Referer', async () => {
  const { isSameOriginRequest } = loader({}, { process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_WEB_BASE_URL: 'https://app.example.test' } } })('apps/web/app/lib/request-guard.ts');
  for (const origin of ['null', 'malformed', 'https://foreign.example.test']) {
    assert.equal(isSameOriginRequest(new Request('https://app.example.test', { headers: { origin, referer: 'https://app.example.test/dashboard' } })), false);
  }
  assert.equal(isSameOriginRequest(new Request('https://app.example.test', { headers: { origin: 'https://app.example.test' } })), true);
  assert.equal(isSameOriginRequest(new Request('https://app.example.test', { headers: { referer: 'https://app.example.test/dashboard' } })), true);
  assert.equal(isSameOriginRequest(new Request('https://app.example.test')), false);
});

test('Changing object IDs cannot reset a route rate-limit bucket', async () => {
  const counters = new Map();
  const redis = { isReady: true, on() {}, incr: async (key) => { const count = (counters.get(key) || 0) + 1; counters.set(key, count); return count; }, pExpire: async () => {} };
  const { createRateLimitMiddleware, rateLimitRouteKey } = loader({ redis: { createClient: () => redis } })('apps/api/src/lib/rate-limit.ts');
  const guard = createRateLimitMiddleware(1, 60000);
  let successes = 0;
  for (const id of ['1', '2']) {
    const req = { ip: '192.0.2.1', baseUrl: '/v1', path: `/tryons/${id}`, route: { path: '/tryons/:id' } };
    const res = response(); await guard(req, res, () => { successes++; });
    assert.equal(res.statusCode, id === '1' ? 200 : 429);
  }
  assert.equal(successes, 1);
  assert.equal(rateLimitRouteKey({ baseUrl: '/v1', path: '/unknown-1' }), rateLimitRouteKey({ baseUrl: '/v1', path: '/unknown-2' }));
});

for (const method of ['get', 'post']) for (const allowed of [false, true]) {
  test(`Product-scoped token ${allowed ? 'can access its own' : 'cannot access another'} product via ${method}`, async () => {
    const routes = new Map();
    const router = { use() {} };
    for (const verb of ['get', 'post', 'delete']) router[verb] = (route, ...handlers) => routes.set(`${verb}:${route}`, handlers);
    const result = { id: 11, userId: 2, productId: allowed ? 'PRODUCT-A' : 'PRODUCT-B', status: 'rejected', createdAt: new Date(), candidateCount: 1 };
    const database = {
      tryOnResult: { findFirst: async ({ where }) => where.id === 11 && where.userId === 2 ? result : null },
      apiIdempotencyRecord: { findUnique: async () => ({ id: 'fixture', state: 'completed', tryOnResultId: 11, responseStatus: 422 }) },
    };
    const load = loader({ express: { Router: () => router }, '@prisma/client': { PrismaClient: class { constructor() { return database; } } },
      './sdk': () => { throw Error('GENERATION_NOT_ALLOWED'); },
      '../lib/rate-limit': { createRateLimitMiddleware: () => () => {} },
      '../services/webhooks': {}, '../lib/audit-log': {},
    });
    load('apps/api/src/routes/v1.ts');
    const req = { params: { id: '11' }, user: { id: 2 }, publicApiContext: { productIds: ['PRODUCT-A'] }, headers: { 'idempotency-key': 'fixture-idempotency-key' } };
    const res = response();
    await routes.get(method === 'get' ? 'get:/tryons/:id' : 'post:/tryons').at(-1)(req, res, () => { throw Error('GENERATION_NOT_ALLOWED'); });
    assert.equal(res.statusCode, allowed ? (method === 'get' ? 200 : 422) : (method === 'get' ? 404 : 409));
    if (!allowed) {
      assert.equal(JSON.stringify(res.body).includes('PRODUCT-B'), false);
      assert.equal(res.body?.tryOnResultId, undefined);
    }
  });
}

for (const mutation of ['no-expiry', 'overlong', 'future-issued', 'wrong-audience', 'wrong-issuer', 'wrong-algorithm', 'expired']) {
  test(`Public JWT rejects ${mutation}`, async () => {
    const secret = 'synthetic-signing-secret-for-local-test-only';
    const load = loader({}, { process: { env: { DRAPIXAI_STOREFRONT_TOKEN_SECRET: secret, DRAPIXAI_API_ENVIRONMENT: 'sandbox' } } });
    const auth = load('apps/api/src/lib/api-key-auth.ts');
    const jwt = createRequire(path.join(root, 'apps/api/package.json'))('jsonwebtoken');
    const now = Math.floor(Date.now() / 1000);
    const claims = { kind: 'public-api', userId: 2, apiKeyId: 3, purpose: 'tryon', scopes: ['api:tryon'], productIds: ['PRODUCT-A'], environment: 'sandbox', iat: now, exp: now + 900 };
    if (mutation === 'no-expiry') delete claims.exp;
    if (mutation === 'overlong') claims.exp = now + 3600;
    if (mutation === 'future-issued') { claims.iat = now + 3600; claims.exp = now + 4500; }
    if (mutation === 'expired') { claims.iat = now - 1800; claims.exp = now - 900; }
    const encoded = jwt.sign(claims, secret, { algorithm: mutation === 'wrong-algorithm' ? 'HS384' : 'HS256', audience: mutation === 'wrong-audience' ? 'other-app' : 'drapixai-public-api', issuer: mutation === 'wrong-issuer' ? 'other-issuer' : 'drapixai-api' });
    const database = { apiKey: { findFirst: async () => ({ id: 3, userId: 2, kind: 'manual', scopes: 'api:tryon' }) } };
    assert.equal(await auth.resolvePublicApiToken(database, 'dpxapi_' + encoded), null);
  });
}

test('Normal issued public JWT and signing-key overlap remain valid', async () => {
  const env = { DRAPIXAI_STOREFRONT_TOKEN_SECRET: 'synthetic-signing-secret-for-local-test-only', DRAPIXAI_API_ENVIRONMENT: 'sandbox' };
  const auth = loader({}, { process: { env } })('apps/api/src/lib/api-key-auth.ts');
  const token = auth.issuePublicApiToken({ apiKeyId: 3, userId: 2, scopes: ['api:tryon'], productIds: ['PRODUCT-A'], environment: 'sandbox' });
  const database = { apiKey: { findFirst: async () => ({ id: 3, userId: 2, kind: 'manual', scopes: 'api:tryon' }) } };
  assert.ok(await auth.resolvePublicApiToken(database, token));
  env.DRAPIXAI_STOREFRONT_TOKEN_PREVIOUS_SECRETS = env.DRAPIXAI_STOREFRONT_TOKEN_SECRET;
  env.DRAPIXAI_STOREFRONT_TOKEN_SECRET = 'rotated-synthetic-signing-secret-for-local-test-only';
  assert.ok(await auth.resolvePublicApiToken(database, token));
  database.apiKey.findFirst = async () => null;
  assert.equal(await auth.resolvePublicApiToken(database, token), null, 'Parent-key revocation must override a valid JWT');
});

test('Outbound address policy preserves public IPv4/IPv6 and rejects mixed public/private DNS', async () => {
  const load = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] } });
  const { isPublicRemoteAddress, isPublicRemoteUrl } = load('apps/api/src/lib/network-address.ts');
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808']) assert.equal(isPublicRemoteAddress(address), true, address);
  for (const address of ['0.0.0.0', '127.0.0.1', '169.254.169.254', '192.0.2.1', '::1', 'fc00::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicRemoteAddress(address), false, address);
  assert.equal(isPublicRemoteUrl('https://[2606:4700:4700::1111]/'), true);
  assert.equal(isPublicRemoteUrl('https://[::ffff:7f00:1]/'), false);
  await assert.rejects(load('apps/api/src/lib/remote-fetch.ts').safeFetchText('https://controlled.example.test'), /REMOTE_HOST_NOT_ALLOWED/);
});

test('Outbound public request pins the validated DNS address and preserves its response', async () => {
  let connections = 0;
  const transport = { request: (_url, options, callback) => {
    connections++;
    assert.equal(options.family, 6);
    options.lookup('controlled.example.test', {}, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, '2606:4700:4700::1111'); assert.equal(family, 6);
    });
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter(); incoming.statusCode = 200; incoming.headers = { 'content-type': 'text/plain' };
      callback(incoming); incoming.emit('data', Buffer.from('public response')); incoming.emit('end');
    });
    return request;
  } };
  const load = loader({ 'dns/promises': { lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }] }, https: transport });
  const result = await load('apps/api/src/lib/remote-fetch.ts').safeFetchText('https://controlled.example.test');
  assert.equal(result.text, 'public response'); assert.equal(connections, 1);
});

test('Oversized declared outbound response rejects through an installed error listener', async () => {
  const transport = { request: (_url, _options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter(); incoming.statusCode = 200; incoming.headers = { 'content-length': '100' };
      incoming.destroy = (error) => incoming.emit('error', error);
      try { callback(incoming); } catch { request.emit('error', new Error('UNHANDLED_RESPONSE_ERROR')); }
    });
    return request;
  } };
  const load = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, https: transport });
  await assert.rejects(load('apps/api/src/lib/remote-fetch.ts').safeFetchText('https://controlled.example.test', { maxBytes: 8 }), /REMOTE_RESPONSE_TOO_LARGE/);
});

for (const address of ['100.64.1.2', '198.18.0.1', '::ffff:7f00:1', 'fe90::1']) {
  test(`Outbound SSRF guard rejects nonpublic address ${address} before connection`, async () => {
    let connections = 0;
    const fakeTransport = { request: (_url, _options, callback) => {
      connections++;
      const request = new EventEmitter();
      request.setTimeout = () => request; request.write = () => request;
      request.destroy = (error) => { queueMicrotask(() => request.emit('error', error)); return request; };
      request.end = () => queueMicrotask(() => { const incoming = new EventEmitter(); incoming.statusCode = 200; incoming.headers = {}; incoming.resume = () => {}; callback(incoming); incoming.emit('end'); });
      return request;
    } };
    const load = loader({ 'dns/promises': { lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] }, http: fakeTransport, https: fakeTransport });
    const { safeFetchText } = load('apps/api/src/lib/remote-fetch.ts');
    await assert.rejects(safeFetchText('https://controlled.example.test'), /REMOTE_HOST_NOT_ALLOWED/);
    assert.equal(connections, 0);
  });
}

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${tests.length - failures}/${tests.length} security boundary cases passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });
