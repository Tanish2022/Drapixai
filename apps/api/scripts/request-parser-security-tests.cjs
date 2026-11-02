// Real patched parsers, synthetic requests and a loopback-only server.
// No application bootstrap, credentials, database, filesystem uploads or cloud.
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const multer = require('multer');
const qs = require('qs');

async function main() {
  // GHSA-6pq8-jhm2-2vcw: an own non-callable toString must not crash
  // comma-array serialization. Exercise the installed dependency, not a mock.
  assert.doesNotThrow(() => qs.stringify({ a: [{ toString: 0 }] }, { arrayFormat: 'comma' }));
  assert.equal(qs.stringify({ a: ['one', 'two'] }, { arrayFormat: 'comma' }), 'a=one%2Ctwo');
  assert.deepEqual(qs.parse('a[b]=1'), { a: { b: '1' } });
  console.log('PASS qs: hostile comma-array value is safe and normal serialization/parsing are preserved');
  const app = express();
  const errors = [];
  let releaseFilter;
  let stored = 0;
  const storage = {
    _handleFile(_req, file, cb) {
      stored++;
      const chunks = [];
      file.stream.on('data', chunk => chunks.push(chunk));
      file.stream.once('error', cb);
      file.stream.once('end', () => cb(null, { buffer: Buffer.concat(chunks) }));
    },
    _removeFile(_req, _file, cb) { cb(null); },
  };
  const upload = multer({ storage, limits: { fileSize: 1024, files: 2 }, fileFilter(_req, file, cb) {
    if (file.originalname === 'pending.txt') releaseFilter = () => cb(null, true);
    else if (file.originalname === 'reject.txt') cb(new Error('SYNTHETIC_REJECTION'));
    else cb(null, true);
  } });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/json', express.json({ limit: '1kb' }), (req, res) => res.json(req.body));
  app.post('/upload', upload.array('files', 2), (req, res) => res.json({ contents: req.files.map(file => file.buffer.toString('utf8')) }));
  app.use((err, _req, res, _next) => { errors.push(err.message); res.status(err.status || 400).json({ rejected: true }); });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const request = (route, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-length': body.length } : {}), ...headers }, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('FIXTURE_TIMEOUT')));
    req.once('error', reject); req.end(body);
  });
  const multipart = names => Buffer.from(names.map(name => `--fixture-boundary\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nsynthetic\r\n`).join('') + '--fixture-boundary--\r\n');
  const multipartHeader = { 'content-type': 'multipart/form-data; boundary=fixture-boundary' };
  try {
    for (const [encoding, compress] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
      const valid = compress(Buffer.from('{"synthetic":true}'));
      const headers = { 'content-type': 'application/json', 'content-encoding': encoding };
      assert.deepEqual(await request('/json', valid, headers), { status: 200, body: { synthetic: true } });
      assert.equal((await request('/json', Buffer.from('invalid compressed input'), headers)).status, 400);
      const trailing = await request('/json', Buffer.concat([valid, Buffer.from('trailing bytes')]), headers);
      assert.ok([200, 400].includes(trailing.status));
      if (trailing.status === 200) assert.deepEqual(trailing.body, { synthetic: true });
      await delay(30);
      assert.equal((await request('/health')).status, 200);
      console.log(`PASS ${encoding}: valid body preserved; malformed/trailing input cannot terminate parser host`);
    }
    assert.deepEqual(await request('/upload', multipart(['valid.txt']), multipartHeader), { status: 200, body: { contents: ['synthetic'] } });
    assert.equal(stored, 1);
    console.log('PASS multipart: valid bounded upload preserves exact bytes');
    assert.equal((await request('/upload', multipart(['pending.txt', 'reject.txt']), multipartHeader)).status, 400);
    assert.equal(typeof releaseFilter, 'function', 'Pending async filter must actually be reached');
    assert.ok(errors.includes('SYNTHETIC_REJECTION'), 'Teardown must occur before pending callback resumes');
    releaseFilter();
    await delay(50);
    assert.equal(stored, 1, 'A late fileFilter callback must not start storage after teardown');
    assert.equal((await request('/health')).status, 200);
    console.log('PASS multipart: pending async filter after teardown cannot resume storage or terminate host');
    console.log('6/6 real request-parser regression groups passed');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
