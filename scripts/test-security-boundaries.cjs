// Executes real route/module code with synthetic identities, fake DB/transport
// adapters and bounded streams. Native HTTP uses only a disposable loopback
// fixture. No external network, GPU, mail, secrets or real records.
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
        if (name.startsWith('@/')) return load(path.join('apps/web', `${name.slice(2)}.ts`));
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
// Small general Prisma adapter; real PostgreSQL concurrency is checked separately.
const matchesWhere = (record, where) => Object.entries(where).every(([name, condition]) => {
  if (condition === undefined) return true;
  if (name === 'AND' || name === 'OR') {
    const clauses = Array.isArray(condition) ? condition : [condition];
    return name === 'AND' ? clauses.every((clause) => matchesWhere(record, clause)) : clauses.some((clause) => matchesWhere(record, clause));
  }
  const value = record[name];
  if (condition === null) return value == null;
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition).every(([operator, expected]) => value != null && ({
      gt: () => value > expected, gte: () => value >= expected,
      lt: () => value < expected, lte: () => value <= expected,
    }[operator]?.() ?? false));
  }
  return value === condition;
});
function routeFixture(user, key = { kind: 'dashboard', scopes: 'dashboard', userId: 1 }) {
  const routes = new Map();
  const uses = [];
  const issued = [];
  let writes = 0;
  const router = { use(...handlers) { uses.push(...handlers); } };
  for (const method of ['post', 'get', 'delete']) router[method] = (name, ...handlers) => routes.set(`${method}:${name}`, handlers);
  const database = {
    user: { findUnique: async () => user, create: async () => { writes++; return user; }, update: async () => { writes++; return user; },
      updateMany: async ({ where, data }) => { if (!matchesWhere(user, where)) return { count: 0 }; Object.assign(user, data); writes++; return { count: 1 }; } },
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
  return { load, routes, uses, issued, writes: () => writes, env, database };
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
  const increment = async (key) => { const count = (counters.get(key) || 0) + 1; counters.set(key, count); return count; };
  const redis = { isReady: true, on() {}, incr: increment, pExpire: async () => {}, eval: async (_script, options) => increment(options.keys[0]) };
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const boundedFixture = async (operation, safetyMs = 250) => {
  let timer;
  try { return await Promise.race([operation, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('FIXTURE_SAFETY_TIMEOUT')), safetyMs); })]); }
  finally { clearTimeout(timer); }
};

for (const method of ['GET', 'POST']) test(`${method} slow-drip response hits total deadline and closes transport`, async () => {
  let destroyed = false, interval, idleTimer, idleMs, idleCallback;
  const clear = () => { clearInterval(interval); clearTimeout(idleTimer); };
  const resetIdle = () => { clearTimeout(idleTimer); if (idleCallback) idleTimer = setTimeout(idleCallback, idleMs); };
  const transport = { request: (_url, options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = (ms, cb) => { idleMs = ms; idleCallback = cb; resetIdle(); return request; };
    request.write = () => request;
    request.destroy = (error) => { destroyed = true; clear(); queueMicrotask(() => request.emit('error', error)); return request; };
    options.signal?.addEventListener('abort', () => request.destroy(options.signal.reason), { once: true });
    request.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter(); incoming.statusCode = 200; incoming.headers = {};
      callback(incoming);
      let chunks = 0;
      interval = setInterval(() => {
        resetIdle(); incoming.emit('data', Buffer.from('x'));
        if (++chunks === 24) { clear(); incoming.emit('end'); }
      }, 5);
    });
    return request;
  } };
  const remote = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, https: transport })('apps/api/src/lib/remote-fetch.ts');
  try {
    const result = method === 'GET' ? remote.safeFetchText('https://controlled.example.test', { timeoutMs: 25 })
      : remote.safePostJson('https://controlled.example.test', '{}', {}, { timeoutMs: 25 });
    await assert.rejects(boundedFixture(result), /REMOTE_FETCH_TIMEOUT/);
    assert.equal(destroyed, true);
  } finally { clear(); }
});

test('Outbound deadline includes a DNS lookup that never settles', async () => {
  const remote = loader({ 'dns/promises': { lookup: () => new Promise(() => {}) } })('apps/api/src/lib/remote-fetch.ts');
  await assert.rejects(boundedFixture(remote.safeFetchText('https://controlled.example.test', { timeoutMs: 20 })), /REMOTE_FETCH_TIMEOUT/);
});

test('DNS completion after the deadline cannot start a late connection', async () => {
  let connections = 0;
  const transport = { request: () => { connections++; throw Error('LATE_CONNECTION'); } };
  const remote = loader({ 'dns/promises': { lookup: async () => { await delay(60); return [{ address: '8.8.8.8', family: 4 }]; } }, https: transport })('apps/api/src/lib/remote-fetch.ts');
  await assert.rejects(boundedFixture(remote.safeFetchText('https://controlled.example.test', { timeoutMs: 20 })), /REMOTE_FETCH_TIMEOUT/);
  await delay(80); assert.equal(connections, 0);
});

test('Rejected redirect closes its transport instead of draining an unbounded body', async () => {
  let destroyed = false;
  const transport = { request: (_url, options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.destroy = (error) => { destroyed = true; queueMicrotask(() => request.emit('error', error)); return request; };
    options.signal?.addEventListener('abort', () => request.destroy(options.signal.reason), { once: true });
    request.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter(); incoming.statusCode = 302; incoming.headers = {}; incoming.resume = () => {};
      callback(incoming);
    });
    return request;
  } };
  const remote = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, https: transport })('apps/api/src/lib/remote-fetch.ts');
  await assert.rejects(remote.safeFetchText('https://controlled.example.test'), /REMOTE_REDIRECT_NOT_ALLOWED/);
  assert.equal(destroyed, true);
});

test('Normal webhook POST preserves payload, response and caller timeout', async () => {
  let written;
  const transport = { request: (_url, options, callback) => {
    assert.equal(options.method, 'POST'); assert.equal(options.headers['Content-Length'], '7');
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.write = (body) => { written = body; return request; };
    request.end = () => queueMicrotask(() => {
      const incoming = new EventEmitter(); incoming.statusCode = 202; incoming.headers = {};
      callback(incoming); incoming.emit('data', Buffer.from('ok')); incoming.emit('end');
    });
    return request;
  } };
  const remote = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, https: transport })('apps/api/src/lib/remote-fetch.ts');
  const result = await remote.safePostJson('https://controlled.example.test', '{"a":1}', {}, { timeoutMs: 100 });
  assert.equal(result.status, 202); assert.equal(result.body.toString(), 'ok'); assert.equal(written, '{"a":1}');
});

test('Invalid outbound byte/time budgets fail before DNS or transport', async () => {
  let lookups = 0;
  const remote = loader({ 'dns/promises': { lookup: async () => { lookups++; throw Error('DNS_NOT_ALLOWED'); } } })('apps/api/src/lib/remote-fetch.ts');
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { timeoutMs: -1 }, { timeoutMs: 2147483648 }, { maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: NaN }]) {
    await assert.rejects(remote.safeFetchText('https://controlled.example.test', options), /REMOTE_FETCH_LIMITS_INVALID/);
  }
  assert.equal(lookups, 0);
});

for (const status of [204, 205]) test(`Empty HTTP ${status} response resolves without an event-handler exception`, async () => {
  const transport = { request: (_url, _options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.end = () => queueMicrotask(() => {
      try {
        const incoming = new EventEmitter(); incoming.statusCode = status; incoming.headers = {};
        callback(incoming); incoming.emit('end');
      } catch (error) { request.emit('error', error); }
    });
    return request;
  } };
  const remote = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, https: transport })('apps/api/src/lib/remote-fetch.ts');
  const result = await remote.safeFetchText('https://controlled.example.test');
  assert.equal(result.response.status, status); assert.equal(result.text, '');
});

test('Native Node HTTP aborts slow GET/POST and redirect sockets while normal POST succeeds', async () => {
  const http = require('node:http');
  const closed = new Set(), received = new Set();
  let payload = '';
  const server = http.createServer((req, res) => {
    received.add(req.url);
    if (req.url === '/fast') {
      req.setEncoding('utf8'); req.on('data', (chunk) => { payload += chunk; });
      req.on('end', () => { res.writeHead(202); res.end('ok'); });
      return;
    }
    res.writeHead(req.url === '/redirect' ? 302 : 200);
    res.write('x');
    const drip = setInterval(() => res.write('x'), 5);
    res.once('close', () => { clearInterval(drip); closed.add(req.url); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    // Only the transport adapter points to the synthetic loopback fixture.
    // Real ClientRequest/IncomingMessage implement the AbortSignal handling.
    const transport = { request: (url, options, callback) => http.request(`http://127.0.0.1:${server.address().port}${url.pathname}`, options, callback) };
    const remote = loader({ 'dns/promises': { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }, http: transport, https: transport })('apps/api/src/lib/remote-fetch.ts');
    for (const method of ['GET', 'POST']) {
      const url = `https://controlled.example.test/${method}`;
      const result = method === 'GET' ? remote.safeFetchText(url, { timeoutMs: 150 }) : remote.safePostJson(url, '{}', {}, { timeoutMs: 150 });
      await assert.rejects(boundedFixture(result, 1000), /REMOTE_FETCH_TIMEOUT/);
      for (let attempt = 0; attempt < 40 && !closed.has(`/${method}`); attempt++) await delay(5);
      assert.equal(received.has(`/${method}`), true, 'Fixture must receive the request before cancellation');
      assert.equal(closed.has(`/${method}`), true, 'Deadline must close the real response socket');
    }
    await assert.rejects(boundedFixture(remote.safeFetchText('https://controlled.example.test/redirect'), 1000), /REMOTE_REDIRECT_NOT_ALLOWED/);
    for (let attempt = 0; attempt < 40 && !closed.has('/redirect'); attempt++) await delay(5);
    assert.equal(closed.has('/redirect'), true);
    const result = await boundedFixture(remote.safePostJson('https://controlled.example.test/fast', '{"a":1}', {}, { timeoutMs: 1000 }), 2000);
    assert.equal(result.status, 202); assert.equal(result.body.toString(), 'ok'); assert.equal(payload, '{"a":1}');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Timed-out webhook delivery preserves bounded retry accounting instead of hanging or marking delivered', async () => {
  const updates = [];
  const env = { NODE_ENV: 'test', DRAPIXAI_WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
  const load = loader({
    'dns/promises': { lookup: () => new Promise(() => {}) },
    '../lib/operational-metrics': { observeWebhookFailure() {} },
  }, {
    process: { env }, console: { ...console, error() {} },
    setTimeout: (callback) => setTimeout(callback, 20),
  });
  const service = load('apps/api/src/services/webhooks.ts');
  const delivery = { id: 'synthetic-delivery', attemptCount: 0, eventId: 'synthetic-event', eventType: 'tryon.completed', payload: { synthetic: true },
    endpoint: { isActive: true, url: 'https://controlled.example.test', encryptedSecret: service.encryptWebhookSecret('synthetic-webhook-signing-secret') } };
  const database = { webhookDelivery: {
    findMany: async () => [delivery], updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => { updates.push(data); },
  } };
  assert.equal(await boundedFixture(service.processPendingWebhookDeliveries(database)), 1);
  assert.equal(updates.length, 1); assert.equal(updates[0].status, 'retrying');
  assert.equal(updates[0].attemptCount, 1); assert.equal(updates[0].errorCode, 'REMOTE_FETCH_TIMEOUT');
  assert.equal(updates[0].responseCode, null); assert.ok(updates[0].nextAttemptAt.getTime() > Date.now());
});

for (const concurrent of [false, true]) test(`Administrator TOTP is consumed once for ${concurrent ? 'concurrent' : 'repeated'} logins`, async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin', emailVerifiedAt: new Date(0) });
  f.load('apps/api/src/routes/auth.ts');
  const handler = f.routes.get('post:/login').at(-1);
  const attempt = async () => { const res = response(); await handler({ body: { email: 'operator@example.test', password: 'correct-fixture-password', mfaCode: '287082' } }, res); return res; };
  const results = concurrent ? await Promise.all(Array.from({ length: 8 }, attempt)) : [await attempt(), await attempt()];
  assert.equal(results.filter((res) => res.statusCode === 200).length, 1);
  assert.equal(results.filter((res) => res.statusCode === 401).length, results.length - 1);
  assert.equal(f.issued.length, 1);
});

test('Administrator cannot use an earlier valid TOTP step after accepting a later step', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin', emailVerifiedAt: new Date(0) });
  f.load('apps/api/src/routes/auth.ts');
  const handler = f.routes.get('post:/login').at(-1);
  const first = response(), earlier = response();
  await handler({ body: { email: 'operator@example.test', password: 'correct-fixture-password', mfaCode: '359152' } }, first);
  await handler({ body: { email: 'operator@example.test', password: 'correct-fixture-password', mfaCode: '287082' } }, earlier);
  assert.equal(first.statusCode, 200); assert.equal(earlier.statusCode, 401); assert.equal(f.issued.length, 1);
});

test('MFA replay-state write failure denies login without issuing a privileged key', async () => {
  const f = routeFixture({ id: 1, email: 'operator@example.test', role: 'system_admin', emailVerifiedAt: new Date(0) });
  f.database.user.updateMany = async () => { throw Error('SYNTHETIC_MFA_STATE_UNAVAILABLE'); };
  f.load('apps/api/src/routes/auth.ts');
  const res = response();
  await f.routes.get('post:/login').at(-1)({ body: { email: 'operator@example.test', password: 'correct-fixture-password', mfaCode: '287082' } }, res);
  assert.equal(res.statusCode, 500); assert.equal(f.issued.length, 0);
});

test('Merchant password login does not require administrator MFA state', async () => {
  const f = routeFixture({ id: 2, email: 'merchant@example.test', role: 'brand_admin', emailVerifiedAt: new Date(0) });
  f.database.user.updateMany = async () => { throw Error('MFA_STATE_NOT_ALLOWED'); };
  f.load('apps/api/src/routes/auth.ts');
  const res = response();
  await f.routes.get('post:/login').at(-1)({ body: { email: 'merchant@example.test', password: 'correct-fixture-password' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(f.issued.length, 1);
});

function sessionFixture(overrides = {}, beforeTouch = () => {}) {
  const now = Date.now(), credential = 'dpx_synthetic_operator_session';
  const key = { id: 7, userId: 1, keyHash: require('node:crypto').createHash('sha256').update(credential).digest('hex'), kind: 'dashboard', scopes: 'dashboard,admin:mfa', isActive: true, revokedAt: null,
    createdAt: new Date(now - 3600000), lastUsedAt: new Date(now - 60000), expiresAt: new Date(now + 3600000), ...overrides };
  class FixedDate extends Date { constructor(value = now) { super(value); } static now() { return now; } }
  const database = { apiKey: {
    findUnique: async ({ where }) => where.keyHash === key.keyHash ? { ...key } : null,
    findFirst: async ({ where }) => matchesWhere(key, where) ? { ...key } : null,
    findMany: async () => [],
    update: async ({ data }) => { beforeTouch(key); Object.assign(key, data); return { ...key }; },
    updateMany: async ({ where, data }) => { beforeTouch(key); if (!matchesWhere(key, where)) return { count: 0 }; Object.assign(key, data); return { count: 1 }; },
  } };
  const auth = loader({}, { Date: FixedDate, process: { env: { NODE_ENV: 'production', JWT_SECRET: 'synthetic-preview-signing-secret-at-least-32' } } })('apps/api/src/lib/api-key-auth.ts');
  return { auth, database, key, now, credential };
}

for (const idle of [15 * 60000, 16 * 60000]) test(`Privileged session idle for ${idle / 60000} minutes cannot be revived`, async () => {
  const f = sessionFixture({ lastUsedAt: new Date(Date.now() - idle) });
  const last = f.key.lastUsedAt.getTime();
  assert.equal(await f.auth.resolveActiveApiKey(f.database, f.credential), null);
  assert.equal(f.key.lastUsedAt.getTime(), last);
});

test('Unused privileged session expires from creation time', async () => {
  const f = sessionFixture({ lastUsedAt: null, createdAt: new Date(Date.now() - 16 * 60000) });
  assert.equal(await f.auth.resolveActiveApiKey(f.database, f.credential), null);
  assert.equal(f.key.lastUsedAt, null);
});

test('Privileged session absolute age cannot be extended by a fresh last-used timestamp', async () => {
  const f = sessionFixture({ createdAt: new Date(Date.now() - 9 * 3600000), lastUsedAt: new Date() });
  assert.equal(await f.auth.resolveActiveApiKey(f.database, f.credential), null);
});

test('Recent privileged session remains usable and records activity', async () => {
  const f = sessionFixture();
  assert.ok(await f.auth.resolveActiveApiKey(f.database, f.credential));
  assert.equal(f.key.lastUsedAt.getTime(), f.now);
});

test('Concurrent key revocation wins over a privileged session activity update', async () => {
  const f = sessionFixture({}, (key) => { key.isActive = false; key.revokedAt = new Date(); });
  assert.equal(await f.auth.resolveActiveApiKey(f.database, f.credential), null);
});

test('Merchant and manual server-key lifetimes retain their existing policy', async () => {
  for (const type of [{ kind: 'dashboard', scopes: 'dashboard' }, { kind: 'manual', scopes: 'api:tryon' }]) {
    const f = sessionFixture({ ...type, createdAt: new Date(Date.now() - 2 * 86400000), lastUsedAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() + 86400000) });
    assert.ok(await f.auth.resolveActiveApiKey(f.database, f.credential));
  }
});

for (const expired of [true, false]) test(`Dashboard preview ${expired ? 'cannot revive idle operator session' : 'does not extend operator inactivity window'}`, async () => {
  const f = sessionFixture({ lastUsedAt: new Date(Date.now() - (expired ? 16 : 1) * 60000) });
  const last = f.key.lastUsedAt.getTime();
  const token = f.auth.issueDashboardPreviewToken({ apiKeyId: f.key.id, userId: f.key.userId, allowedDomain: 'preview.example.test' });
  const result = await f.auth.resolveSdkApiKey(f.database, token);
  assert.equal(Boolean(result), !expired); assert.equal(f.key.lastUsedAt.getTime(), last);
});

function browserSessionFixture(purpose = 'admin', mode = 'production') {
  const values = new Map(), writes = [], calls = [];
  const env = { NODE_ENV: mode, NEXT_PUBLIC_WEB_BASE_URL: 'https://app.example.test', ADMIN_SESSION_SECRET: 'synthetic-admin-browser-cookie-secret-32-plus', DASHBOARD_SESSION_SECRET: 'synthetic-dashboard-browser-cookie-secret-32-plus', DRAPIXAI_DASHBOARD_PROXY_TOKEN: 'synthetic-proxy-fixture' };
  const store = { get: (name) => values.has(name) ? { value: values.get(name) } : undefined,
    set: (cookie) => { writes.push(cookie); if (cookie.maxAge === 0) values.delete(cookie.name); else values.set(cookie.name, cookie.value); } };
  const fixture = { status: 200, expectedPassword: 'fixture-password' };
  const load = loader({
    'next/headers': { cookies: async () => store },
    '@/app/lib/server-env': { SERVER_API_BASE_URL: 'https://internal-api.example.test' },
    'next-auth/jwt': { getToken: async () => ({ apiKey: 'synthetic-browser-key' }) },
  }, { process: { env }, fetch: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/login')) {
      const payload = JSON.parse(init.body);
      return payload.password === fixture.expectedPassword ? Response.json({ apiKey: 'synthetic-browser-key' }) : Response.json({ error: 'INVALID' }, { status: 401 });
    }
    return Response.json({ ok: true }, { status: fixture.status });
  } });
  const session = load(`apps/web/app/lib/${purpose}-session.ts`);
  const prefix = purpose.toUpperCase();
  return { ...fixture, config: fixture, env, values, writes, calls, load, session,
    name: session[`${prefix}_SESSION_COOKIE`], legacy: `drapixai_${purpose}_session`,
    create: session[`create${purpose[0].toUpperCase()+purpose.slice(1)}SessionToken`],
    read: session[`read${purpose[0].toUpperCase()+purpose.slice(1)}SessionToken`],
  };
}

for (const purpose of ['admin', 'dashboard']) {
  test(`${purpose} cookie uses a host prefix in production and retains HTTP development naming`, async () => {
    const prod = browserSessionFixture(purpose), dev = browserSessionFixture(purpose, 'development');
    assert.equal(prod.name, `__Host-drapixai_${purpose}_session`);
    assert.equal(dev.name, `drapixai_${purpose}_session`);
    const token = await prod.create('synthetic-browser-key');
    assert.equal((await prod.read(token)).apiKey, 'synthetic-browser-key');
    assert.equal(await prod.read(token + '.extra'), null);
    const local = await dev.create('synthetic-browser-key');
    assert.equal((await dev.read(local)).apiKey, 'synthetic-browser-key');
  });

  test(`${purpose} cookie rejects legacy unbound ciphertext even when supplied under the new name`, async () => {
    const f = browserSessionFixture(purpose);
    const crypto = require('node:crypto').webcrypto;
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', Buffer.from(f.env[`${purpose.toUpperCase()}_SESSION_SECRET`])), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(JSON.stringify({ scope: purpose, apiKey: 'synthetic-browser-key', expiresAt: Date.now()+60000 })));
    const legacy = Buffer.from(iv).toString('base64url')+'.'+Buffer.from(cipher).toString('base64url');
    assert.equal(await f.read(legacy), null);
  });

  test(`${purpose} production proxy ignores legacy-only cookies before contacting the API`, async () => {
    const f = browserSessionFixture(purpose);
    f.values.set(f.legacy, await f.create('synthetic-browser-key'));
    const route = f.load(`apps/web/app/api/${purpose}/proxy/[...path]/route.ts`);
    const { NextRequest } = createRequire(path.join(root, 'apps/web/package.json'))('next/server');
    const segments = purpose === 'admin' ? ['overview'] : ['analytics', 'summary'];
    const result = await route.GET(new NextRequest('https://app.example.test/api/proxy'), { params: Promise.resolve({ path: segments }) });
    assert.equal(result.status, 401); assert.equal(f.calls.length, 0);
  });

  test(`${purpose} login and logout apply host-only cookie policy and retire the legacy name`, async () => {
    const f = browserSessionFixture(purpose);
    const route = f.load(`apps/web/app/api/${purpose}/session/route.ts`);
    const payload = { mode: 'login', email: 'fixture@example.test', password: f.config.expectedPassword, mfaCode: '123456' };
    assert.equal((await route.POST(new Request('https://app.example.test/api/session', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: JSON.stringify(payload) }))).status, 200);
    const primary = f.writes.find((cookie) => cookie.name === `__Host-drapixai_${purpose}_session` && cookie.maxAge > 0);
    assert.ok(primary); assert.equal(primary.secure, true); assert.equal(primary.httpOnly, true);
    assert.equal(primary.sameSite, 'strict'); assert.equal(primary.path, '/'); assert.equal(primary.domain, undefined);
    assert.ok(f.writes.some((cookie) => cookie.name === f.legacy && cookie.maxAge === 0));
    f.writes.length = 0;
    await route.DELETE(new Request('https://app.example.test/api/session', { method: 'DELETE', headers: { origin: 'https://app.example.test' } }));
    assert.ok(f.writes.some((cookie) => cookie.name === primary.name && cookie.maxAge === 0));
    assert.ok(f.writes.some((cookie) => cookie.name === f.legacy && cookie.maxAge === 0));
    assert.equal(f.values.has(primary.name), false);
  });

  test(`${purpose} development login retains usable HTTP-only localhost configuration`, async () => {
    const f = browserSessionFixture(purpose, 'development');
    const result = await f.load(`apps/web/app/api/${purpose}/session/route.ts`).POST(new Request('https://app.example.test/api/session', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'login', email: 'fixture@example.test', password: f.config.expectedPassword, mfaCode: '123456' }),
    }));
    assert.equal(result.status, 200);
    const primary = f.writes.find((cookie) => cookie.name === f.legacy && cookie.maxAge > 0);
    assert.ok(primary); assert.equal(primary.secure, false); assert.equal(primary.httpOnly, true);
    assert.equal(primary.sameSite, 'strict'); assert.equal(primary.path, '/'); assert.equal(primary.domain, undefined);
  });

  test(`${purpose} proxy clears the browser cookie when the backend rejects the credential`, async () => {
    const f = browserSessionFixture(purpose); f.values.set(f.name, await f.create('synthetic-browser-key')); f.config.status = 401;
    const { NextRequest } = createRequire(path.join(root, 'apps/web/package.json'))('next/server');
    const route = f.load(`apps/web/app/api/${purpose}/proxy/[...path]/route.ts`);
    const pathSegments = purpose === 'admin' ? ['overview'] : ['analytics', 'summary'];
    const result = await route.GET(new NextRequest('https://app.example.test/api/proxy'), { params: Promise.resolve({ path: pathSegments }) });
    assert.equal(result.status, 401); assert.ok(f.writes.some((cookie) => cookie.name === f.name && cookie.maxAge === 0));
  });
}

test('Google dashboard bridge uses the same protected cookie and legacy retirement policy', async () => {
  const f = browserSessionFixture('dashboard');
  const result = await f.load('apps/web/app/api/dashboard/oauth-session/route.ts').POST(new Request('https://app.example.test/api/session', { method: 'POST', headers: { origin: 'https://app.example.test' } }));
  assert.equal(result.status, 200);
  assert.ok(f.writes.some((cookie) => cookie.name === '__Host-drapixai_dashboard_session' && cookie.secure && cookie.httpOnly && cookie.path === '/' && cookie.maxAge > 0 && !cookie.domain));
  assert.ok(f.writes.some((cookie) => cookie.name === f.legacy && cookie.maxAge === 0));
});

test('Admin browser login preserves significant password whitespace', async () => {
  const f = browserSessionFixture(); f.config.expectedPassword = '  fixture-password  ';
  const result = await f.load('apps/web/app/api/admin/session/route.ts').POST(new Request('https://app.example.test/api/session', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fixture@example.test', password: f.config.expectedPassword, mfaCode: '123456' }) }));
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(f.calls[0].init.body).password, f.config.expectedPassword);
});

test('Merchant permission rejection does not log out an otherwise valid browser session', async () => {
  const f = browserSessionFixture('dashboard'); f.values.set(f.name, await f.create('synthetic-browser-key')); f.config.status = 403;
  const { NextRequest } = createRequire(path.join(root, 'apps/web/package.json'))('next/server');
  const result = await f.load('apps/web/app/api/dashboard/proxy/[...path]/route.ts').GET(new NextRequest('https://app.example.test/api/proxy'), { params: Promise.resolve({ path: ['account', 'profile'] }) });
  assert.equal(result.status, 403); assert.equal(f.values.has(f.name), true); assert.equal(f.writes.length, 0);
});

test('Admin request helper handles later expiry once and stops queued private requests', async () => {
  let calls = 0, redirects = 0;
  const { createAdminFetch } = loader({}, { fetch: async () => { calls++; return Response.json({ error: 'EXPIRED' }, { status: 401 }); } })('apps/web/app/lib/admin-fetch.ts');
  const adminFetch = createAdminFetch(() => { redirects++; });
  assert.equal((await adminFetch('overview')).status, 401);
  assert.equal((await adminFetch('garments')).status, 401);
  assert.equal(calls, 1); assert.equal(redirects, 1);
});

test('Late successful admin response is discarded after another request expires the session', async () => {
  let finish, redirects = 0, cancelled = false;
  const { createAdminFetch } = loader({}, { fetch: async (url) => String(url).endsWith('/overview')
    ? new Promise((resolve) => { finish = resolve; }) : Response.json({ error: 'EXPIRED' }, { status: 403 }) })('apps/web/app/lib/admin-fetch.ts');
  const adminFetch = createAdminFetch(() => { redirects++; });
  const pending = adminFetch('overview');
  assert.equal((await adminFetch('garments')).status, 403);
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 }));
  assert.equal((await pending).status, 401); assert.equal(redirects, 1); assert.equal(cancelled, true);
});

test('Ordinary backend failure does not permanently expire the admin request helper', async () => {
  let calls = 0, redirects = 0;
  const { createAdminFetch } = loader({}, { fetch: async () => Response.json({}, { status: ++calls === 1 ? 503 : 200 }) })('apps/web/app/lib/admin-fetch.ts');
  const adminFetch = createAdminFetch(() => { redirects++; });
  assert.equal((await adminFetch('overview')).status, 503);
  assert.equal((await adminFetch('overview')).status, 200);
  assert.equal(redirects, 0); assert.equal(calls, 2);
});

test('Rate-limit expiry failure cannot create a persistent new counter', async () => {
  let persistent = false, calls = 0;
  const redis = { isReady: true, on() {},
    incr: async () => { persistent = true; return 1; },
    pExpire: async () => { throw Error('SYNTHETIC_EXPIRY_DENIED'); },
    eval: async () => { calls++; throw Error('SYNTHETIC_EXPIRY_DENIED'); },
  };
  const { createRateLimitMiddleware } = loader({ redis: { createClient: () => redis } }, {
    process: { env: { NODE_ENV: 'production' } }, console: { error() {} },
  })('apps/api/src/lib/rate-limit.ts');
  const res = response(); let allowed = false;
  await createRateLimitMiddleware(5, 60000)( { ip: 'fixture', baseUrl: '/test', path: '/' }, res, () => { allowed = true; });
  assert.equal(persistent, false); assert.equal(calls, 1);
  assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'RATE_LIMITER_UNAVAILABLE'); assert.equal(allowed, false);
});

test('Malformed Redis count fails closed in production', async () => {
  const redis = { isReady: true, on() {}, incr: async () => 'invalid', pExpire: async () => {}, eval: async () => 'invalid' };
  const { createRateLimitMiddleware } = loader({ redis: { createClient: () => redis } }, {
    process: { env: { NODE_ENV: 'production' } }, console: { error() {} },
  })('apps/api/src/lib/rate-limit.ts');
  const res = response(); let allowed = false;
  await createRateLimitMiddleware(5, 60000)({ ip: 'fixture', baseUrl: '/test', path: '/' }, res, () => { allowed = true; });
  assert.equal(res.statusCode, 503); assert.equal(allowed, false);
});

test('Malformed admin credential types fail before an upstream authentication request', async () => {
  const f = browserSessionFixture();
  const response = await f.load('apps/web/app/api/admin/session/route.ts').POST(new Request('https://app.example.test/api/session', {
    method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ email: { unexpected: true }, password: ['fixture-password'] }),
  }));
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${tests.length - failures}/${tests.length} security boundary cases passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });
