import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { issueVerificationCode } from '../lib/verification';
import { verifyPassword } from '../lib/password-hash';
import { inputValidationMiddleware } from '../lib/input-validation';
import { formatLogError } from '../lib/security';
import { CURRENT_TERMS } from '../lib/account-terms';

// A CLI fixture, never a public route. Production-mode auth/account routers are
// mounted in a minimal loopback Express host, not the full production server.
export const validateAuthHttpFixtureEnv = (env: NodeJS.ProcessEnv) => {
  requireDisposableDatabase(env);
  const redisUrl = new URL(env.REDIS_URL || '');
  assert.ok(['redis:', 'rediss:'].includes(redisUrl.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(redisUrl.hostname));
  assert.equal(redisUrl.pathname, '/15');
  assert.equal(env.DRAPIXAI_DISPOSABLE_HTTP_APPROVAL, 'I_ACKNOWLEDGE_DISPOSABLE_HTTP_FIXTURE');
  assert.equal(env.NODE_ENV, 'production');
  assert.ok((env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').length >= 32);
  assert.ok(!env.SMTP_HOST, 'This fixture must not send mail');
  assert.ok(!env.DRAPIXAI_ADMIN_EMAIL && !env.DRAPIXAI_ADMIN_TOTP_SECRET);
  return redisUrl;
};

const main = async () => {
  const redisUrl = validateAuthHttpFixtureEnv(process.env);

  const prisma = new PrismaClient();
  const redis = createClient({ url: redisUrl.toString(), socket: { connectTimeout: 1000, reconnectStrategy: false } });
  redis.on('error', () => undefined);
  const marker = `http_${crypto.randomBytes(8).toString('hex')}`;
  const emails = ['a', 'b', 'boundary', 'google'].map(part => `${marker}-${part}@example.invalid`);
  const termsAcceptance = { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash };
  const checks: string[] = [];
  const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
  let server: http.Server | undefined;
  try {
    assert.equal(await prisma.user.count(), 0, 'Only a new empty disposable database is allowed');
    await redis.connect();
    assert.equal(await redis.dbSize(), 0, 'Only an empty disposable Redis DB is allowed');
    // Import actual compiled routes after fixture guards, before any requests.
    process.env.DRAPIXAI_AUTH_SYNC_TOKEN = crypto.randomBytes(48).toString('hex');
    const auth = (await import('../routes/auth')).default;
    const terms = (await import('../routes/account-terms')).default;
    const account = (await import('../routes/account')).default;
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '16kb' }));
    app.use(inputValidationMiddleware);
    app.use('/auth/terms', terms); app.use('/auth', auth); app.use('/account', account);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'FIXTURE_ROUTE_FAILURE' });
    });
    server = await new Promise<http.Server>((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = (route: string, options: { body?: unknown; key?: string; client?: number; proxy?: boolean; providerSync?: boolean } = {}) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
        const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
        const req = http.request({ host: '127.0.0.1', port: address.port, path: route,
          method: body ? 'POST' : 'GET', localAddress: `127.0.0.${options.client || 1}`,
          signal: AbortSignal.timeout(6000), headers: {
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {}),
            ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
            ...(options.providerSync ? { 'x-drapixai-auth-sync-token': process.env.DRAPIXAI_AUTH_SYNC_TOKEN! } : {}),
            ...(options.proxy === false ? {} : { 'x-drapixai-dashboard-proxy-token': process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN! }),
          } }, res => {
          const chunks: Buffer[] = []; let bytes = 0;
          res.on('error', reject);
          res.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) res.destroy(new Error('FIXTURE_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
          res.on('end', () => { try { resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch { reject(new Error('FIXTURE_RESPONSE_NOT_JSON')); } });
        });
        req.on('error', reject); req.end(body);
      });
    const login = (email: string, password: string, client = 1) => request('/auth/login', { body: { email, password }, client });
    const original = 'A1!a'+'x'.repeat(68)+'Original';
    const prefix = original.slice(0,72);
    const signup = await issueVerificationCode(prisma, { email: emails[0], purpose: 'signup' });
    for (const invalid of [undefined, { ...termsAcceptance, accepted: false }, { ...termsAcceptance, documentHash: '0'.repeat(64) }]) {
      const denied = await request('/auth/register', { client: 5, body: { email: emails[0], password: original, otp: signup.code, termsAcceptance: invalid } });
      assert.equal(denied.status, 400);
      assert.equal(await prisma.user.count(), 0);
      assert.equal(await prisma.accountTermsAcceptance.count(), 0);
      assert.equal(await prisma.verificationCode.count({ where: { email: emails[0], consumedAt: null, attemptCount: 0 } }), 1);
    }
    const registered = await request('/auth/register', { body: { email: emails[0], password: original, otp: signup.code, companyName: 'Fixture A', termsAcceptance } });
    assert.equal(registered.status, 200, 'Real HTTP signup must succeed');
    let a = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.ok(a.passwordHash.startsWith('scrypt$v1$'));
    const signupRecord = await prisma.accountTermsAcceptance.findUniqueOrThrow({ where: { userId_documentVersion: { userId: a.id, documentVersion: CURRENT_TERMS.version } } });
    assert.equal(signupRecord.flow, 'password_signup'); assert.equal(signupRecord.documentHash, CURRENT_TERMS.documentHash);
    pass('HTTP signup rejects absent, declined and stale terms before OTP consumption and records affirmative acceptance with account creation');
    const good = await login(a.email, original); assert.equal(good.status,200);
    assert.equal((await login(a.email,prefix+'Other')).status,401);
    assert.equal((await login(a.email,prefix)).status,401);
    assert.match(String(good.headers['cache-control']),/no-store/);
    assert.equal(good.headers.pragma,'no-cache');
    assert.ok(!JSON.stringify(good.body).includes('passwordHash'));
    pass('HTTP full-input signup/login distinguishes long suffixes and preserves private response headers');

    const short = 'B2!b'+'b'.repeat(20);
    const b = await prisma.user.create({ data: { email: emails[1], passwordHash: await bcrypt.hash(short,4), emailVerifiedAt:new Date() } });
    const keyA = good.body.apiKey as string;
    assert.ok(typeof keyA === 'string' && keyA.length > 20);
    assert.equal((await request('/account/profile',{ key:keyA, proxy:false })).status,403);
    const profile = await request(`/account/profile?userId=${b.id}`,{key:keyA});
    assert.equal(profile.status,200); assert.equal(profile.body.email,a.email);
    const changed = await request('/account/profile',{key:keyA,body:{companyName:'Fixture A updated',userId:b.id,email:b.email,role:'system_admin',authVersion:0,passwordHash:'ignored-field',planType:'enterprise'}});
    assert.equal(changed.status,200);
    const afterProfile = await prisma.user.findUniqueOrThrow({where:{id:a.id}});
    assert.equal(afterProfile.role,a.role); assert.equal(afterProfile.email,a.email);
    assert.equal(afterProfile.authVersion,a.authVersion); assert.equal(afterProfile.passwordHash,a.passwordHash);
    assert.equal(afterProfile.planType,a.planType);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).companyName,null);
    pass('HTTP proxy authorization, tenant profile ownership and explicit-field updates prevent privilege mass assignment');

    await issueVerificationCode(prisma,{email:a.email,userId:a.id,purpose:'password_reset'});
    const next = 'C3!c'+'é'.repeat(40)+'New';
    assert.equal((await request('/account/password',{key:keyA,body:{currentPassword:original,newPassword:next}})).status,200);
    assert.equal((await request('/account/profile',{key:keyA})).status,401);
    assert.equal(await prisma.verificationCode.count({where:{userId:a.id,consumedAt:null}}),0);
    assert.equal((await login(a.email,original)).status,401);
    assert.equal((await login(a.email,next)).status,200);
    a = await prisma.user.findUniqueOrThrow({where:{id:a.id}});
    assert.equal((await verifyPassword(next,a.passwordHash)).matches,true);
    pass('HTTP password change revokes prior credentials and pending recovery codes while the new full input works');

    const legacy = await login(b.email,short,2); assert.equal(legacy.status,200);
    assert.equal(legacy.body.termsRequired, true);
    assert.equal((await request('/account/profile', { key: legacy.body.apiKey, client: 2 })).status, 401);
    const pending = await request('/auth/terms', { key: legacy.body.apiKey, client: 2 });
    assert.equal(pending.status, 200); assert.equal(pending.body.accepted, false);
    assert.equal((await request('/auth/terms', { key: legacy.body.apiKey, client: 2, proxy: false })).status, 403);
    assert.equal((await request('/auth/terms', { client: 2 })).status, 401);
    for (const body of [{ ...termsAcceptance, accepted: false }, { ...termsAcceptance, userId: a.id }, { ...termsAcceptance, version: 'old' }]) {
      assert.equal((await request('/auth/terms', { key: legacy.body.apiKey, client: 2, body })).status, 400);
      assert.equal(await prisma.accountTermsAcceptance.count({ where: { userId: b.id } }), 0);
    }
    assert.equal((await request('/auth/terms', { key: legacy.body.apiKey, client: 2, body: termsAcceptance })).status, 200);
    assert.equal((await request('/account/profile', { key: legacy.body.apiKey, client: 2 })).status, 200);
    const first = await prisma.accountTermsAcceptance.findUniqueOrThrow({ where: { userId_documentVersion: { userId: b.id, documentVersion: CURRENT_TERMS.version } } });
    assert.equal(first.flow, 'authenticated_account');
    assert.equal((await request('/auth/terms', { key: legacy.body.apiKey, client: 2, body: termsAcceptance })).status, 200);
    const repeat = await prisma.accountTermsAcceptance.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(repeat.acceptedAt.getTime(), first.acceptedAt.getTime());
    assert.equal((await request('/auth/terms', { key: legacy.body.apiKey, client: 2 })).body.accepted, true);
    assert.deepEqual(await prisma.accountTermsAcceptance.findUnique({ where: { id: signupRecord.id } }), signupRecord);
    pass('HTTP existing-account session cannot use services before explicit acceptance; forged fields and proxy bypass fail, retry preserves first evidence and the other tenant');
    const upgraded = await prisma.user.findUniqueOrThrow({where:{id:b.id}});
    assert.ok(upgraded.passwordHash.startsWith('scrypt$v1$'));
    assert.equal(upgraded.authVersion,b.authVersion);
    const boundary = await prisma.user.create({data:{email:emails[2],passwordHash:await bcrypt.hash(prefix+'Original',4),emailVerifiedAt:new Date()}});
    assert.equal((await login(boundary.email,prefix,3)).status,401);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:boundary.id}})).passwordHash,boundary.passwordHash);
    assert.equal(await prisma.apiKey.count({where:{userId:boundary.id}}),0);
    pass('HTTP legacy upgrade preserves version and ambiguous bcrypt boundaries cannot authenticate or migrate');

    const reset = await issueVerificationCode(prisma,{email:b.email,userId:b.id,purpose:'password_reset'});
    await issueVerificationCode(prisma,{email:b.email,userId:b.id,purpose:'email_change_current'});
    const recovered = 'D4!d'+'z'.repeat(68)+'Recovered';
    const payload = {email:b.email,otp:reset.code,password:recovered};
    assert.equal((await request('/auth/password-reset/confirm',{body:payload,client:2})).status,200);
    assert.equal((await request('/account/profile',{key:legacy.body.apiKey,client:2})).status,401);
    assert.equal((await request('/auth/password-reset/confirm',{body:payload,client:2})).status,400);
    assert.equal((await login(b.email,recovered,2)).status,200);
    assert.equal((await login(b.email,short,2)).status,401);
    assert.equal(await prisma.verificationCode.count({where:{userId:b.id,consumedAt:null}}),0);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).authVersion,b.authVersion+1);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).passwordHash,a.passwordHash);
    pass('HTTP verified recovery consumes OTP once, revokes old sessions and preserves the other tenant');

    // Exercise the protected provider-sync boundary, not a live Google login.
    const oauth = await request('/auth/oauth/google', { client: 6, providerSync: true,
      body: { email: emails[3], name: 'Synthetic Google identity', issueNewKey: true } });
    assert.equal(oauth.status, 200); assert.equal(oauth.body.termsRequired, true);
    const google = await prisma.user.findUniqueOrThrow({ where: { email: emails[3] } });
    assert.equal(await prisma.accountTermsAcceptance.count({ where: { userId: google.id } }), 0);
    assert.equal((await request('/account/profile', { key: oauth.body.apiKey, client: 6 })).status, 401);
    assert.equal((await request('/auth/terms', { key: oauth.body.apiKey, client: 6, body: termsAcceptance })).status, 200);
    assert.equal((await request('/account/profile', { key: oauth.body.apiKey, client: 6 })).status, 200);
    assert.equal((await request('/auth/logout', { key: oauth.body.apiKey, client: 6, body: {} })).status, 200);
    assert.equal((await request('/auth/terms', { key: oauth.body.apiKey, client: 6 })).status, 401);
    pass('HTTP protected Google sync never infers acceptance; explicit authenticated acceptance promotes the same credential and logout revokes it');

    const statuses: number[] = [];
    for (let i=0;i<6;i++) {
      const response = await login(`${marker}-unknown@example.invalid`,'E5!e'+ 'x'.repeat(20),4);
      statuses.push(response.status);
      if(i===5) assert.ok(Number(response.headers['retry-after'])>0);
    }
    assert.deepEqual(statuses,[401,401,401,401,401,429]);
    let expiring = 0;
    for await (const key of redis.scanIterator({MATCH:'drapixai:rate-limit:*',COUNT:100})) {
      assert.ok(await redis.pTTL(key)>0); expiring++;
    }
    assert.ok(expiring>0);
    pass('HTTP identity rate limit uses real expiring Redis counters and returns Retry-After');
    if (process.env.DRAPIXAI_TERMS_BROWSER_FIXTURE === 'I_ACKNOWLEDGE_DISPOSABLE_TERMS_BROWSER') {
      const email = `${marker}-browser@example.invalid`, password = 'F6!f-synthetic-browser-only-password';
      const { hashPassword } = await import('../lib/password-hash');
      const browserUser = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
      await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../../../../scripts/verify-account-terms-browser.mjs')], {
        cwd: path.resolve(__dirname, '../../../..'), timeout: 120000, windowsHide: true,
        env: { ...process.env, DRAPIXAI_TERMS_BROWSER_API_URL: `http://127.0.0.1:${address.port}`, DRAPIXAI_TERMS_BROWSER_EMAIL: email, DRAPIXAI_TERMS_BROWSER_PASSWORD: password },
      });
      const record = await prisma.accountTermsAcceptance.findUniqueOrThrow({ where: { userId_documentVersion: { userId: browserUser.id, documentVersion: CURRENT_TERMS.version } } });
      assert.equal(record.flow, 'authenticated_account'); assert.equal(record.documentHash, CURRENT_TERMS.documentHash);
      pass('Real production browser login, proxy gate and keyboard acceptance persist the exact revision in PostgreSQL');
    }
    console.log(JSON.stringify({passed:true,scope:'real production-mode auth/account routers over owned loopback HTTP, PostgreSQL and Redis; not full server, SMTP delivery, staging or inference',checks}));
  } finally {
    if(server){ server.closeAllConnections(); await new Promise<void>(resolve=>server!.close(()=>resolve())); }
    // Immutable assent is intentionally not deleted or weakened for cleanup.
    // The wrapper destroys its labelled disposable database after this process.
    if(redis.isOpen) await redis.disconnect();
    await prisma.$disconnect();
  }
};

// Routes own additional Redis/Prisma clients. This one-shot disposable process
// ends them after cleanup; it is never imported by the production server.
if(require.main === module) main().then(()=>process.exit(0),error=>{console.error(formatLogError(error));process.exit(1);});
