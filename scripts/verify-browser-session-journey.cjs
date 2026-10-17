// Optional local integration test. Uses bundled Playwright/Chrome, an ephemeral
// HTTPS certificate and synthetic loopback API; never connects to operator data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(path.join(process.env.DRAPIXAI_BROWSER_MODULES || '', 'playwright'));
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'runtime/launch-evidence/browser-sessions-2026-10-18');
const dist = '.next-browser-session-audit';
fs.mkdirSync(output, { recursive: true });
const envFile = path.join(root, 'apps/web/next-env.d.ts'), configFile = path.join(root, 'apps/web/tsconfig.json');
const beforeEnv = fs.readFileSync(envFile), beforeConfig = fs.readFileSync(configFile);
const report = { scope: 'local production web build and real browser; synthetic API/SSO identity; not live staging, Google, MFA-provider, merchant or GPU certification', generatedAt: new Date().toISOString(), checks: [], pageErrors: [], browser: '', passed: false };
const sourceFiles = [
  'scripts/verify-browser-session-journey.cjs', 'apps/web/app/lib/session-cookie.ts',
  'apps/web/app/lib/admin-fetch.ts', 'apps/web/app/lib/admin-session.ts', 'apps/web/app/lib/dashboard-session.ts',
  'apps/web/app/admin/page.tsx', 'apps/web/app/admin-access/page.tsx',
  'apps/web/app/api/admin/session/route.ts', 'apps/web/app/api/dashboard/session/route.ts',
  'apps/web/app/api/admin/proxy/[...path]/route.ts', 'apps/web/app/api/dashboard/proxy/[...path]/route.ts',
  'apps/web/app/api/dashboard/oauth-session/route.ts', 'apps/web/next.config.js',
];
report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
report.dirtyCheckout = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
report.sourceSha256 = Object.fromEntries(sourceFiles.map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
report.sourceLfSha256 = Object.fromEntries(sourceFiles.map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')).digest('hex')]));
let api, edge, next, browser, build, exit;
let adminStatus = 200, issued = 0;
const keys = new Map();
const fixtureKey = (role) => { const key = `synthetic-browser-${role}-${++issued}`; keys.set(key, role); return key; };
const listen = async (server) => { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); return server.address().port; };
const close = async (server) => { if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
const runChild = (args, env, file) => {
  const stream = fs.createWriteStream(path.join(output, file));
  const child = spawn(process.execPath, args, { cwd: path.join(root, 'apps/web'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
  child.once('close', () => stream.end());
  return child;
};
const childDone = (child) => new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code) => resolve(code)); });
const restoreGeneratedConfig = () => {
  const afterEnv = fs.readFileSync(envFile, 'utf8').replaceAll(`./${dist}/`, './.next/');
  assert.equal(afterEnv.replaceAll('\r\n', '\n'), beforeEnv.toString().replaceAll('\r\n', '\n'), 'Unexpected concurrent next-env edit; refusing to overwrite');
  const afterConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  afterConfig.include = afterConfig.include.filter((entry) => !entry.startsWith(dist+'/'));
  assert.deepEqual(afterConfig, JSON.parse(beforeConfig.toString()), 'Unexpected concurrent tsconfig edit; refusing to overwrite');
  fs.writeFileSync(envFile, beforeEnv); fs.writeFileSync(configFile, beforeConfig);
};

(async () => {
  try {
    // Optional test-only dependency; no trust-store edits or persistent CA.
    execFileSync(process.env.DRAPIXAI_FIXTURE_PYTHON || 'python', ['-c', `
import sys, datetime, ipaddress
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
out = Path(sys.argv[1])
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Synthetic loopback session test')])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
    .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1))
    .not_valid_after(now+datetime.timedelta(days=1))
    .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1')),
        x509.DNSName('session-audit.example.test')]), critical=False).sign(key, hashes.SHA256()))
(out/'fixture-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
(out/'fixture-cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
`, output], { windowsHide: true, stdio: 'pipe' });
    api = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (url.pathname === '/auth/login') {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        const admin = input.email === 'operator@example.test';
        if ((admin && (input.password !== '  fixture-operator-password  ' || input.mfaCode !== '123456')) || (!admin && input.password !== 'fixture-merchant-password')) return json({ error: 'INVALID' }, 401);
        return json({ apiKey: fixtureKey(admin ? 'admin' : 'merchant') });
      }
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const role = keys.get(key);
      if (!role) return json({ error: 'INVALID_API_KEY' }, 401);
      if (url.pathname === '/auth/logout') { keys.delete(key); return json({ ok: true }); }
      if (url.pathname.startsWith('/admin/')) {
        if (role !== 'admin') return json({ error: 'ADMIN_REQUIRED' }, 403);
        if (adminStatus !== 200) return json({ error: 'ADMIN_SESSION_REQUIRED' }, adminStatus);
        if (url.pathname === '/admin/overview') return json({ totals: { users: 0, activeApiKeys: 0, rendersThisMonth: 0, pendingGarments: 0, emailsSent: 0, emailsFailed: 0 }, plans: [], recentUsers: [], dailyUsage: [], signups: [] });
        if (url.pathname === '/admin/website') return json({ pageViewsLast30Days: 0, demoStartsLast30Days: 0, demoSuccessLast30Days: 0, ctaClicksLast30Days: 0, topPages: [], eventsByDay: [] });
        if (url.pathname === '/admin/ops') return json({ health: { database: true, redis: true, aiReachable: false, aiReady: false, aiStatus: 'synthetic-no-gpu', queueDepth: 0 }, renderStats: { total: 0, pending: 0, complete: 0, failed: 0 }, recentFailures: [], dailyTraffic: [] });
        if (url.pathname.includes('tryon-results') || url.pathname.includes('garments')) return json({ items: [] });
        return json({ ok: true });
      }
      if (url.pathname === '/analytics/summary') return json({ ok: true });
      return json({ error: 'UNKNOWN_FIXTURE_PATH' }, 404);
    });
    const apiPort = await listen(api);
    const reservation = http.createServer(); const nextPort = await listen(reservation); await close(reservation);
    edge = https.createServer({ key: fs.readFileSync(path.join(output, 'fixture-key.pem')), cert: fs.readFileSync(path.join(output, 'fixture-cert.pem')) }, (req, res) => {
      if (req.url === '/__invalid-prefix') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': [
          '__Host-bad_domain=1; Secure; HttpOnly; Path=/; Domain=example.test',
          'plain-domain-control=1; Secure; HttpOnly; Path=/; Domain=example.test',
          '__Host-bad_path=1; Secure; HttpOnly; Path=/admin',
          '__Host-bad_secure=1; HttpOnly; Path=/',
        ] }); res.end('<title>Synthetic invalid cookie controls</title>'); return;
      }
      const upstream = http.request({ hostname: '127.0.0.1', port: nextPort, path: req.url, method: req.method,
        headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, (incoming) => {
        res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end('Fixture web server unavailable'); }); req.pipe(upstream);
    });
    const edgePort = await listen(edge), base = `https://127.0.0.1:${edgePort}`;
    const secret = 'synthetic-browser-session-key-material-32-plus';
    const env = { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: '1', DRAPIXAI_API_URL: `http://127.0.0.1:${apiPort}`,
      NEXT_PUBLIC_API_BASE_URL: base, NEXT_PUBLIC_WEB_BASE_URL: base, NEXTAUTH_URL: base,
      NEXTAUTH_SECRET: secret, ADMIN_SESSION_SECRET: secret, DASHBOARD_SESSION_SECRET: secret, JWT_SECRET: secret,
      DRAPIXAI_DASHBOARD_PROXY_TOKEN: 'synthetic-browser-proxy-key', GOOGLE_CLIENT_ID: 'synthetic-browser-client', GOOGLE_CLIENT_SECRET: 'synthetic-browser-secret' };
    build = runChild([path.join(root, 'apps/web/node_modules/next/dist/bin/next'), 'build', '--webpack'], env, 'build.log');
    assert.equal(await childDone(build), 0, 'Production fixture build failed; inspect build.log');
    restoreGeneratedConfig();
    next = runChild([path.join(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(nextPort)], env, 'server.log');
    exit = childDone(next);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${nextPort}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert.ok(ready, 'Fixture production server did not start');
    // An IP-literal Domain attribute is normalized by Chrome; use a synthetic
    // DNS host and a parent-domain positive control to test prefix enforcement.
    const prefixOrigin = `https://session-audit.example.test:${edgePort}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: ['--host-resolver-rules=MAP session-audit.example.test 127.0.0.1', '--no-proxy-server'] }); report.browser = browser.version();
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) => [base, prefixOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', (error) => report.pageErrors.push(error.message));
    const check = (label) => report.checks.push(label);
    const cookie = async (name) => (await context.cookies()).find((value) => value.name === name);
    const verifyCookie = async (name) => { const value = await cookie(name); assert.ok(value); assert.equal(value.secure, true); assert.equal(value.httpOnly, true); assert.equal(value.path, '/'); assert.equal(value.sameSite, 'Strict'); assert.equal(value.domain, '127.0.0.1'); };
    await page.goto(prefixOrigin+'/__invalid-prefix');
    const invalidCookies = (await context.cookies()).filter((value) => value.name.startsWith('__Host-bad_'));
    assert.equal(invalidCookies.length, 0, `Chrome accepted invalid prefix controls: ${invalidCookies.map((value) => value.name).join(', ')}`);
    assert.ok(await cookie('plain-domain-control'), 'Parent-domain positive control must be accepted');
    check('Chrome rejects __Host cookies with Domain, a non-root Path or missing Secure');
    await context.addCookies([{ name: 'drapixai_admin_session', value: 'synthetic-legacy-cookie', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    assert.equal((await context.request.get(base+'/api/admin/proxy/overview')).status(), 401);
    check('Legacy-only admin cookie cannot authenticate production proxy');
    const login = async () => {
      await page.goto(base+'/admin-access');
      const reject = page.getByRole('button', { name: 'Reject optional', exact: true }); if (await reject.count()) await reject.click();
      await page.getByLabel('Administrator email').fill('operator@example.test');
      await page.getByLabel('Authenticator code').fill('123456');
      await page.getByLabel('Password', { exact: true }).fill('  fixture-operator-password  ');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Quality and launch control.', exact: true }).waitFor();
    };
    await login(); await verifyCookie('__Host-drapixai_admin_session');
    assert.equal(await cookie('drapixai_admin_session'), undefined);
    assert.equal((await page.evaluate(() => document.cookie)).includes('__Host-drapixai_admin_session'), false);
    check('Actual login form preserves password whitespace, creates protected HttpOnly cookie and retires legacy host cookie');
    const successfulRefresh = page.waitForResponse((response) => response.url().includes('/api/admin/proxy/tryon-results') && response.status() === 200);
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await (await successfulRefresh).finished();
    assert.equal(new URL(page.url()).pathname, '/admin'); check('Valid operator refresh remains usable');
    adminStatus = 401;
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await page.waitForURL(base+'/admin-access'); assert.equal(await cookie('__Host-drapixai_admin_session'), undefined);
    check('Backend 401 on later admin action clears cookie and redirects actual page to login');
    adminStatus = 200; await login(); adminStatus = 403;
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
    await page.waitForURL(base+'/admin-access'); assert.equal(await cookie('__Host-drapixai_admin_session'), undefined);
    check('Backend operator-role denial 403 follows the same cleared-session journey');
    adminStatus = 200; await login(); await page.getByRole('button', { name: 'Admin Logout', exact: true }).click();
    await page.waitForURL(base+'/'); assert.equal(await cookie('__Host-drapixai_admin_session'), undefined);
    check('Operator logout removes protected session');
    await context.addCookies([{ name: 'drapixai_dashboard_session', value: 'synthetic-legacy-cookie', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    assert.equal((await context.request.get(base+'/api/dashboard/proxy/analytics/summary')).status(), 401);
    assert.equal((await context.request.post(base+'/api/dashboard/session', { headers: { Origin: base }, data: { mode: 'login', email: 'merchant@example.test', password: 'fixture-merchant-password' } })).status(), 200);
    await verifyCookie('__Host-drapixai_dashboard_session'); assert.equal(await cookie('drapixai_dashboard_session'), undefined);
    assert.equal((await context.request.get(base+'/api/dashboard/proxy/analytics/summary')).status(), 200);
    await context.request.delete(base+'/api/dashboard/session', { headers: { Origin: base } });
    assert.equal(await cookie('__Host-drapixai_dashboard_session'), undefined);
    check('Merchant login/proxy/logout use the protected cookie and reject legacy-only authentication');
    const { encode } = createRequire(path.join(root, 'apps/web/package.json'))('next-auth/jwt');
    await context.addCookies([{ name: '__Secure-next-auth.session-token', value: await encode({ secret, token: { apiKey: fixtureKey('merchant'), sub: 'synthetic-merchant' } }), domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    assert.equal((await context.request.post(base+'/api/dashboard/oauth-session', { headers: { Origin: base } })).status(), 200);
    await verifyCookie('__Host-drapixai_dashboard_session');
    assert.equal((await context.request.get(base+'/api/dashboard/proxy/analytics/summary')).status(), 200);
    check('OAuth session bridge with a synthetic valid NextAuth identity uses the same protected cookie');
    assert.equal(report.pageErrors.length, 0, report.pageErrors.join('; ')); report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    throw error;
  } finally {
    await browser?.close();
    if (next) { next.kill(); await exit; }
    if (build && build.exitCode === null) build.kill();
    await close(edge); await close(api);
    try { restoreGeneratedConfig(); } catch (error) { report.configRestoreFailure = error.message; report.passed = false; }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)+'\n');
  }
  assert.equal(report.passed, true); console.log(`PASS production HTTPS browser session journey: ${report.checks.length} checks; ${report.pageErrors.length} page errors`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
