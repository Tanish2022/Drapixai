import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && ['--orm', '--http', '--browser'].includes(process.argv[2])), 'Usage: node scripts/verify-account-terms-database.mjs [--orm|--http|--browser]');
const runBrowser = process.argv[2] === '--browser';
const runHttp = process.argv[2] === '--http' || runBrowser;
const runOrm = process.argv[2] === '--orm' || runHttp;
const id = crypto.randomBytes(8).toString('hex');
const name = `drapixai-terms-test-${id}`;
const label = `drapixai.terms-fixture=${id}`;
const password = crypto.randomBytes(32).toString('hex');
const image = 'postgres:16-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4';
const database = 'drapixai_terms_test';
const reportPath = path.join(root, 'runtime/launch-evidence', `account-terms-${id}.json`);
const report = { scope: 'Disposable owned PostgreSQL with no host ports/network; SQL schema and immutable records only, not signup/OAuth enforcement or live staging', passed: false, startedAt: new Date().toISOString(), checks: [], source: {} };
if (runOrm) report.scope = 'Actual Prisma acceptance helpers in an owned disposable PostgreSQL with a temporary loopback-only port; not signup/OAuth enforcement or live staging';
if (runHttp) report.scope = 'Current TypeScript production-mode auth/account/terms routers over loopback HTTP with owned PostgreSQL and Redis; not live Google, deployed image, SMTP or staging';
const invoke = (args, options = {}) => spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, ...options });
const clean = value => String(value || '').replaceAll(password, '[redacted]');
function checked(args, options) {
  const result = invoke(args, options);
  assert.equal(result.status, 0, clean(result.error?.message || result.stderr || result.stdout || 'Docker operation failed'));
  return result.stdout.trim();
}
function fixtureImage(ref) {
  if (invoke(['image', 'inspect', ref]).status !== 0) checked(['pull', ref], { timeout: 180000 });
  return JSON.parse(checked(['image', 'inspect', ref]))[0];
}
const psql = sql => invoke(['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: sql });
function sql(sql) { const result = psql(sql); assert.equal(result.status, 0, clean(result.stderr || result.stdout)); return result.stdout.trim(); }
const quote = value => `'${value.replaceAll("'", "''")}'`;
function rejects(statement, expected, label) {
  const result = psql(statement);
  assert.notEqual(result.status, 0, `${label}: invalid operation succeeded`);
  assert.match(result.stderr, expected, `${label}: failed for an unexpected reason`);
  report.checks.push(label);
}
try {
  // Explicitly inspect the known digest; never start an existing database or read .env.
  const metadata = fixtureImage(image);
  report.imageId = metadata.Id;
  checked(['run', '--pull=never', '-d', '--name', name, '--label', label,
    ...(runOrm ? ['-p', '127.0.0.1::5432'] : ['--network', 'none']), '--memory', '512m', '--cpus', '2', '--pids-limit', '128',
    '--ulimit', 'core=0', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=${database}`, image],
    { env: { ...process.env, POSTGRES_PASSWORD: password } });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = psql('SELECT 1;');
    if (result.status === 0 && result.stdout.trim() === '1') { ready = true; break; }
    await delay(500);
  }
  assert.ok(ready, 'Owned disposable PostgreSQL did not become ready');
  const migrations = path.join(root, 'apps/api/prisma/migrations');
  for (const entry of fs.readdirSync(migrations).sort()) {
    const file = path.join(migrations, entry, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    report.source[path.relative(root, file)] = crypto.createHash('sha256').update(bytes).digest('hex');
    sql(bytes.toString('utf8'));
  }
  const documentFile = path.join(root, 'apps/api/src/legal/terms-2026-10-19.json');
  const document = JSON.parse(fs.readFileSync(documentFile, 'utf8'));
  const content = JSON.stringify(document);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  report.source[path.relative(root, documentFile)] = crypto.createHash('sha256').update(fs.readFileSync(documentFile)).digest('hex');
  for (const file of ['apps/api/src/lib/account-terms.ts', 'apps/api/src/lib/api-key-auth.ts', 'apps/api/src/legal/terms-metadata.json', 'apps/api/src/routes/auth.ts', 'apps/api/src/routes/account-terms.ts', 'apps/api/src/routes/account.ts', 'apps/api/src/scripts/account-terms-database-tests.ts', 'apps/api/src/scripts/auth-http-database-tests.ts', 'apps/api/prisma/schema.prisma', 'scripts/verify-account-terms-database.mjs']) {
    report.source[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  }
  if (runOrm) {
    // The fixture role mirrors append/read permissions for retained evidence.
    // Exercise actual Prisma queries without owner or ledger UPDATE privileges.
    const runtimeRole = 'drapixai_terms_fixture_api';
    sql(`CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quote(password)};
      REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${runtimeRole};
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ${runtimeRole};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtimeRole};
      REVOKE ALL ON TABLE "TermsDocument", "AccountTermsAcceptance", "SecurityAuditLog" FROM ${runtimeRole};
      GRANT SELECT, INSERT ON TABLE "TermsDocument", "AccountTermsAcceptance", "SecurityAuditLog" TO ${runtimeRole};`);
    report.runtimeRole = { privileged: false, evidenceTablePrivileges: ['SELECT', 'INSERT'] };
    const published = checked(['port', name, '5432/tcp']);
    assert.match(published, /^127\.0\.0\.1:\d+$/);
    const port = Number(published.split(':')[1]);
    let redisUrl = '';
    if (runHttp) {
      const redisImage = 'redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2';
      report.redisImageId = fixtureImage(redisImage).Id;
      checked(['run', '--pull=never', '-d', '--name', `${name}-redis`, '--label', label, '-p', '127.0.0.1::6379',
        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'redis', '--memory', '128m', '--pids-limit', '128',
        '--tmpfs', '/data:rw,noexec,nosuid,size=16m,mode=1777', redisImage, 'redis-server', '--save', '', '--appendonly', 'no', '--requirepass', password]);
      let redisReady = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ping = invoke(['exec', '-e', 'REDISCLI_AUTH', `${name}-redis`, 'redis-cli', 'ping'], { env: { ...process.env, REDISCLI_AUTH: password } });
        if (ping.status === 0 && ping.stdout.trim() === 'PONG') { redisReady = true; break; }
        await delay(500);
      }
      assert.ok(redisReady, 'Owned Redis did not become ready');
      const publishedRedis = checked(['port', `${name}-redis`, '6379/tcp']);
      assert.match(publishedRedis, /^127\.0\.0\.1:\d+$/);
      redisUrl = `redis://:${password}@127.0.0.1:${publishedRedis.split(':')[1]}/15`;
    }
    const fixture = runHttp ? 'auth-http-database-tests.ts' : 'account-terms-database-tests.ts';
    const result = spawnSync(process.execPath, [path.join(root, 'apps/api/node_modules/ts-node/dist/bin.js'), '--project', path.join(root, 'apps/api/tsconfig.json'), path.join(root, 'apps/api/src/scripts', fixture)], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: runBrowser ? 180000 : 60000, maxBuffer: 1024 * 1024,
      env: { ...process.env, DATABASE_URL: `postgresql://${runtimeRole}:${password}@127.0.0.1:${port}/${database}?connection_limit=2&pool_timeout=10`,
        DRAPIXAI_DISPOSABLE_DB_APPROVAL: 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE', DRAPIXAI_TERMS_FIXTURE_APPROVAL: 'I_ACKNOWLEDGE_DISPOSABLE_TERMS_FIXTURE',
        ...(runHttp ? { NODE_ENV: 'production', REDIS_URL: redisUrl, SMTP_HOST: '', DRAPIXAI_ADMIN_EMAIL: '', DRAPIXAI_ADMIN_TOTP_SECRET: '',
          DRAPIXAI_DISPOSABLE_HTTP_APPROVAL: 'I_ACKNOWLEDGE_DISPOSABLE_HTTP_FIXTURE', DRAPIXAI_DASHBOARD_PROXY_TOKEN: crypto.randomBytes(48).toString('hex'), DRAPIXAI_AUDIT_LOG_SECRET: crypto.randomBytes(48).toString('hex'),
          DRAPIXAI_TERMS_BROWSER_FIXTURE: runBrowser ? 'I_ACKNOWLEDGE_DISPOSABLE_TERMS_BROWSER' : '' } : {}) },
    });
    assert.equal(result.status, 0, clean(result.error?.message || result.stderr || result.stdout));
    const body = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(body.passed, true);
    report.checks = body.checks;
  } else {
  const userId = Number(sql(`INSERT INTO "User" ("email", "passwordHash") VALUES ('terms-test@example.invalid', 'synthetic-not-a-password') RETURNING "id";`));
  assert.ok(Number.isSafeInteger(userId) && userId > 0);
  assert.equal(sql('SELECT count(*) FROM "AccountTermsAcceptance";'), '0');
  report.checks.push('Existing accounts are not assigned fabricated acceptance');
  sql(`INSERT INTO "TermsDocument" ("version", "sha256", "content") VALUES (${quote(document.version)}, ${quote(hash)}, ${quote(content)});`);
  const otherUserId = Number(sql(`INSERT INTO "User" ("email", "passwordHash") VALUES ('terms-other@example.invalid', 'synthetic-not-a-password') RETURNING "id";`));
  const insert = (version = document.version, digest = hash, flow = 'password_signup', accountId = userId) => `INSERT INTO "AccountTermsAcceptance" ("userId", "documentVersion", "documentHash", "flow", "acceptedAt") VALUES (${accountId}, ${quote(version)}, ${quote(digest)}, ${quote(flow)}, '2000-01-01');`;
  sql(insert());
  assert.equal(sql(`SELECT ("acceptedAt" > CURRENT_TIMESTAMP - INTERVAL '1 minute')::text FROM "AccountTermsAcceptance" WHERE "userId"=${userId};`), 'true');
  report.checks.push('Database clock overrides a forged browser-style acceptance timestamp');
  rejects(insert(), /duplicate key value violates unique constraint/, 'Duplicate account/version acceptance cannot rewrite the first record');
  rejects(insert('not-published'), /violates foreign key constraint/, 'Unknown document version rejected');
  rejects(insert(document.version, '0'.repeat(64), 'password_signup', otherUserId), /violates foreign key constraint/, 'Mismatched document hash rejected');
  rejects(insert(document.version, hash, 'google-says-accepted'), /violates check constraint/, 'Invented acceptance flow rejected');
  rejects(`INSERT INTO "TermsDocument" ("version", "sha256", "content") VALUES ('forged', '${'0'.repeat(64)}', ${quote(content)});`, /violates check constraint/, 'Stored document content must match its SHA-256');
  const missing = '{}';
  rejects(`INSERT INTO "TermsDocument" ("version", "sha256", "content") VALUES ('missing', '${crypto.createHash('sha256').update(missing).digest('hex')}', '{}');`, /violates check constraint/, 'Missing document metadata cannot pass SQL NULL checks');
  for (const table of ['TermsDocument', 'AccountTermsAcceptance']) {
    for (const statement of [`UPDATE "${table}" SET ${table === 'TermsDocument' ? '"content"="content"' : '"flow"=\'authenticated_account\''};`, `DELETE FROM "${table}";`, `TRUNCATE "${table}" CASCADE;`]) {
      rejects(statement, /append-only/, `${table} rejects ${statement.split(' ')[0]}`);
    }
  }
  rejects(`DELETE FROM "User" WHERE "id"=${userId};`, /violates foreign key constraint/, 'Account deletion cannot silently discard acceptance evidence');
  assert.equal(sql('SELECT count(*) FROM "AccountTermsAcceptance";'), '1');
  assert.equal(sql('SELECT "sha256" FROM "TermsDocument";'), hash);
  report.checks.push('Original evidence survives every rejected mutation');
  }
  report.passed = true;
} catch (error) { report.failure = clean(error.message); process.exitCode = 1; }
finally {
  const owned = invoke(['ps', '-aq', '--filter', `label=${label}`]);
  if (owned.status !== 0) { report.cleanupFailure = 'Cannot inspect owned fixture containers'; process.exitCode = 1; report.passed = false; }
  else for (const cid of owned.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(cid) || invoke(['rm', '-fv', cid]).status !== 0) { report.cleanupFailure = 'Owned fixture removal failed'; process.exitCode = 1; report.passed = false; }
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, reportPath, failure: report.failure ?? report.cleanupFailure ?? null }));
}
