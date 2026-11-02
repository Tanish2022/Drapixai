// Windows-only, authentication-only probe. Never prints or persists session credentials.
// Uses existing API dependencies; no S3 data operations or fallback credential chain.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiRequire = createRequire(resolve(repo, 'apps/api/package.json'));
const account = '111122223333';
const region = 'ap-south-1';
const role = 'drapixai-cpu-staging-storage';
const anchorArn = `arn:aws:rolesanywhere:${region}:${account}:trust-anchor/d74aba83-7e91-41d9-9727-652b968273aa`;
const profileArn = `arn:aws:rolesanywhere:${region}:${account}:profile/a15e5850-4082-4e70-ada6-c4d770c85cdc`;
const bundle = resolve(repo, 'runtime/launch-evidence/storage-identity-public-20261024');
const helper = resolve(repo, 'runtime/tooling/aws-signing-helper/1.8.5/aws_signing_helper.exe');
const expectedDigest = 'fc4c3e65864c1829fcd87ae3718387db03b8ea48b8819f5a6031482ba5d243cd';
const slash = (path) => path.replaceAll('\\', '/');
let phase = 'preflight';

try {
  assert.equal(process.platform, 'win32', 'Windows certificate store required');
  assert.equal(process.argv.length, 3);
  assert.ok(['--prepare', '--authenticate'].includes(process.argv[2]));
  assert.equal(createHash('sha256').update(readFileSync(helper)).digest('hex'), expectedDigest);
  const metadata = JSON.parse(readFileSync(resolve(bundle, 'metadata.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(metadata.leafSubject, 'CN=DrapixAI-CpuStaging-Windows-20261024');
  assert.equal(metadata.leafIssuer, 'CN=DrapixAI-CpuStaging-CA-20261024');
  assert.match(metadata.leafSerial, /^[A-F0-9]{1,40}$/);
  assert.ok(Date.parse(metadata.leafExpires) > Date.now());
  const selector = [
    { Key: 'x509Subject', Value: metadata.leafSubject },
    { Key: 'x509Issuer', Value: metadata.leafIssuer },
    { Key: 'x509Serial', Value: metadata.leafSerial },
  ];
  const selectorPath = resolve(bundle, 'selector.json');
  const configPath = resolve(bundle, 'aws-config');
  const emptyCredentialsPath = resolve(bundle, 'empty-credentials');
  // These arguments contain only public identifiers and approved local paths.
  const command = `"${slash(helper)}" credential-process --cert-selector "file://${slash(selectorPath)}" --system-store-name MY --region ${region} --trust-anchor-arn ${anchorArn} --profile-arn ${profileArn} --role-arn arn:aws:iam::${account}:role/${role} --session-duration 900`;
  const config = `[profile ${role}]\nregion = ${region}\ncredential_process = ${command}\n`;
  if (process.argv[2] === '--prepare') {
    // Exclusive creation prevents overwriting other configuration or credentials.
    writeFileSync(selectorPath, JSON.stringify(selector, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(configPath, config, { flag: 'wx' });
    writeFileSync(emptyCredentialsPath, '', { flag: 'wx' });
    console.log(JSON.stringify({ passed: true, stage: 'prepared', secretsWritten: 0, networkRequests: 0, defaultAwsConfigChanged: false }));
    process.exit(0);
  }
  assert.equal(readFileSync(configPath, 'utf8'), config);
  assert.deepEqual(JSON.parse(readFileSync(selectorPath, 'utf8')), selector);
  assert.equal(readFileSync(emptyCredentialsPath, 'utf8'), '');
  // Ignore ambient credentials, endpoints and container metadata. This child process exits
  // afterwards; parent environment and application settings are never changed.
  for (const key of Object.keys(process.env)) {
    if (/^AWS_/i.test(key)) delete process.env[key];
  }
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
  const { fromProcess } = apiRequire('@aws-sdk/credential-provider-process');
  phase = 'credential-process';
  const credentials = await fromProcess({
    profile: role, configFilepath: configPath, filepath: emptyCredentialsPath,
    ignoreCache: true,
  })();
  const now = Date.now();
  const remainingSeconds = Math.round((credentials.expiration.getTime() - now) / 1000);
  assert.ok(credentials.sessionToken && credentials.secretAccessKey && credentials.accessKeyId);
  assert.ok(remainingSeconds > 0 && remainingSeconds <= 905);

  phase = 'caller-identity';
  const { SignatureV4 } = apiRequire('@smithy/signature-v4');
  const { HttpRequest } = apiRequire('@smithy/protocol-http');
  const { Sha256 } = apiRequire('@aws-crypto/sha256-js');
  const hostname = 'sts.ap-south-1.amazonaws.com';
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  const signer = new SignatureV4({ credentials, region, service: 'sts', sha256: Sha256 });
  const signed = await signer.sign(new HttpRequest({
    protocol: 'https:', hostname, method: 'POST', path: '/',
    headers: { host: hostname, 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) }, body,
  }));
  const response = await new Promise((resolveResponse, reject) => {
    const req = https.request({ hostname, method: 'POST', path: '/', headers: signed.headers, minVersion: 'TLSv1.2', rejectUnauthorized: true, timeout: 15000 }, (res) => {
      let xml = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { xml += chunk; if (xml.length > 65536) res.destroy(new Error('RESPONSE_LIMIT')); });
      res.on('error', reject);
      res.on('end', () => resolveResponse({ status: res.statusCode, xml }));
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(response.status, 200);
  const returnedAccount = /<Account>(\d+)<\/Account>/.exec(response.xml)?.[1];
  const arn = /<Arn>([^<]+)<\/Arn>/.exec(response.xml)?.[1];
  assert.equal(returnedAccount, account);
  assert.ok(arn?.startsWith(`arn:aws:sts::${account}:assumed-role/${role}/`));
  const evidence = {
    passed: true, checkedAt: new Date().toISOString(), account: returnedAccount, callerArn: arn,
    sessionSecondsRequested: 900, sessionSecondsRemaining: remainingSeconds,
    temporarySessionTokenPresent: true, expiresAt: credentials.expiration.toISOString(),
    credentialSource: 'explicit named credential_process; Windows CNG',
    helperDigestVerified: true, callerIdentityVerified: true,
    objectsUploaded: 0, objectsDeleted: 0, s3Requests: 0, credentialsPrinted: false,
    privateKeysExported: false, defaultAwsConfigChanged: false,
  };
  writeFileSync(resolve(repo, 'runtime/launch-evidence/aws-storage-authentication-20261024.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} catch {
  // Never expose credential-provider stderr, signed HTTP headers or response bodies.
  console.error(JSON.stringify({ passed: false, error: 'STAGING_STORAGE_AUTH_CHECK_FAILED', phase, credentialsPrinted: false }));
  process.exitCode = 1;
}
