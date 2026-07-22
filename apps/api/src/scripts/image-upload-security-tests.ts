import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { isAllowedImageFileContent } from '../lib/security';

const asUpload = (filePath: string, mimetype: string): Express.Multer.File => ({
  fieldname: 'image',
  originalname: path.basename(filePath),
  encoding: '7bit',
  mimetype,
  size: fs.statSync(filePath).size,
  destination: path.dirname(filePath),
  filename: path.basename(filePath),
  path: filePath,
  buffer: Buffer.alloc(0),
  stream: Readable.from(Buffer.alloc(0)),
});

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-upload-security-'));
  const imagePath = path.join(directory, 'valid.png');
  try {
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#1f7a55' },
    }).png().toFile(imagePath);

    assert.equal(await isAllowedImageFileContent(asUpload(imagePath, 'image/png')), true);
    assert.equal(await isAllowedImageFileContent(asUpload(imagePath, 'image/jpeg')), false, 'MIME/header mismatch must fail');
    assert.equal(
      await isAllowedImageFileContent(asUpload(imagePath, 'image/png'), { maxPixels: 100 }),
      false,
      'images above the configured decode pixel limit must fail',
    );
    assert.equal(
      await isAllowedImageFileContent(asUpload(imagePath, 'image/png'), { maxDimension: 8 }),
      false,
      'images above the configured dimension limit must fail',
    );
    console.log('Image upload security tests passed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
