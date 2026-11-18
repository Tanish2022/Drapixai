// Rebuild web derivatives from the owner's exact PNGs in branding/source/.
// Resizing/encoding only: retain the logo background and favicon transparency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const logo = fs.readFileSync(path.join(web, 'branding/source/logo.png'));
const favicon = fs.readFileSync(path.join(web, 'branding/source/favicon.png'));
const logoInfo = await sharp(logo).metadata();
const iconInfo = await sharp(favicon).metadata();
assert.equal(logoInfo.width, 2172); assert.equal(logoInfo.height, 724);
assert.equal(iconInfo.width, 1254); assert.equal(iconInfo.height, 1254);
assert.equal(iconInfo.hasAlpha, true);

const wordmark = await sharp(logo).resize({ width: 1400 }).webp({ lossless: true }).toBuffer();
const emblem = await sharp(favicon).resize(512, 512).webp({ lossless: true }).toBuffer();
const small = await sharp(favicon).resize(64, 64).webp({ lossless: true }).toBuffer();
const png = async size => sharp(favicon).resize(size, size).png().toBuffer();
const [icon16, icon32, icon48, apple] = await Promise.all([png(16), png(32), png(48), png(180)]);
// Standard ICO directory containing PNG frames, preserving per-pixel alpha.
const frames = [icon16, icon32, icon48];
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((bytes, i) => {
  const entry = 6 + 16 * i, size = [16, 32, 48][i];
  directory[entry] = size; directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(bytes.length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
const files = {
  'drapixai_wordmark.webp': wordmark,
  'drapixai_logo.webp': wordmark,
  'drapixai_logo.jpeg': await sharp(logo).jpeg({ quality: 95 }).toBuffer(),
  'drapixai_emblem.webp': emblem,
  'drapixai_emblem_64.webp': small,
  'drapixai_logo_64.webp': small,
  'favicon-16x16.png': icon16,
  'favicon-32x32.png': icon32,
  'apple-touch-icon.png': apple,
  'favicon.ico': Buffer.concat([directory, ...frames]),
};
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(web, 'public', name), bytes);
console.log(`Prepared ${Object.keys(files).length} web assets from the supplied logo/favicon PNGs.`);
