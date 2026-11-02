import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../lib/password-hash';
import { applyVerifiedPassword, issueApiKeyForUser, resolveActiveApiKey } from '../lib/api-key-auth';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { ensureAdminUser } from '../services/admin-bootstrap';
import { CURRENT_TERMS, recordAccountTermsAcceptance } from '../lib/account-terms';

// Only the existing guarded P0 fixture calls this. Every user/code/DDL object
// below belongs to this invocation; no merchant records or external targets.
export const verifyPasswordSessions = async (prisma: PrismaClient, ownedUsers: number[]) => {
  const url = new URL(requireDisposableDatabase(process.env));
  url.searchParams.set('connection_limit', '1');
  const replica = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const marker = `p0_pw_${crypto.randomBytes(6).toString('hex')}`;
  assert.match(marker, /^p0_pw_[a-f0-9]{12}$/);
  let userId: number | undefined, triggerCreated = false, functionCreated = false;
  const saved = { email: process.env.DRAPIXAI_ADMIN_EMAIL, password: process.env.DRAPIXAI_ADMIN_PASSWORD };
  try {
    const password = 'A1!a' + 'x'.repeat(32);
    const user = await prisma.user.create({ data: {
      email: `${marker}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), emailVerifiedAt: new Date(),
    } });
    userId = user.id; ownedUsers.push(user.id);
    // Explicit synthetic fixture choice, never inferred production acceptance.
    await prisma.$transaction(tx => recordAccountTermsAcceptance(tx, user.id,
      { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash }, 'authenticated_account'));
    const upgradedHash = await hashPassword(password);
    const key = await issueApiKeyForUser(prisma, user.id, { passwordProof: { snapshot: user, upgradedHash } });
    assert.ok(await resolveActiveApiKey(prisma, key));
    let current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(current.authVersion, user.authVersion, 'Format upgrade must not change credential version');
    assert.equal(current.passwordHash, upgradedHash);
    assert.equal((await verifyPassword(password, current.passwordHash)).matches, true);

    const other = await prisma.user.findUniqueOrThrow({ where: { id: ownedUsers[0] } });
    const otherCount = await prisma.apiKey.count({ where: { userId: other.id } });
    await assert.rejects(issueApiKeyForUser(prisma, other.id, { passwordProof: { snapshot: current } }), /PASSWORD_PROOF_USER_MISMATCH/);
    assert.equal(await prisma.apiKey.count({ where: { userId: other.id } }), otherCount);
    console.log('PASS real PostgreSQL password upgrade preserves authVersion and binds key issuance to the same user');

    for (const changed of ['role', 'email', 'emailVerifiedAt', 'authVersion'] as const) {
      const snapshot = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const activeBefore = await prisma.apiKey.count({ where: { userId: user.id, isActive: true } });
      const data = changed === 'role' ? { role: 'system_admin' }
        : changed === 'email' ? { email: `${marker}-changed@example.invalid` }
          : changed === 'emailVerifiedAt' ? { emailVerifiedAt: null }
            : { authVersion: { increment: 1 } };
      await prisma.user.update({ where: { id: user.id }, data });
      await assert.rejects(issueApiKeyForUser(replica, user.id, { passwordProof: { snapshot } }),
        (error: any) => error.code === 'P2025');
      assert.equal(await prisma.apiKey.count({ where: { userId: user.id, isActive: true } }), activeBefore);
      if (changed !== 'authVersion') await prisma.user.update({ where: { id: user.id }, data: {
        role: snapshot.role, email: snapshot.email, emailVerifiedAt: snapshot.emailVerifiedAt,
      } });
    }
    console.log('PASS real PostgreSQL changed role/email/verification/version rejects stale password proof without rotating existing keys');

    current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await prisma.verificationCode.create({ data: {
      userId: user.id, email: current.email, purpose: 'password_reset', codeHash: 'synthetic-not-a-code',
      expiresAt: new Date(Date.now()+600000),
    } });
    const nextHash = await hashPassword(password+'New');
    const [{ pid }] = await replica.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    let entered!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const reset = prisma.$transaction(async tx => {
      const now = new Date();
      await applyVerifiedPassword(tx, current, nextHash, true);
      entered(); await hold;
      await tx.apiKey.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false, revokedAt: now } });
      await tx.verificationCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
    }, { timeout: 15000, maxWait: 5000 }).then(() => ({ error: null as any }), error => ({ error }));
    const didLock = await Promise.race([locked.then(() => true), reset.then(result => {
      if (result.error) throw result.error; return false;
    })]);
    assert.equal(didLock, true);
    const stale = issueApiKeyForUser(replica, user.id, { passwordProof: { snapshot: current } })
      .then(value => ({ value, error: null as any }), error => ({ value: null, error }));
    let observed = false;
    try {
      const end = Date.now()+5000;
      while (Date.now() < end) {
        const rows = await prisma.$queryRaw<Array<{ wait_event_type: string | null }>>`
          SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
        if (rows[0]?.wait_event_type === 'Lock') { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { release(); }
    const resetResult = await reset, staleResult = await stale;
    assert.ifError(resetResult.error);
    assert.ok(observed, 'The issuer must actually wait for the concurrent reset row lock');
    assert.equal(staleResult.error?.code, 'P2025');
    assert.equal(await prisma.apiKey.count({ where: { userId: user.id, isActive: true } }), 0);
    assert.equal(await prisma.verificationCode.count({ where: { userId: user.id, consumedAt: null } }), 0);
    current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(current.passwordHash, nextHash); assert.equal(current.authVersion, user.authVersion+2);
    console.log('PASS real PostgreSQL observed reset/issuer lock race denies stale login and revokes keys and pending recovery codes');

    const valid = await issueApiKeyForUser(prisma, user.id, { passwordProof: { snapshot: current } });
    assert.ok(await resolveActiveApiKey(replica, valid), 'Fresh credentials remain usable after reset');
    // Deliberately fail only our tagged key insert, proving the actual DB
    // transaction rolls back its prior hash change and key revocations.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${marker}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.label = '${marker}' THEN RAISE EXCEPTION 'SYNTHETIC_PASSWORD_KEY_DENIAL'; END IF; RETURN NEW; END $$`);
    functionCreated = true;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${marker}" BEFORE INSERT ON "ApiKey" FOR EACH ROW EXECUTE FUNCTION "${marker}"()`);
    triggerCreated = true;
    const replacement = await hashPassword(password+'New');
    await assert.rejects(issueApiKeyForUser(prisma, user.id, {
      label: marker, passwordProof: { snapshot: current, upgradedHash: replacement },
    }), /SYNTHETIC_PASSWORD_KEY_DENIAL/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.passwordHash, current.passwordHash); assert.equal(after.authVersion, current.authVersion);
    assert.ok(await resolveActiveApiKey(prisma, valid), 'Failed key creation must not revoke the prior session');
    console.log('PASS real PostgreSQL key-insert failure rolls back the password replacement and prior-session revocation');

    process.env.DRAPIXAI_ADMIN_EMAIL = current.email;
    process.env.DRAPIXAI_ADMIN_PASSWORD = password+'New';
    await ensureAdminUser(prisma);
    let operator = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(operator.role, 'system_admin'); assert.equal(operator.authVersion, current.authVersion+1);
    assert.equal(await prisma.apiKey.count({ where: { userId: user.id, isActive: true } }),0);
    const session = await issueApiKeyForUser(prisma,user.id);
    await ensureAdminUser(prisma);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion,operator.authVersion);
    assert.ok(await resolveActiveApiKey(prisma,session),'An unchanged bootstrap must not log the operator out');
    process.env.DRAPIXAI_ADMIN_PASSWORD = '  '+password+'New  ';
    await prisma.verificationCode.create({data:{userId:user.id,email:operator.email,purpose:'password_reset',codeHash:'synthetic-not-a-code',expiresAt:new Date(Date.now()+600000)}});
    await ensureAdminUser(prisma);
    const rotated = await prisma.user.findUniqueOrThrow({where:{id:user.id}});
    assert.equal(rotated.authVersion,operator.authVersion+1);
    assert.equal((await verifyPassword(process.env.DRAPIXAI_ADMIN_PASSWORD,rotated.passwordHash)).matches,true);
    assert.equal((await verifyPassword(process.env.DRAPIXAI_ADMIN_PASSWORD.trim(),rotated.passwordHash)).matches,false);
    assert.equal(await resolveActiveApiKey(prisma,session),null);
    assert.equal(await prisma.verificationCode.count({where:{userId:user.id,consumedAt:null}}),0);
    console.log('PASS real PostgreSQL bootstrap promotion/rotation revokes credentials, preserves exact whitespace and keeps unchanged sessions');

    operator = await prisma.user.update({where:{id:user.id},data:{passwordHash:await bcrypt.hash(process.env.DRAPIXAI_ADMIN_PASSWORD,4)}});
    const legacySession = await issueApiKeyForUser(prisma,user.id);
    await ensureAdminUser(prisma);
    const reformatted = await prisma.user.findUniqueOrThrow({where:{id:user.id}});
    assert.ok(reformatted.passwordHash.startsWith('scrypt$v1$'));
    assert.equal(reformatted.authVersion,operator.authVersion);
    assert.ok(await resolveActiveApiKey(prisma,legacySession));
    console.log('PASS real PostgreSQL format-only bootstrap upgrade preserves credential version and existing sessions');
  } finally {
    if (triggerCreated) await prisma.$executeRawUnsafe(`DROP TRIGGER "${marker}" ON "ApiKey"`);
    if (functionCreated) await prisma.$executeRawUnsafe(`DROP FUNCTION "${marker}"()`);
    if (userId !== undefined) await prisma.verificationCode.deleteMany({ where: { userId } });
    await replica.$disconnect();
    if (saved.email === undefined) delete process.env.DRAPIXAI_ADMIN_EMAIL; else process.env.DRAPIXAI_ADMIN_EMAIL = saved.email;
    if (saved.password === undefined) delete process.env.DRAPIXAI_ADMIN_PASSWORD; else process.env.DRAPIXAI_ADMIN_PASSWORD = saved.password;
  }
};
