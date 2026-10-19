import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Called only by the guarded fixture, while its real API/DB/Redis remain alive.
assert.equal(process.env.DRAPIXAI_TERMS_BROWSER_FIXTURE, 'I_ACKNOWLEDGE_DISPOSABLE_TERMS_BROWSER');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DRAPIXAI_PLAYWRIGHT_MODULE || 'playwright');
const api = new URL(process.env.DRAPIXAI_TERMS_BROWSER_API_URL);
assert.equal(api.hostname, '127.0.0.1'); assert.equal(api.protocol, 'http:');
assert.match(process.env.DRAPIXAI_TERMS_BROWSER_EMAIL || '', /^http_[a-f0-9]+-browser@example\.invalid$/);
const dist = process.env.NEXT_DIST_DIR || '.next-review/terms-enforcement-20261019';
assert.ok(!path.isAbsolute(dist) && !dist.split(/[\\/]/).includes('..') && dist.startsWith('.next-review/'));
const webRoot = path.join(root, 'apps/web');
assert.ok(fs.existsSync(path.join(webRoot, dist, 'BUILD_ID')), 'Build the current review web application first');
// NEXT_PUBLIC_WEB_BASE_URL is compiled into the CSRF guard. Use the same
// explicitly chosen loopback origin at build and runtime, not a random origin.
const configuredOrigin = new URL(process.env.DRAPIXAI_TERMS_BROWSER_ORIGIN || 'http://127.0.0.1:3117');
assert.equal(configuredOrigin.hostname, '127.0.0.1'); assert.equal(configuredOrigin.protocol, 'http:');
assert.ok(Number(configuredOrigin.port) > 1024 && !configuredOrigin.username && !configuredOrigin.password);
const listener = net.createServer();
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(Number(configuredOrigin.port), '127.0.0.1', resolve); });
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const output = path.join(root, 'runtime/launch-evidence', `account-terms-integrated-browser-${crypto.randomBytes(8).toString('hex')}`);
fs.mkdirSync(output, { recursive: true });
const report = { passed: false, scope: 'Owned production Next browser -> BFF -> current production-mode Express routers -> disposable PostgreSQL and Redis; not full application server, live Google, staging or legal review', checks: [], errors: [] };
report.buildId = fs.readFileSync(path.join(webRoot, dist, 'BUILD_ID'), 'utf8').trim();
report.source = {};
for (const name of ['apps/web/proxy.ts', 'apps/web/next.config.js', 'apps/web/app/auth/terms/page.tsx', 'apps/web/app/auth/register/page.tsx', 'apps/web/app/auth/login/page.tsx',
  'apps/web/app/api/dashboard/terms/route.ts', 'apps/web/app/api/dashboard/session/route.ts', 'apps/web/app/api/dashboard/oauth-session/route.ts',
  'apps/web/app/lib/account-terms-server.ts', 'apps/web/app/lib/request-guard.ts', 'apps/web/app/components/PrivacyPreferences.tsx', 'scripts/verify-account-terms-browser.mjs']) {
  report.source[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
}
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: webRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: '1',
    DRAPIXAI_API_URL: api.origin, NEXT_PUBLIC_WEB_BASE_URL: origin, NEXTAUTH_URL: origin,
    DASHBOARD_SESSION_SECRET: crypto.randomBytes(48).toString('hex'), ADMIN_SESSION_SECRET: crypto.randomBytes(48).toString('hex'), NEXTAUTH_SECRET: crypto.randomBytes(48).toString('hex'),
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
});
let logs = ''; web.stdout.on('data', data => { logs = (logs + data).slice(-16384); }); web.stderr.on('data', data => { logs = (logs + data).slice(-16384); });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(web.exitCode, null, 'Owned Next process exited before readiness');
    const response = await fetch(`${origin}/auth/login`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (response?.ok) { ready = true; break; }
    await delay(250);
  }
  assert.ok(ready, 'Owned production Next process did not become ready');
  browser = await chromium.launch({ headless: true, ...(process.env.DRAPIXAI_BROWSER_EXECUTABLE ? { executablePath: process.env.DRAPIXAI_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${origin}/auth/login?next=/terms`);
  await page.locator('input[type="email"]').fill(process.env.DRAPIXAI_TERMS_BROWSER_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.DRAPIXAI_TERMS_BROWSER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/auth/terms?**');
  const choice = page.getByRole('checkbox', { name: /I accept the Terms of Service/ });
  await choice.waitFor(); await choice.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]').disabled);
  assert.equal(await choice.isChecked(), false);
  assert.equal(await page.getByRole('button', { name: 'Accept terms and continue' }).isEnabled(), false);
  report.checks.push('Password login reaches explicit unchecked acceptance; submit starts disabled');
  await page.goto(`${origin}/dashboard?tab=usage`);
  await page.waitForURL('**/auth/terms?**');
  assert.equal(new URL(page.url()).searchParams.get('next'), '/dashboard?tab=usage');
  report.checks.push('Protected page redirects a genuine encrypted pending session to acceptance');
  await page.goto(`${origin}/auth/terms?next=/terms`);
  await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]').disabled);
  if (process.env.DRAPIXAI_AXE_SCRIPT) {
    await page.addScriptTag({ path: process.env.DRAPIXAI_AXE_SCRIPT });
    const findings = await page.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }); return { violations: r.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), incomplete: r.incomplete.map(v => v.id) }; });
    report.accessibility = findings; assert.deepEqual(findings.violations, []);
  }
  await page.screenshot({ path: path.join(output, 'acceptance-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 860 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const trigger = await page.getByRole('button', { name: 'Cookie preferences', exact: true }).boundingBox();
  const checkboxBounds = await choice.boundingBox();
  assert.ok(trigger && checkboxBounds && (trigger.y + trigger.height <= checkboxBounds.y || checkboxBounds.y + checkboxBounds.height <= trigger.y));
  await page.screenshot({ path: path.join(output, 'acceptance-mobile.png'), fullPage: true });
  // A simulated transport failure must leave assent unrecorded and permit retry.
  await page.route('**/api/dashboard/terms', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'TERMS_ACCEPTANCE_UNAVAILABLE' }) }) : route.continue());
  await choice.focus(); await page.keyboard.press('Space');
  assert.equal(await choice.isChecked(), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Accept terms and continue');
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Your acceptance was not saved.' }).waitFor();
  const pendingAfterFailure = await page.evaluate(async () => (await fetch('/api/dashboard/terms')).json());
  assert.equal(pendingAfterFailure.accepted, false);
  report.checks.push('Simulated 503 leaves real PostgreSQL assent absent and offers retry without leaving the form');
  await page.unroute('**/api/dashboard/terms');
  await page.getByRole('button', { name: 'Accept terms and continue' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(`${origin}/terms`);
  report.checks.push('320px layout fits; keyboard checkbox and submit save acceptance then continue');
  const response = await page.evaluate(async () => {
    const r = await fetch('/api/dashboard/terms'); return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() };
  });
  assert.equal(response.status, 200); assert.equal(response.body.accepted, true); assert.match(response.cache, /no-store/);
  const metadata = require('../apps/api/src/legal/terms-metadata.json');
  assert.equal(response.body.documentHash, metadata.documentHash); assert.equal(response.body.version, metadata.version);
  const profile = await page.evaluate(async () => { const r = await fetch('/api/dashboard/proxy/account/profile'); return { status: r.status, body: await r.json() }; });
  assert.equal(profile.status, 200); assert.equal(profile.body.email, process.env.DRAPIXAI_TERMS_BROWSER_EMAIL);
  report.checks.push('Actual HTTP-only cookie accesses only its accepted account through BFF; exact revision is returned without credentials');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.message; throw error; }
finally {
  if (browser) await browser.close();
  if (web.exitCode === null) { web.kill(); await Promise.race([new Promise(resolve => web.once('exit', resolve)), delay(5000)]); }
  report.webStopped = web.exitCode !== null || web.signalCode !== null;
  if (!report.webStopped) { report.passed = false; report.failure = 'Owned Next process did not stop'; }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, output }));
}
