// Isolated merchant-host UI fixture. Synthetic photo/token, no inference,
// real credentials, customer data, external traffic or account mutations.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.DRAPIXAI_BROWSER_MODULES, 'playwright'));
const base = new URL(process.env.DRAPIXAI_AUDIT_URL || 'http://127.0.0.1:3108');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw Error('LOCAL_AUDIT_TARGET_REQUIRED');
const output = path.resolve(__dirname, '../runtime/launch-evidence/website-compliance-2026-10-18');
const report = { scope: 'synthetic merchant-host SDK UI only; not inference, live authorization, legal approval or assistive-technology certification', behaviors: [], accessibility: [], passed: false };
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, reducedMotion: 'reduce' });
  let submitted = 0;
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) return route.abort();
      if (url.pathname.endsWith('/sdk/validate')) return route.fulfill({ contentType: 'application/json', body: '{"valid":true}' });
      if (url.pathname.endsWith('/sdk/tryon')) { submitted++; return route.abort(); }
      if (url.pathname === '/sdk-a11y-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic merchant fixture</title><body style="background:#101712;color:white;font-family:Arial"><h1>Merchant product fixture</h1><button style="background:#183f32;color:white" id="merchant-button">Merchant action</button><div id="drapixai-container"></div></body></html>' });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${base.origin}/sdk-a11y-fixture`);
    await page.addScriptTag({ path: path.resolve(__dirname, '../apps/web/public/sdk.js') });
    await page.evaluate(async origin => {
      let calls = 0;
      await window.DrapixAI.init({ productId: 'synthetic-product', baseUrl: origin, tokenProvider: async () => {
        if (calls++ === 0) return 'synthetic-short-lived-token';
        return new Promise(resolve => { window.resolveFixtureToken = resolve; }).then(token => {
          window.fixtureTokenReturned = true; return token;
        });
      } });
    }, base.origin);
    const launcher = page.getByRole('button', { name: 'Try On', exact: true });
    await launcher.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'DrapixAI Virtual Try-On', exact: true });
    await dialog.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close DrapixAI try-on' }).evaluate(el => el === document.activeElement), true);
    for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 18; i++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
    }
    const input = page.getByLabel('Choose your photo', { exact: true });
    await input.focus();
    assert.equal(await input.evaluate(el => el === document.activeElement && getComputedStyle(el).display !== 'none'), true);
    await input.setInputFiles({ name: 'synthetic-person.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=', 'base64') });
    const consent = page.locator('#drapix-consent');
    assert.equal(await consent.isChecked(), false);
    await page.getByRole('button', { name: 'Generate try-on', exact: true }).click();
    assert.match(await page.getByRole('status').innerText(), /consent/i);
    assert.equal(submitted, 0);
    report.behaviors.push('PASS native named modal, keyboard entry, focus containment both directions, visible named file input and unchecked consent blocks submission');
    await page.addScriptTag({ path: process.env.DRAPIXAI_AXE_PATH });
    for (const width of [1200, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const result = await page.evaluate(() => window.axe.run(document.querySelector('#drapix-modal'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      report.accessibility.push({ width, violations: result.violations, incomplete: result.incomplete.map(x => ({ id: x.id, nodes: x.nodes.map(n => n.target) })) });
      const card = await page.locator('#drapix-card').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
      assert.ok(card.scrollWidth <= card.width + 1, `SDK card overflows at ${width}px`);
      const close = await page.locator('#drapix-close').evaluate(el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return { color: style.color, background: style.backgroundColor,
          unobscured: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('#drapix-close') === el };
      });
      const luminance = color => {
        const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
        assert.ok(channels, 'Manual contrast sample requires opaque computed RGB colors');
        return channels.slice(1).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const colors = [luminance(close.color), luminance(close.background)].sort((a, b) => b - a);
      close.contrastRatio = (colors[0] + 0.05) / (colors[1] + 0.05);
      assert.ok(close.unobscured && close.contrastRatio >= 4.5, 'Close control must be unobscured and readable');
      report.accessibility.at(-1).closeControlManualSample = close;
    }
    await page.screenshot({ path: path.join(output, 'sdk-modal-320.png') });
    await page.getByRole('button', { name: 'Reset photo', exact: true }).click();
    assert.equal(await consent.isChecked(), false);
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await input.setInputFiles({ name: 'synthetic-person.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=', 'base64') });
    await consent.check();
    await page.getByRole('button', { name: 'Generate try-on', exact: true }).click();
    await page.waitForFunction(() => typeof window.resolveFixtureToken === 'function');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#drapix-modal').count(), 0);
    assert.equal(await launcher.evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => window.resolveFixtureToken('synthetic-short-lived-token'));
    await page.waitForFunction(() => window.fixtureTokenReturned === true);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(submitted, 0, 'Closing before a delayed credential returns must not submit a photo afterward');
    report.behaviors.push('PASS reset clears consent and returns file focus; Escape closes/returns launcher focus; delayed credentials cannot submit after close');
    assert.equal(report.accessibility.flatMap(x => x.violations).length, 0);
    report.passed = true;
    console.log(JSON.stringify({ passed: true, behaviors: report.behaviors, accessibility: report.accessibility.map(x => ({ width: x.width, violations: x.violations.length, incomplete: x.incomplete })) }, null, 2));
  } finally {
    fs.writeFileSync(path.join(output, 'sdk-accessibility-report.json'), JSON.stringify(report, null, 2) + '\n');
    await context.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
