const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(require.resolve('playwright', {
  paths: [process.env.DRAPIXAI_BROWSER_MODULES || __dirname],
}));

const budget = 500;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=', 'base64');

async function main() {
  let mode = 'ok';
  let uploads = 0;
  let redirects = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/') return res.end('<!doctype html><title>SDK test</title><main id="drapixai-container"></main>');
    if (req.url === '/redirect-target') { redirects++; return res.end(); }
    if (req.url === '/sdk/validate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (mode === 'validate-stall') return void res.write('{');
      return res.end('{"valid":true}');
    }
    if (req.url !== '/sdk/tryon') { res.writeHead(404); return res.end(); }
    uploads++;
    if (mode === 'network-failure') return req.socket.destroy();
    if (mode === 'redirect') { res.writeHead(307, { Location: '/redirect-target' }); return res.end(); }
    if (mode === 'error-stall' || mode === 'oversized-error' || mode === 'malformed-error') {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      if (mode === 'error-stall') return void res.write('{');
      if (mode === 'oversized-error') { res.write(' '.repeat(65537)); return res.end('{}'); }
      return res.end('{');
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'x-drapixai-quality-score': '0.95' });
    if (mode === 'image-stall') return void res.write(png.subarray(0, 8));
    res.end(png);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base);
    await page.addScriptTag({ path: path.join(__dirname, '../apps/web/public/sdk.js') });
    const init = () => page.evaluate(async ({ baseUrl, timeoutMs }) => {
      try {
        await window.DrapixAI.init({ baseUrl, timeoutMs, productId: 'synthetic-product', tokenProvider: () => {
          if (!window.deferToken) return 'synthetic-short-lived-token';
          return new Promise((resolve) => { window.finishToken = resolve; });
        } });
        return 'ok';
      } catch (error) {
        return error.message;
      }
    }, { baseUrl: base, timeoutMs: budget });

    mode = 'validate-stall';
    assert.equal(await init(), 'VALIDATION_TIMEOUT');
    mode = 'ok';
    await page.evaluate(() => { window.deferToken = true; });
    assert.equal(await init(), 'VALIDATION_TIMEOUT');
    await page.evaluate(() => { window.deferToken = false; window.finishToken('late-synthetic-token'); });
    assert.equal(await init(), 'ok');

    const status = () => page.getByRole('status');
    const launcher = page.getByRole('button', { name: 'Try On', exact: true });
    const generate = page.getByRole('button', { name: 'Generate try-on' });
    const open = async () => {
      await launcher.click();
      await page.getByLabel('Choose your photo').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
      await page.locator('#drapix-consent').check();
    };
    const waitStatus = async (expected) => {
      await status().filter({ hasText: expected }).waitFor({ timeout: 3000 });
      assert.equal(await generate.isEnabled(), true);
    };
    await open();
    for (const stalled of ['image-stall', 'error-stall']) {
      mode = stalled;
      await generate.click();
      await waitStatus('TRY_ON_TIMEOUT');
    }
    for (const [responseMode, message] of [
      ['oversized-error', 'SDK_RESPONSE_TOO_LARGE'], ['malformed-error', 'TRY_ON_FAILED'],
    ]) {
      mode = responseMode;
      await generate.click();
      await waitStatus(message);
    }
    mode = 'network-failure';
    await generate.click();
    await waitStatus('Failed to fetch');
    await delay(budget + 100);
    assert.deepEqual(pageErrors, []);

    mode = 'redirect';
    await generate.click();
    await waitStatus('Failed to fetch');
    assert.equal(redirects, 0);
    mode = 'ok';
    await generate.click();
    await waitStatus('Your DrapixAI try-on is ready.');
    assert.equal(await page.evaluate(() => window.DrapixAI.lastResultMetadata.qualityScore), 0.95);

    const close = page.getByRole('button', { name: 'Close DrapixAI try-on' });
    await close.click();
    await open();
    const before = uploads;
    await page.evaluate(() => { window.deferToken = true; window.finishToken = null; });
    await generate.click();
    await page.waitForFunction(() => !!window.finishToken);
    await waitStatus('TRY_ON_TIMEOUT');
    await page.evaluate(() => window.finishToken('late-synthetic-token'));
    assert.equal(uploads, before);

    await page.evaluate(() => { window.finishToken = null; });
    await generate.click();
    await page.waitForFunction(() => !!window.finishToken);
    await page.locator('#drapix-consent').uncheck();
    await page.evaluate(() => window.finishToken('late-synthetic-token'));
    await waitStatus('Consent withdrawn.');
    assert.equal(uploads, before);

    await page.locator('#drapix-consent').check();
    await page.evaluate(() => { window.finishToken = null; });
    await generate.click();
    await page.waitForFunction(() => !!window.finishToken);
    await close.click();
    await page.evaluate(() => window.finishToken('late-synthetic-token'));
    await delay(budget + 100);
    assert.equal(uploads, before);
    assert.deepEqual(pageErrors, []);
    console.log('PASS browser startup, body deadlines, byte limits, failure/retry, redirects and consent/close races');
  } finally {
    try { await browser?.close(); } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
