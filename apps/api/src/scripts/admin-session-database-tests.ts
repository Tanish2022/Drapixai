import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { consumeAdminTotp } from '../lib/admin-mfa';
import { generateApiKey, hashApiKey, resolveActiveApiKey, issueDashboardPreviewToken, resolveSdkApiKey } from '../lib/api-key-auth';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { CURRENT_TERMS, recordAccountTermsAcceptance } from '../lib/account-terms';

// Runs only inside the existing guarded P0 database fixture. The caller owns
// cleanup of these exact IDs and its disposable database. Immutable assent is
// retained until the owned database is destroyed; .env never grants approval.
export const verifyAdminSessions = async (prisma: PrismaClient, ownedUsers: number[]) => {
  const url = requireDisposableDatabase(process.env);
  const replica = new PrismaClient({ datasources: { db: { url } } });
  const saved = Object.fromEntries(['NODE_ENV', 'DRAPIXAI_ADMIN_EMAIL', 'DRAPIXAI_ADMIN_TOTP_SECRET', 'JWT_SECRET'].map((name) => [name, process.env[name]]));
  try {
    const admin = await prisma.user.create({ data: {
      email: `p0-admin-${crypto.randomUUID()}@example.invalid`, passwordHash: 'synthetic-not-a-login', role: 'system_admin', emailVerifiedAt: new Date(),
    } });
    ownedUsers.push(admin.id);
    process.env.NODE_ENV = 'production';
    process.env.DRAPIXAI_ADMIN_EMAIL = admin.email;
    // Public RFC 6238 test vector, never an operator authenticator.
    process.env.DRAPIXAI_ADMIN_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

    const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => consumeAdminTotp(index % 2 ? prisma : replica, admin, '287082', 59000)));
    assert.equal(claims.filter(Boolean).length, 1, 'Only one replica may consume a TOTP step');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).adminTotpLastCounter, 1n);
    await replica.$disconnect();
    assert.equal(await consumeAdminTotp(replica, admin, '287082', 59000), false, 'Reconnecting cannot reset replay state');
    assert.equal(await consumeAdminTotp(prisma, admin, '755224', 59000), false, 'An earlier valid step is not reusable');
    assert.equal(await consumeAdminTotp(prisma, admin, '000000', 59000), false);
    assert.equal(await consumeAdminTotp(replica, admin, '359152', 59000), true, 'A fresh allowed step remains usable');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'brand_admin' } });
    assert.equal(await consumeAdminTotp(replica, admin, '969429', 90000), false, 'Changed role invalidates the captured identity');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'system_admin' } });
    assert.equal(await consumeAdminTotp(prisma, admin, '969429', 90000), true);
    await assert.rejects(prisma.user.update({ where: { id: admin.id }, data: { adminTotpLastCounter: -1n } }));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).adminTotpLastCounter, 3n);
    const merchant = await prisma.user.findUniqueOrThrow({ where: { id: ownedUsers[0] } });
    assert.equal(await consumeAdminTotp(prisma, merchant, '', 59000), true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: merchant.id } })).adminTotpLastCounter, null);
    console.log('PASS real PostgreSQL TOTP: one of 12 replica claims, durable reconnect, old/invalid step rejection, next-step success, role change, constraint and merchant isolation');

    const now = Date.now();
    type KeyOverrides = Partial<Pick<Prisma.ApiKeyUncheckedCreateInput, 'kind' | 'scopes' | 'createdAt' | 'lastUsedAt' | 'expiresAt'>>;
    const makeKey = async (overrides: KeyOverrides = {}) => {
      const credential = generateApiKey();
      const key = await prisma.apiKey.create({ data: {
        userId: admin.id, keyHash: hashApiKey(credential), domainWhitelist: '*', kind: 'dashboard', scopes: 'dashboard,admin:mfa',
        createdAt: new Date(now - 3600000), lastUsedAt: new Date(now - 60000), expiresAt: new Date(now + 3600000),
        ...overrides,
      } });
      return { key, credential };
    };
    const recent = await makeKey();
    assert.equal(await resolveActiveApiKey(prisma, recent.credential), null, 'A valid MFA credential without assent must not authorize service use');
    assert.equal(await resolveActiveApiKey(replica, recent.credential), null);
    await prisma.$transaction(tx => recordAccountTermsAcceptance(tx, admin.id,
      { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash }, 'authenticated_account'));
    const before = new Date();
    assert.ok(await resolveActiveApiKey(prisma, recent.credential));
    assert.ok((await prisma.apiKey.findUniqueOrThrow({ where: { id: recent.key.id } })).lastUsedAt! >= before);
    assert.ok(await resolveActiveApiKey(replica, recent.credential));
    for (const overrides of [
      { lastUsedAt: new Date(now - 16 * 60000) },
      { createdAt: new Date(now - 16 * 60000), lastUsedAt: null },
      { createdAt: new Date(now - 9 * 3600000), lastUsedAt: new Date(now) },
    ]) {
      const expired = await makeKey(overrides);
      assert.equal(await resolveActiveApiKey(prisma, expired.credential), null);
      assert.equal(await resolveActiveApiKey(replica, expired.credential), null);
      assert.deepEqual((await prisma.apiKey.findUniqueOrThrow({ where: { id: expired.key.id } })).lastUsedAt, expired.key.lastUsedAt);
      const token = issueDashboardPreviewToken({ apiKeyId: expired.key.id, userId: admin.id, allowedDomain: 'preview.example.invalid' });
      assert.equal(await resolveSdkApiKey(replica, token), null);
    }
    const current = await prisma.apiKey.findUniqueOrThrow({ where: { id: recent.key.id } });
    const preview = issueDashboardPreviewToken({ apiKeyId: current.id, userId: admin.id, allowedDomain: 'preview.example.invalid' });
    assert.ok(await resolveSdkApiKey(replica, preview));
    assert.deepEqual((await prisma.apiKey.findUniqueOrThrow({ where: { id: current.id } })).lastUsedAt, current.lastUsedAt);
    const firstUse = await makeKey({ createdAt: new Date(now - 60000), lastUsedAt: null });
    assert.ok(await resolveActiveApiKey(prisma, firstUse.credential));
    for (const kind of ['manual', 'dashboard']) {
      const normal = await makeKey({ kind, scopes: kind === 'manual' ? 'api:tryon' : 'dashboard', createdAt: new Date(now - 86400000), lastUsedAt: new Date(now - 86400000) });
      assert.ok(await resolveActiveApiKey(replica, normal.credential));
    }
    console.log('PASS real PostgreSQL privileged idle/absolute expiry, no revival, first use, preview non-extension and unchanged ordinary key lifetimes');

    const revoked = await makeKey();
    const interleaved = { accountTermsAcceptance: prisma.accountTermsAcceptance, apiKey: {
      findUnique: async (args: any) => {
        const snapshot = await prisma.apiKey.findUnique(args);
        await replica.apiKey.update({ where: { id: revoked.key.id }, data: { isActive: false, revokedAt: new Date() } });
        return snapshot;
      },
      update: prisma.apiKey.update.bind(prisma.apiKey),
      updateMany: prisma.apiKey.updateMany.bind(prisma.apiKey),
    } } as unknown as PrismaClient;
    assert.equal(await resolveActiveApiKey(interleaved, revoked.credential), null, 'Real revocation between read and touch must win');
    console.log('PASS real PostgreSQL revocation interleaving rejects the stale privileged snapshot');
  } finally {
    await replica.$disconnect();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
};
