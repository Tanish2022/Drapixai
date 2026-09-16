import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createVerifiedStorefrontOriginCache } from '../lib/cors-origin-cache';
import { verifySecurityAuditChain } from '../lib/audit-log';
import { runTryOnReviewRetention } from '../services/review-retention';

const prisma = new PrismaClient();

async function main() {
  const target = new URL(process.env.DATABASE_URL || 'http://missing.invalid');
  const databaseName = target.pathname.slice(1);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
    || !(/(?:^|[_-])(p0|test|disposable)(?:$|[_-])/i.test(databaseName) || databaseName === 'drapixai_launch_gate')
    || process.env.DRAPIXAI_DISPOSABLE_DB_APPROVAL !== 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE') {
    throw new Error('P0 database tests require an explicitly approved loopback disposable database');
  }
  // Retention scans globally: never run this fixture suite over existing media.
  assert.equal(await prisma.tryOnResult.count(), 0, 'Disposable database must contain no try-on results');
  const initialAudit = await verifySecurityAuditChain(prisma);
  assert.ok(initialAudit.valid, 'Audit chain must be valid before the test');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-p0-db-'));
  const previousUploadRoot = process.env.DRAPIXAI_UPLOAD_DIR;
  process.env.DRAPIXAI_UPLOAD_DIR = path.join(directory, 'uploads');
  const userIds: number[] = [];
  const marker = crypto.randomUUID();
  try {
    for (const verified of [true, false]) {
      const user = await prisma.user.create({ data: {
        email: `p0-db-${marker}-${verified}@example.invalid`,
        passwordHash: 'synthetic-not-a-login',
        storeVerifiedAt: verified ? new Date() : null,
      } });
      userIds.push(user.id);
    }
    const cases = [
      { domain: 'verified.example.invalid', userId: userIds[0], kind: 'manual', active: true, allowed: true },
      { domain: 'revoked.example.invalid', userId: userIds[0], kind: 'manual', active: false, allowed: false },
      { domain: 'dashboard.example.invalid', userId: userIds[0], kind: 'dashboard', active: true, allowed: false },
      { domain: 'unverified.example.invalid', userId: userIds[1], kind: 'manual', active: true, allowed: false },
      { domain: '', userId: userIds[0], kind: 'manual', active: true, allowed: false },
    ];
    for (const entry of cases) {
      await prisma.apiKey.create({ data: {
        userId: entry.userId, kind: entry.kind, isActive: entry.active,
        domainWhitelist: entry.domain,
        keyHash: crypto.createHash('sha256').update(`${marker}:${entry.domain}`).digest('hex'),
      } });
    }
    const cache = createVerifiedStorefrontOriginCache(prisma, { shopifyEnabled: false });
    for (const entry of cases.filter((entry) => entry.domain)) {
      assert.equal(await cache.allows(`https://${entry.domain}`), entry.allowed, entry.domain);
    }
    assert.equal(await cache.allows('https://attacker.example.invalid'), false);
    await prisma.apiKey.updateMany({ where: { userId: userIds[0], domainWhitelist: cases[0].domain }, data: { isActive: false } });
    cache.invalidate();
    assert.equal(await cache.allows(`https://${cases[0].domain}`), false, 'Revocation must take effect after cache refresh');
    console.log('PASS real Prisma CORS query, verified origins, rejected origins and revocation refresh');

    const reviewDirectory = path.join(process.env.DRAPIXAI_UPLOAD_DIR, 'tryon-review');
    fs.mkdirSync(reviewDirectory, { recursive: true });
    const person = path.join(reviewDirectory, 'synthetic-person.txt');
    const result = path.join(reviewDirectory, 'synthetic-result.txt');
    const recentFile = path.join(reviewDirectory, 'recent.txt');
    for (const file of [person, result, recentFile]) fs.writeFileSync(file, 'SYNTHETIC');
    const expired = await prisma.tryOnResult.create({ data: {
      userId: userIds[0], engine: 'synthetic-test', createdAt: new Date(0),
      personImageUrl: `local:${person}`, resultImageUrl: `local:${result}`,
    } });
    const recent = await prisma.tryOnResult.create({ data: {
      userId: userIds[0], engine: 'synthetic-test', personImageUrl: `local:${recentFile}`,
    } });
    const options = { retentionDays: 1, batchSize: 100 };
    const dry = await runTryOnReviewRetention(prisma, { ...options, dryRun: true });
    assert.equal(dry.scanned, 1);
    assert.ok(fs.existsSync(person) && fs.existsSync(result));
    assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: expired.id } })).personImageUrl, `local:${person}`);
    const deleted = await runTryOnReviewRetention(prisma, options);
    assert.equal(deleted.imagesDeleted, 2);
    assert.equal(deleted.rowsUpdated, 1);
    assert.deepEqual(deleted.failures, []);
    assert.ok(!fs.existsSync(person) && !fs.existsSync(result));
    const cleared = await prisma.tryOnResult.findUniqueOrThrow({ where: { id: expired.id } });
    assert.equal(cleared.personImageUrl, null);
    assert.equal(cleared.resultImageUrl, null);
    assert.ok(fs.existsSync(recentFile));
    assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: recent.id } })).personImageUrl, `local:${recentFile}`);

    // Model a crash between physical deletion and the database URL update.
    await prisma.tryOnResult.update({ where: { id: expired.id }, data: { personImageUrl: `local:${person}` } });
    const retry = await runTryOnReviewRetention(prisma, options);
    assert.deepEqual(retry.failures, []);
    assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: expired.id } })).personImageUrl, null);
    console.log('PASS retention dry-run, deletion, URL clearing, recent media protection and crash recovery');

    // Unsafe locations and real deletion errors must keep the reference for review/retry.
    const outside = path.join(directory, 'outside-upload-root.txt');
    const wrongPrefix = path.join(process.env.DRAPIXAI_UPLOAD_DIR, 'merchant-owned.txt');
    const notAFile = path.join(reviewDirectory, 'not-a-file');
    fs.mkdirSync(notAFile);
    for (const file of [outside, wrongPrefix]) fs.writeFileSync(file, 'PRESERVE');
    for (const rejected of [outside, wrongPrefix, notAFile]) {
      await prisma.tryOnResult.update({ where: { id: expired.id }, data: { personImageUrl: `local:${rejected}` } });
      const failed = await runTryOnReviewRetention(prisma, options);
      assert.equal(failed.failures.length, 1);
      assert.equal(failed.rowsUpdated, 0);
      assert.ok(fs.existsSync(rejected));
      assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: expired.id } })).personImageUrl, `local:${rejected}`);
    }
    const chain = await verifySecurityAuditChain(prisma);
    assert.ok(chain.valid);
    assert.ok(chain.checked >= initialAudit.checked + 5);
    console.log('PASS retention path boundaries, failed deletion reference preservation and non-empty audit chain');
  } finally {
    if (userIds.length) {
      await prisma.tryOnResult.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.apiKey.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (previousUploadRoot === undefined) delete process.env.DRAPIXAI_UPLOAD_DIR;
    else process.env.DRAPIXAI_UPLOAD_DIR = previousUploadRoot;
    // Only this test's unique mkdtemp directory contains these synthetic fixtures.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'P0 database tests failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
