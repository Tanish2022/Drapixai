// Render the repository's HTML/CSS sharing card with the existing exact wordmark.
// No external services, fonts, generated people or new logo artwork are used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DRAPIXAI_PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(web, 'public/drapixai_wordmark.webp'));
const html = fs.readFileSync(path.join(web, 'branding/social-preview.html'), 'utf8')
  .replace('{{WORDMARK_DATA_URL}}', `data:image/webp;base64,${source.toString('base64')}`);
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  await page.setContent(html);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  assert.ok(await page.locator('img').evaluate(image => image.naturalWidth === 1400));
  const png = await page.screenshot({ type: 'png', animations: 'disabled' });
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  // New filename invalidates old social-preview URLs; the old URL also serves
  // the current artwork for previously saved/direct links after deployment.
  for (const name of [
    'og-drapixai-20261031-v2.png',
    'og-drapixai-20261031.png',
    'og-image.png',
  ]) {
    fs.writeFileSync(path.join(web, 'public', name), png);
  }
  console.log('Rendered current-wordmark sharing card: 1200 × 630.');
} finally {
  await browser.close();
}
