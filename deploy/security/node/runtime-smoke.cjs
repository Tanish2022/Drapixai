// Offline, synthetic core-crypto/TLS compatibility. Not an exploit or live drill.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const tls = require('node:tls');
const report = { scope: 'offline Node shared-OpenSSL review candidate; not production approval', passed: false, checks: [] };
const check = (value) => report.checks.push(value);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fixture = (name) => fs.readFileSync(`/fixtures/${name}.pem`);
const servers = [];
const listen = async (options) => {
  const server = https.createServer(options, (_req, res) => { res.writeHead(200); res.end('synthetic-ok'); });
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  servers.push(server); return server.address().port;
};
const request = (port, options = {}) => new Promise((resolve, reject) => {
  const req = https.get({ host: '127.0.0.1', port, ca: fixture('ca'), cert: fixture('client'), key: fixture('client-key'),
    servername: 'candidate-server.example.test', rejectUnauthorized: true, agent: false, signal: AbortSignal.timeout(2500), ...options }, (res) => {
    const protocol = res.socket.getProtocol();
    let body = ''; res.on('data', value => { body += value; });
    res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, body, protocol }));
  }); req.on('error', reject);
});

(async () => {
  try {
    const provenance = JSON.parse(fs.readFileSync('/usr/share/drapixai/node-build-provenance.json', 'utf8'));
    assert.equal(provenance.channel, 'shared-openssl-review-candidate'); assert.equal(provenance.productionApproved, false);
    assert.equal(process.versions.node, '22.23.3'); assert.equal(process.versions.modules, '127');
    assert.equal(process.versions.icu, process.env.DRAPIXAI_BASELINE_ICU, 'ICU version must match the original runtime');
    assert.equal(process.config.variables.node_shared_openssl, true);
    assert.equal(sha(fs.readFileSync(process.execPath)), provenance.nodeSha256);
    for (const [file, digest] of Object.entries(provenance.librarySha256)) assert.equal(sha(fs.readFileSync(file)), digest);
    const metadata = fs.readFileSync('/var/lib/dpkg/status.d/libssl3t64', 'utf8');
    assert.ok(metadata.includes(`Version: ${provenance.debianOpenSSLVersion}\n`));
    const loaded = process.report.getReport().sharedObjects;
    for (const library of ['libssl.so.3', 'libcrypto.so.3']) assert.ok(loaded.some(file => file.endsWith(library)), `${library} must actually be mapped`);
    assert.notEqual(process.getuid(), 0); assert.equal(fs.existsSync('/bin/sh'), false);
    for (const file of ['Node.LICENSE', 'OpenSSL.copyright', 'Apache-2.0']) assert.ok(fs.readFileSync(`/usr/share/drapixai/${file}`).length > 100);
    assert.throws(() => fs.writeFileSync('/readonly-probe', 'synthetic'), error => ['EROFS', 'EACCES'].includes(error.code));
    check('Node 22/ABI 127, dynamic SSL/crypto mappings, provenance/file hashes, non-root shell-free read-only runtime');
    const roots = sha([...tls.rootCertificates].sort().join('\0'));
    assert.ok(process.env.DRAPIXAI_BASELINE_ROOTS_SHA256);
    assert.equal(roots, process.env.DRAPIXAI_BASELINE_ROOTS_SHA256, 'Bundled trust roots must match the original Node 22 runtime');
    check('Bundled root certificate set matches the original Node runtime');
    assert.equal(sha('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const [kind, options] of [['rsa', { modulusLength: 2048 }], ['ec', { namedCurve: 'prime256v1' }]]) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync(kind, options);
      const signature = crypto.sign('sha256', Buffer.from('synthetic-message'), privateKey);
      assert.equal(crypto.verify('sha256', Buffer.from('synthetic-message'), publicKey, signature), true);
      assert.equal(crypto.verify('sha256', Buffer.from('changed-message'), publicKey, signature), false);
    }
    const secret = await crypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.randomBytes(12), input = Buffer.from('synthetic-session');
    const encrypted = new Uint8Array(await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: input }, secret, input));
    assert.deepEqual(Buffer.from(await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: input }, secret, encrypted)), input);
    encrypted[0] ^= 1;
    await assert.rejects(crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: input }, secret, encrypted));
    check('SHA-256, RSA/ECDSA sign/verify and WebCrypto AES-GCM round trip/tamper rejection');
    const options = { key: fixture('server-key'), cert: fixture('server'), ca: fixture('ca'), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
    const port = await listen(options);
    for (const version of ['TLSv1.2', 'TLSv1.3']) {
      const response = await request(port, { minVersion: version, maxVersion: version });
      assert.equal(response.status, 200); assert.equal(response.body, 'synthetic-ok'); assert.equal(response.protocol, version);
    }
    check('TLS 1.2 and 1.3 mutually authenticated loopback HTTPS succeed');
    await assert.rejects(request(port, { cert: undefined, key: undefined }), error => ['ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ECONNRESET'].includes(error.code));
    await assert.rejects(request(port, { ca: fixture('other-ca') }), error => ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code));
    await assert.rejects(request(port, { servername: 'wrong.example.test' }), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID');
    const expired = await listen({ ...options, key: fixture('expired-server-key'), cert: fixture('expired-server') });
    await assert.rejects(request(expired), error => error.code === 'CERT_HAS_EXPIRED');
    await assert.rejects(request(port, { minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1' }), error => ['ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION', 'ERR_SSL_NO_PROTOCOLS_AVAILABLE', 'ERR_SSL_NO_CIPHERS_AVAILABLE'].includes(error.code));
    check('Missing client identity, wrong CA/hostname, expired certificate and TLS 1.1 fail');
    report.runtime = { node: process.versions.node, openssl: process.versions.openssl, icu: process.versions.icu,
      sharedOpenSSL: true, nodeSha256: provenance.nodeSha256, package: provenance.debianOpenSSLVersion, rootsSha256: roots };
    report.passed = true;
  } catch (error) { report.failure = error.stack || error.message; process.exitCode = 1; }
  finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    console.log(JSON.stringify(report, null, 2));
  }
})();
