import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

// Real SDK credential resolution/signing, intercepted before the HTTP handler.
// No dotenv, real credentials, cloud call or object operation is used.
const main = async () => {
  const original = { ...process.env };
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-storage-credentials-'));
  const providerScript = path.join(fixture, 'provider.cjs');
  const configPath = path.join(fixture, 'config');
  const credentialsPath = path.join(fixture, 'credentials');
  fs.writeFileSync(providerScript, `process.stdout.write(JSON.stringify({Version:1,AccessKeyId:'synthetic-process-access',SecretAccessKey:'synthetic-process-secret-only',SessionToken:'synthetic-process-session-only',Expiration:new Date(Date.now()+3600000).toISOString()}));`);
  fs.writeFileSync(credentialsPath, '');
  fs.writeFileSync(configPath, `[profile drapixai-offline]\ncredential_process = "${process.execPath}" "${providerScript}"\nregion = ap-south-1\n`);
  const storagePath = require.resolve('../lib/storage');
  const resetEnvironment = () => {
    for (const key of Object.keys(process.env)) if (key.startsWith('AWS_')) delete process.env[key];
    Object.assign(process.env, {
      AWS_REGION: 'ap-south-1', AWS_PROFILE: 'drapixai-offline',
      AWS_CONFIG_FILE: configPath, AWS_SHARED_CREDENTIALS_FILE: credentialsPath,
      AWS_EC2_METADATA_DISABLED: 'true', AWS_MAX_ATTEMPTS: '1', AWS_SDK_LOAD_CONFIG: '1',
      S3_ENDPOINT: 'https://s3-fixture.invalid', S3_BUCKET: 'synthetic-fixture',
    });
  };
  const signedHeaders = async () => {
    delete require.cache[storagePath];
    const storage = require('../lib/storage') as typeof import('../lib/storage');
    const client = storage.createStorageClient();
    let headers: Record<string, string> | undefined;
    client.config.requestHandler.handle = async (request: any) => {
      assert.equal(request.hostname, 's3-fixture.invalid');
      assert.equal(request.method, 'HEAD');
      headers = request.headers;
      return { response: { statusCode: 200, headers: {}, body: Buffer.alloc(0) } };
    };
    try {
      await client.send(new HeadObjectCommand({ Bucket: 'synthetic-fixture', Key: 'garments/test.png' }));
      assert.ok(headers?.authorization?.startsWith('AWS4-HMAC-SHA256 '));
      const summary = JSON.stringify(storage.getStorageSummary());
      for (const secret of ['synthetic-session-only', 'synthetic-secret-only', 'synthetic-process-session-only']) {
        assert.ok(!summary.includes(secret), 'Storage summary must not expose credential material');
      }
      return headers!;
    } finally { client.destroy(); }
  };
  try {
    resetEnvironment();
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'synthetic-env-access', AWS_SECRET_ACCESS_KEY: 'synthetic-secret-only', AWS_SESSION_TOKEN: 'synthetic-session-only' });
    const temporary = await signedHeaders();
    assert.equal(temporary['x-amz-security-token'], 'synthetic-session-only');
    assert.match(temporary.authorization, /SignedHeaders=[^,]*x-amz-security-token/);
    console.log('PASS temporary environment credentials include their signed session token');

    resetEnvironment();
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'synthetic-env-access', AWS_SECRET_ACCESS_KEY: 'synthetic-secret-only' });
    const permanentFixture = await signedHeaders();
    assert.equal(permanentFixture['x-amz-security-token'], undefined);
    console.log('PASS existing two-part synthetic credentials still sign normally');

    resetEnvironment();
    const delegated = await signedHeaders();
    assert.equal(delegated['x-amz-security-token'], 'synthetic-process-session-only');
    assert.match(delegated.authorization, /Credential=synthetic-process-access\//);
    console.log('PASS SDK default chain obtains temporary credentials from an isolated credential_process');
    console.log('Storage credential signing: 3 groups passed; 0 network requests; no real credentials.');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    delete require.cache[storagePath];
    // Only this mkdtemp-created fixture is removed, never a supplied profile path.
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('drapixai-storage-credentials-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
main().catch(() => { console.error('STORAGE_CREDENTIAL_TEST_FAILED'); process.exitCode = 1; });
