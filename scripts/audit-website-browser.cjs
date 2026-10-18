// Fresh, anonymous, local-only browser verification. No real API mutations.
// Set DRAPIXAI_BROWSER_MODULES to the directory containing playwright and
// DRAPIXAI_AXE_PATH to an installed axe-core/axe.min.js. No app dependency added.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.DRAPIXAI_BROWSER_MODULES, 'playwright'));
const base = new URL(process.env.DRAPIXAI_AUDIT_URL || 'http://127.0.0.1:3107');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw Error('LOCAL_AUDIT_TARGET_REQUIRED');
const output = path.resolve(__dirname, '../runtime/launch-evidence/website-compliance-2026-10-18');
const report = { target: base.origin, time: new Date().toISOString(), scope: 'anonymous local sample; API and external traffic intercepted', browser: '', behaviors: [], accessibility: [], network: [], pageErrors: [], reflow: [] };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let eventCount = 0;
  try {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/events') {
        eventCount++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); return;
      }
      if (url.origin === base.origin && url.pathname.startsWith('/api/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); return;
      }
      if (url.origin !== base.origin) {
        report.network.push({ origin: url.origin, action: 'intercepted; not transmitted' });
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Isolated media fixture</title>' }); return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const axe = fs.readFileSync(process.env.DRAPIXAI_AXE_PATH, 'utf8');
    const scanPage = async (route) => {
      await page.evaluate(axe);
      const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      report.accessibility.push({ route, passes: result.passes.length, incomplete: result.incomplete.map((item) => ({ id: item.id, count: item.nodes.length, nodes: item.nodes.map(node => node.target) })), violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })) });
    };
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.goto(base.href, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Your privacy choices' }).waitFor();
    assert.equal(eventCount, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('drapixaiVisitorId')), null);
    report.behaviors.push('PASS fresh visitor: no analytics request/ID');
    await scanPage('/ [initial privacy choices]');
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Website analytics' }).isChecked(), false);
    await scanPage('/ [customized privacy choices]');
    await page.getByRole('button', { name: 'Reject optional', exact: true }).click();
    assert.equal(eventCount, 0);
    report.behaviors.push('PASS customize defaults off; reject');
    await page.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === '/events'),
      page.getByRole('button', { name: 'Accept analytics', exact: true }).click(),
    ]);
    assert.ok(await page.evaluate(() => localStorage.getItem('drapixaiVisitorId')));
    report.behaviors.push('PASS opt-in enables one current-page event');
    const other = await context.newPage();
    await other.goto(`${base.origin}/privacy`, { waitUntil: 'networkidle' });
    await other.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
    await other.getByRole('button', { name: 'Reject optional', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('drapixaiVisitorId') === null);
    const before = eventCount;
    await page.goto(`${base.origin}/pricing`, { waitUntil: 'networkidle' });
    assert.equal(eventCount, before);
    report.behaviors.push('PASS cross-tab withdrawal removes ID and stops next-route event');
    await other.close();
    await page.getByRole('link', { name: 'Skip to main content', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    report.behaviors.push('PASS keyboard skip link and reduced-motion scroll');
    await page.getByRole('button', { name: 'Open support assistant', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'DrapixAI assistant', exact: true });
    await dialog.waitFor();
    for (let index = 0; index < 25; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    }
    await scanPage('/pricing [support dialog open]');
    for (let index = 0; index < 25; index++) {
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Open support assistant', exact: true }).evaluate((element) => element === document.activeElement), true);
    report.behaviors.push('PASS modal keyboard containment, Escape, trigger focus return');
    for (const route of ['/', '/demo', '/pricing', '/privacy', '/terms', '/cookies', '/refund-policy', '/contact', '/help', '/docs', '/auth/register', '/auth/login']) {
      await page.goto(`${base.origin}${route}`, { waitUntil: 'networkidle' });
      await scanPage(route);
    }
    await page.goto(`${base.origin}/auth/register`, { waitUntil: 'networkidle' });
    const terms = page.getByRole('checkbox', { name: 'I accept the Terms of Service.' });
    assert.equal(await terms.isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Send verification code', exact: true }).isDisabled(), true);
    const google = page.getByRole('button', { name: 'Continue with Google', exact: true });
    if (await google.count()) assert.equal(await google.isDisabled(), true);
    await terms.focus(); await page.keyboard.press('Space');
    assert.equal(await terms.isChecked(), true);
    assert.equal(await page.getByRole('button', { name: 'Send verification code', exact: true }).isDisabled(), false);
    if (await google.count()) assert.equal(await google.isDisabled(), false);
    assert.equal(await page.getByRole('link', { name: 'Privacy Policy', exact: true }).count(), 1);
    report.behaviors.push('PASS keyboard terms choice gates password and configured Google signup; privacy notice and analytics choice remain separate (not server assent certification)');
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of ['/', '/privacy', '/auth/register']) {
      await page.goto(`${base.origin}${route}`, { waitUntil: 'networkidle' });
      report.reflow.push({ route, ...(await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth }))) });
    }
    await page.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'preferences-320.png') });
    await page.goto(`${base.origin}/demo`, { waitUntil: 'networkidle' });
    const loadButton = page.getByRole('button', { name: 'Load external video', exact: true });
    if (await loadButton.count()) {
      assert.equal(await page.locator('iframe, video').count(), 0);
      assert.equal(report.network.length, 0, 'no external connection before explicit media load');
      await loadButton.click();
      await page.locator('iframe, video').waitFor();
      report.behaviors.push('PASS configured video absent before explicit load and present after');
    } else report.behaviors.push('NOT EXERCISED external video: no configured media in this build');
    await page.screenshot({ path: path.join(output, 'demo-320.png') });
    const serious = report.accessibility.flatMap((item) => item.violations).filter((item) => ['serious', 'critical'].includes(item.impact));
    console.log(JSON.stringify({ behaviors: report.behaviors, routes: report.accessibility.length, violations: report.accessibility.map((item) => ({ route: item.route, ids: item.violations.map((v) => `${v.id}:${v.nodes.length}`) })), serious: serious.length, reflow: report.reflow, pageErrors: report.pageErrors.length }, null, 2));
    assert.equal(report.accessibility.flatMap((item) => item.violations).length, 0, 'All reported accessibility violations require review');
    assert.equal(report.pageErrors.length, 0, 'Browser sample must not contain uncaught JavaScript errors');
    assert.equal(report.reflow.some((item) => item.overflow), false, 'Sampled 320px pages must not overflow');
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
