import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { isAllowedImageFileContent, removeLocalStoredFile } from '../lib/security';

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
  const previousUploadRoot = process.env.DRAPIXAI_UPLOAD_DIR;
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
    const uploadRoot = path.join(directory, 'uploads');
    const reviewDirectory = path.join(uploadRoot, 'tryon-review');
    fs.mkdirSync(reviewDirectory, { recursive: true });
    process.env.DRAPIXAI_UPLOAD_DIR = uploadRoot;
    const reviewImage = path.join(reviewDirectory, 'expired.png');
    fs.copyFileSync(imagePath, reviewImage);
    assert.equal(removeLocalStoredFile(`local:${reviewImage}`, 'tryon-review/'), true);
    assert.equal(fs.existsSync(reviewImage), false);
    assert.equal(removeLocalStoredFile(`local:${reviewImage}`, 'tryon-review/'), true, 'already-deleted media must be safe to retry');
    assert.equal(removeLocalStoredFile(`local:${imagePath}`, 'tryon-review/'), false, 'outside-root files must be rejected');
    assert.equal(removeLocalStoredFile(`local:${path.join(directory, 'missing.png')}`, 'tryon-review/'), false, 'missing outside-root files must still be rejected');
    const merchantImage = path.join(uploadRoot, 'merchant.png');
    fs.copyFileSync(imagePath, merchantImage);
    assert.equal(removeLocalStoredFile(`local:${merchantImage}`, 'tryon-review/'), false, 'wrong-prefix files must be rejected');
    assert.equal(removeLocalStoredFile('s3://bucket/tryon-review/file.png', 'tryon-review/'), false);
    const notAFile = path.join(reviewDirectory, 'not-a-file');
    fs.mkdirSync(notAFile);
    assert.throws(() => removeLocalStoredFile(`local:${notAFile}`, 'tryon-review/'), 'non-ENOENT storage errors must propagate');
    assert.ok(fs.existsSync(imagePath) && fs.existsSync(merchantImage) && fs.existsSync(notAFile));
    console.log('Image upload security tests passed');
  } finally {
    if (previousUploadRoot === undefined) delete process.env.DRAPIXAI_UPLOAD_DIR;
    else process.env.DRAPIXAI_UPLOAD_DIR = previousUploadRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
