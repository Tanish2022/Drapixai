import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const web = path.join(root, 'apps/web');
const evidence = path.join(root, 'runtime/launch-evidence', `discovery-${crypto.randomBytes(8).toString('hex')}`);
fs.mkdirSync(evidence, { recursive: true });
const require = createRequire(import.meta.url);
const { publicIndexingEnabled } = require('../apps/web/app/lib/discovery-policy.cjs');
const report = { passed: false, scope: 'Isolated local production Next builds/HTTP; no deployed indexing, search-provider submission or performance certification', checks: [], measurements: [], errors: [] };
const before = new Map(['tsconfig.json', 'next-env.d.ts'].map(file => [file, fs.readFileSync(path.join(web, file))]));
const env = {};
for (const name of ['SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'WINDIR', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles', 'CommonProgramFiles']) {
  if (process.env[name]) env[name] = process.env[name];
}
env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
// Prevent Next's dotenv loading from importing any real app credentials. Only
// variable NAMES are used; values are neither logged nor copied into test env.
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const filePath = path.join(web, file);
  if (fs.existsSync(filePath)) for (const [, key] of fs.readFileSync(filePath, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[key] = '';
}
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_WEB_BASE_URL: 'https://drapixai.com',
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:9', DRAPIXAI_API_URL: 'http://127.0.0.1:9',
  NEXTAUTH_URL: 'http://127.0.0.1:3119', NEXTAUTH_SECRET: 'synthetic-discovery-fixture-secret-not-a-live-key',
  ADMIN_SESSION_SECRET: 'synthetic-discovery-fixture-admin-not-a-live-key',
  DASHBOARD_SESSION_SECRET: 'synthetic-discovery-fixture-dashboard-not-a-live-key',
  DRAPIXAI_AUTH_SYNC_TOKEN: 'synthetic-discovery-fixture-sync',
  DRAPIXAI_DASHBOARD_PROXY_TOKEN: 'synthetic-discovery-fixture-proxy',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: '0',
  NEXT_PUBLIC_DEMO_VIDEO_URL: '', NEXT_PUBLIC_SHOPIFY_APP_INSTALL_URL: '',
});

function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function run(args, taskEnv, logName) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(path.join(evidence, logName));
    const child = spawn(process.execPath, args, { cwd: web, env: taskEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log); child.stderr.pipe(log);
    child.once('error', reject);
    child.once('close', code => { log.end(); code === 0 ? resolve() : reject(new Error(`${logName} exited ${code}`)); });
  });
}
async function start(taskEnv, logName) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const log = fs.createWriteStream(path.join(evidence, logName));
  const child = spawn(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: web, env: taskEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let failed, exited = false;
  child.once('error', error => { failed = error; });
  const stopped = new Promise(resolve => child.once('close', () => { exited = true; log.end(); resolve(); }));
  const stop = async () => { if (!exited) child.kill(); await stopped; };
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      if (failed) throw failed;
      assert.ok(!exited, `${logName}: server exited`);
      try { const response = await fetch(origin, { signal: AbortSignal.timeout(2000) }); await response.body?.cancel(); if (response.ok) break; } catch { /* boot */ }
      assert.ok(Date.now() < deadline, 'Server readiness timed out');
      await delay(200);
    }
    return { origin, stop };
  } catch (error) { await stop(); throw error; }
}
async function get(origin, route, options = {}) {
  const response = await fetch(`${origin}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options });
  return { response, body: await response.text() };
}
function meta(html, name, attr = 'name') {
  return new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1];
}
const routes = ['/', '/virtual-try-on', '/pricing', '/docs', '/help', '/contact', '/privacy', '/terms', '/cookies', '/refund-policy'];
try {
  const valid = { NODE_ENV: 'production', DRAPIXAI_PUBLIC_INDEXING: '1', NEXT_PUBLIC_WEB_BASE_URL: 'https://drapixai.com' };
  assert.equal(publicIndexingEnabled(valid), true);
  for (const candidate of [
    {}, { ...valid, DRAPIXAI_PUBLIC_INDEXING: undefined }, { ...valid, DRAPIXAI_PUBLIC_INDEXING: 'true' },
    { ...valid, NODE_ENV: 'development' }, ...['https://staging.drapixai.com', 'https://sandbox.drapixai.com', 'http://drapixai.com', 'https://drapixai.com.evil.invalid', 'https://drapixai.com/?x=1', 'http://localhost:3000', 'https://drapixai.com/'].map(NEXT_PUBLIC_WEB_BASE_URL => ({ ...valid, NEXT_PUBLIC_WEB_BASE_URL })),
  ]) assert.equal(publicIndexingEnabled(candidate), false);
  check('Indexing requires explicit production opt-in and exact canonical origin; unsafe/missing variants fail closed');

  for (const mode of ['private', 'public']) {
    const taskEnv = { ...env, NEXT_DIST_DIR: `.next-review/task16-${mode}-${path.basename(evidence)}`, DRAPIXAI_PUBLIC_INDEXING: mode === 'public' ? '1' : '0' };
    report[`${mode}Dist`] = taskEnv.NEXT_DIST_DIR;
    console.log(`Building ${mode} local fixture`);
    await run([path.join(web, 'node_modules/next/dist/bin/next'), 'build'], taskEnv, `${mode}-build.log`);
    check(`${mode}: production build`);
    const server = await start(taskEnv, `${mode}-server.log`);
    try {
      const titles = new Set(), descriptions = new Set();
      const nonces = new Set();
      for (const route of routes) {
        const { response, body } = await get(server.origin, `${route}?campaign=synthetic&token=do-not-canonicalize`, { headers: { 'x-drapixai-pathname': '/dashboard', 'x-nonce': 'caller-controlled' } });
        assert.equal(response.status, 200, `${mode}:${route}`);
        const expected = `https://drapixai.com${route === '/' ? '' : route}`;
        assert.ok(body.includes(`<link rel="canonical" href="${expected}"`), `${route}: clean canonical`);
        assert.equal(meta(body, 'og:url', 'property'), expected, `${route}: OG URL`);
        const title = /<title>(.*?)<\/title>/.exec(body)?.[1]; assert.ok(title && !titles.has(title), `${route}: unique title`); titles.add(title);
        const description = meta(body, 'description'); assert.ok(description && !descriptions.has(description), `${route}: unique description`); descriptions.add(description);
        assert.equal(meta(body, 'robots'), mode === 'private' ? 'noindex, nofollow' : 'index, follow');
        if (mode === 'private') assert.match(response.headers.get('x-robots-tag'), /noindex/);
        else assert.equal(response.headers.get('x-robots-tag'), null);
        const csp = response.headers.get('content-security-policy');
        assert.ok(!/'unsafe-(inline|eval)'/.test(csp));
        const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]; assert.ok(nonce && nonce !== 'caller-controlled' && !nonces.has(nonce)); nonces.add(nonce);
        for (const [, attributes] of body.matchAll(/<script\b([^>]*)>/g)) assert.ok(attributes.includes(`nonce="${nonce}"`), `${route}: script/JSON-LD nonce`);
        // A streamed Next response can include the hidden loading fallback as
        // well as the resolved page. Raw HTTP is not the hydrated DOM tree.
        assert.ok((body.match(/<h1\b/g) || []).length >= 1, `${route}: server-rendered heading`);
        for (const [, raw] of body.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
          const data = JSON.parse(raw);
          assert.equal(data['@context'], 'https://schema.org');
          assert.ok(!/AggregateRating|Review|Offer|FAQPage/.test(raw), 'No invented rating/offer/FAQ markup');
        }
        if (route === '/virtual-try-on') {
          assert.equal((body.match(/<h2\b/g) || []).length, 9);
          assert.match(body, /public Shopify App Store listing/);
          assert.match(body, /does not measure the body/);
          assert.match(body, /not a percentage accuracy guarantee/);
          // Local HTML byte count is a diagnostic, not a Core Web Vitals score.
          report.measurements.push({ mode, route, htmlBytes: Buffer.byteLength(body) });
        }
      }
      check(`${mode}: ten pages have distinct metadata, clean canonical/OG URLs, expected robots, server-rendered headings and nonce-safe scripts`);
      const home = await get(server.origin, '/');
      const graph = JSON.parse(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(home.body)[1]);
      assert.equal(graph['@graph'][0].legalName, 'DRAPIXAI SOFTWARE SOLUTIONS LLP');
      assert.equal(graph['@graph'][0].email, 'support@drapixai.com');
      assert.match(home.body, /href="\/virtual-try-on"/);
      check(`${mode}: organization schema matches visible identity and homepage links to merchant answers`);

      for (const route of ['/auth/login', '/admin-access', '/dashboard', '/shopify/connect?token=synthetic-handoff', '/demo', '/status', '/changelog', '/api/dashboard/session']) {
        const { response } = await get(server.origin, route);
        assert.match(response.headers.get('x-robots-tag') || '', /noindex/, `${route}: always noindex`);
      }
      check(`${mode}: auth/account/API/handoff and unreviewed dynamic routes remain noindex`);
      const missing = await get(server.origin, '/not-a-real-task16-page'); assert.equal(missing.response.status, 404); assert.match(missing.response.headers.get('x-robots-tag'), /noindex/);
      const robot = await get(server.origin, '/robots.txt'); assert.equal(robot.response.status, 200);
      assert.match(robot.body, /Allow: \//); assert.doesNotMatch(robot.body, /Disallow: \//);
      assert.equal(robot.body.includes('Sitemap: https://drapixai.com/sitemap.xml'), mode === 'public');
      const sitemap = await get(server.origin, '/sitemap.xml'); assert.equal(sitemap.response.status, 200);
      const urls = [...sitemap.body.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
      assert.deepEqual(urls.sort(), mode === 'public' ? routes.map(route => `https://drapixai.com${route === '/' ? '' : route}`).sort() : []);
      assert.doesNotMatch(sitemap.body, /lastmod|dashboard|auth\/|shopify\/|token=/);
      const asset = await get(server.origin, '/llms.txt'); assert.equal(asset.response.status, 200);
      assert.match(asset.body, /pre-launch preparation/); assert.doesNotMatch(asset.body, /SDK installation:|Live demo:/);
      if (mode === 'private') assert.match(asset.response.headers.get('x-robots-tag'), /noindex/);
      check(`${mode}: robots permits noindex retrieval; sitemap contains only eligible pages and optional llms reference is accurate`);
    } finally { await server.stop(); }
    // A public artifact cannot defeat the staging runtime override.
    if (mode === 'public') {
      const staging = await start({ ...taskEnv, DRAPIXAI_PUBLIC_INDEXING: '0' }, 'public-artifact-private-runtime.log');
      try {
        const page = await get(staging.origin, '/virtual-try-on'); assert.match(page.response.headers.get('x-robots-tag'), /noindex/); assert.equal(meta(page.body, 'robots'), 'noindex, nofollow');
        assert.doesNotMatch((await get(staging.origin, '/sitemap.xml')).body, /<loc>/);
        assert.doesNotMatch((await get(staging.origin, '/robots.txt')).body, /Sitemap:/);
        check('Public build with private runtime override remains noindex with empty sitemap');
      } finally { await staging.stop(); }
    }
  }
  report.passed = true;
} catch (error) {
  report.errors.push(error.message); process.exitCode = 1; console.error(error.message);
} finally {
  // Next adds its generated dist paths. Restore exactly the user's pre-test files.
  for (const [file, bytes] of before) fs.writeFileSync(path.join(web, file), bytes);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Evidence: ${path.relative(root, evidence)}/report.json`);
}
