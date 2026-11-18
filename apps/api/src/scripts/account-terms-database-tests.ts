import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { requireDisposableDatabase } from '../lib/disposable-database';
import { CURRENT_TERMS, hasCurrentAccountTerms, recordAccountTermsAcceptance } from '../lib/account-terms';

async function main() {
  requireDisposableDatabase(process.env);
  assert.equal(process.env.DRAPIXAI_TERMS_FIXTURE_APPROVAL, 'I_ACKNOWLEDGE_DISPOSABLE_TERMS_FIXTURE');
  const prisma = new PrismaClient();
  const checks: string[] = [];
  try {
    assert.equal(await prisma.user.count(), 0, 'Use a new empty disposable database');
    assert.equal(await prisma.termsDocument.count(), 0);
    const a = await prisma.user.create({ data: { email: 'terms-a@example.invalid', passwordHash: 'synthetic-fixture-only' } });
    const b = await prisma.user.create({ data: { email: 'terms-b@example.invalid', passwordHash: 'synthetic-fixture-only' } });
    const input = { accepted: true, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash };
    assert.equal(await hasCurrentAccountTerms(prisma, a.id), false);
    assert.equal(await hasCurrentAccountTerms(prisma, b.id), false);
    checks.push('Existing synthetic accounts have no inferred acceptance');

    await assert.rejects(prisma.$transaction(async tx => {
      await recordAccountTermsAcceptance(tx, a.id, { ...input, accepted: false }, 'password_signup');
    }), /TERMS_ACCEPTANCE_REQUIRED/);
    assert.equal(await prisma.accountTermsAcceptance.count(), 0);
    assert.equal(await prisma.termsDocument.count(), 0);
    checks.push('Missing affirmative choice writes no document or acceptance');

    const conflicting = JSON.stringify({ kind: 'terms', version: CURRENT_TERMS.version, sections: ['unexpected replacement'] });
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.termsDocument.create({ data: { version: CURRENT_TERMS.version, sha256: crypto.createHash('sha256').update(conflicting).digest('hex'), content: conflicting } });
      await recordAccountTermsAcceptance(tx, a.id, input, 'password_signup');
    }), /TERMS_ARCHIVE_MISMATCH/);
    assert.equal(await prisma.termsDocument.count(), 0);
    checks.push('A conflicting stored version fails closed and rolls back');

    await assert.rejects(prisma.$transaction(async tx => {
      await recordAccountTermsAcceptance(tx, a.id, input, 'password_signup');
      throw new Error('SYNTHETIC_ACCOUNT_TRANSACTION_FAILURE');
    }), /SYNTHETIC_ACCOUNT_TRANSACTION_FAILURE/);
    assert.equal(await prisma.accountTermsAcceptance.count(), 0);
    assert.equal(await prisma.termsDocument.count(), 0);
    checks.push('Acceptance and archive roll back with their surrounding transaction');

    const before = Date.now();
    const first = await prisma.$transaction(tx => recordAccountTermsAcceptance(tx, a.id, input, 'password_signup'));
    assert.ok(Math.abs(first.acceptedAt.getTime() - before) < 10_000);
    assert.equal(await hasCurrentAccountTerms(prisma, a.id), true);
    assert.equal(await hasCurrentAccountTerms(prisma, b.id), false);
    const stored = await prisma.termsDocument.findUniqueOrThrow({ where: { version: CURRENT_TERMS.version } });
    assert.equal(stored.content, CURRENT_TERMS.content);
    assert.equal(stored.sha256, CURRENT_TERMS.documentHash);
    checks.push('Real Prisma transaction retains exact text/hash and binds acceptance to one account');

    const repeat = await prisma.$transaction(tx => recordAccountTermsAcceptance(tx, a.id, input, 'authenticated_account'));
    assert.equal(repeat.id, first.id);
    assert.equal(repeat.acceptedAt.getTime(), first.acceptedAt.getTime());
    assert.equal(repeat.flow, 'password_signup');
    assert.equal(await prisma.accountTermsAcceptance.count(), 1);
    checks.push('Idempotent ORM retry preserves original time and flow under immutable triggers');

    await prisma.$transaction(tx => recordAccountTermsAcceptance(tx, b.id, input, 'authenticated_account'));
    assert.equal(await prisma.accountTermsAcceptance.count(), 2);
    assert.equal(await prisma.termsDocument.count(), 1);
    checks.push('Independent account acceptance reuses the immutable document without rewriting it');
    console.log(JSON.stringify({ passed: true, checks, scope: 'actual Prisma acceptance helpers and transactions in an owned disposable PostgreSQL database; not live signup/OAuth or staging' }));
  } finally { await prisma.$disconnect(); }
}

void main().catch(error => {
  // Never print a Prisma connection URL or credentials, even on fixture failure.
  console.error(String(error?.message || 'TERMS_DATABASE_FIXTURE_FAILED').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]'));
  process.exitCode = 1;
});
