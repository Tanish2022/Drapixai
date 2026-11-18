import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drapixai-replay-'));
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (pathname.endsWith('/large-header')) {
      res.writeHead(200, { 'Content-Length': 17 * 1024 * 1024 });
      res.flushHeaders();
      return;
    }
    if (pathname.endsWith('/large-body')) {
      res.write(Buffer.alloc(17 * 1024 * 1024));
      res.end();
      return;
    }
    if (pathname.endsWith('/stall')) {
      res.write('partial');
      return;
    }
    res.end('synthetic image');
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    Object.assign(process.env, {
      NODE_ENV: 'test', S3_ENDPOINT: `http://127.0.0.1:${address.port}`, S3_FORCE_PATH_STYLE: '1',
      S3_BUCKET: 'replay-fixture', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic',
      AWS_SESSION_TOKEN: '', DRAPIXAI_UPLOAD_DIR: root, DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK: '1',
    });
    const { readStoredObject } = await import('../lib/storage');
    assert.equal(await readStoredObject('s3://foreign-fixture/outputs/object'), null);
    assert.equal(await readStoredObject('s3://replay-fixture/garments/object'), null);
    assert.equal(await readStoredObject('s3://replay-fixture/outputs/../other'), null);
    assert.equal(requests, 0);
    assert.equal(String(await readStoredObject('s3://replay-fixture/outputs/ok')), 'synthetic image');
    assert.equal(await readStoredObject('s3://replay-fixture/outputs/large-header'), null);
    assert.equal(await readStoredObject('s3://replay-fixture/outputs/large-body'), null);
    const start = performance.now();
    assert.equal(await readStoredObject('s3://replay-fixture/outputs/stall'), null);
    assert.ok(performance.now() - start < 7000, 'The deadline must include the response body');

    await fs.mkdir(path.join(root, 'session'));
    const permitted = path.join(root, 'session', 'result');
    await fs.writeFile(permitted, 'synthetic image');
    assert.equal(String(await readStoredObject(`local:${permitted}`)), 'synthetic image');
    const excluded = path.join(root, 'other');
    await fs.writeFile(excluded, 'private');
    assert.equal(await readStoredObject(`local:${excluded}`), null);
    console.log('PASS legacy replay rejects foreign scopes and oversized or stalled response bodies');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
