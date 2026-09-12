import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Use a separately running loopback container when verifying a release image.
// Otherwise run the production build produced by the preceding web-build gate.
let origin = process.env.DRAPIXAI_CSP_TEST_ORIGIN;
let server;
let serverFailure;
let serverExited = false;
let stopped;

try {
  if (origin) {
    const url = new URL(origin);
    assert.equal(url.protocol, 'http:');
    assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'CSP test must use loopback');
    assert.equal(url.username + url.password + url.search + url.hash, '');
    assert.equal(url.pathname, '/');
    origin = url.origin;
  } else {
    const reservation = net.createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [
      path.resolve('apps/web/node_modules/next/dist/bin/next'),
      'start', '--hostname', '127.0.0.1', '--port', String(port),
    ], {
      cwd: path.resolve('apps/web'),
      env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      stdio: 'ignore', windowsHide: true,
    });
    stopped = new Promise((resolve) => server.once('close', resolve));
    server.once('error', (error) => { serverFailure = error; });
    server.once('exit', () => { serverExited = true; });
  }

  const deadline = Date.now() + 30000;
  while (true) {
    if (serverFailure) throw serverFailure;
    assert.ok(!serverExited, 'Production web server exited before verification');
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.ok) break;
    } catch { /* The dedicated server may still be starting. */ }
    assert.ok(Date.now() < deadline, 'Production web server did not become ready');
    await delay(200);
  }

  const nonces = new Set();
  for (const route of ['/', '/privacy', '/pricing', '/auth/login', '/admin-access']) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${origin}${route}`, {
        redirect: 'manual', signal: AbortSignal.timeout(10000),
        // The proxy must replace caller-supplied values, not trust them.
        headers: { 'x-nonce': 'caller-controlled', 'content-security-policy': "script-src 'unsafe-inline'" },
      });
      assert.equal(response.status, 200, `${route}: HTTP status`);
      const csp = response.headers.get('content-security-policy') || '';
      assert.ok(!/'unsafe-(?:inline|eval)'/.test(csp), `${route}: unsafe CSP source`);
      assert.match(csp, /frame-ancestors 'none'/);
      const nonce = /(?:^|;)\s*script-src\s+[^;]*'nonce-([^']+)'/.exec(csp)?.[1];
      assert.ok(nonce && nonce !== 'caller-controlled', `${route}: generated nonce missing`);
      assert.ok(!nonces.has(nonce), `${route}: nonce reused across responses`);
      nonces.add(nonce);
      const styleNonce = /(?:^|;)\s*style-src\s+[^;]*'nonce-([^']+)'/.exec(csp)?.[1];
      assert.equal(styleNonce, nonce, `${route}: script/style nonce mismatch`);
      assert.match(response.headers.get('cache-control') || '', /no-store/, `${route}: nonce-bearing HTML can be cached`);
      const html = await response.text();
      const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
      assert.ok(scripts.length > 0, `${route}: no bootstrap scripts to verify`);
      for (const [, attributes] of scripts) {
        const scriptNonce = /(?:^|\s)nonce\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
        assert.equal(scriptNonce, nonce, `${route}: bootstrap script lacks the response nonce`);
      }
      for (const [, attributes] of html.matchAll(/<style\b([^>]*)>/gi)) {
        assert.equal(/(?:^|\s)nonce\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2], nonce, `${route}: inline stylesheet lacks the response nonce`);
      }
    }
    console.log(`PASS ${route}: rendered script/style nonces match CSP, resist caller override, rotate and disable HTML caching`);
  }
} finally {
  if (server && !serverExited) server.kill();
  if (stopped) await stopped;
}
