import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { emailFixtureBody, emailFixtureEnv, emailFixtureHeaders } from './email-event-tests';
import { mountEmailWebhook, createEmailWebhookRouter } from '../routes/email-webhooks';
import { getEmailDeliveryConfig, parseVerifiedEmailEvent } from '../lib/email-delivery-policy';
import { canSendTransactionalEmail, persistEmailDeliveryEvent, purgeExpiredEmailEvents } from '../services/email-delivery-events';
import { createEmailSender } from '../services/emailer';
import { closeRateLimitForTests } from '../lib/rate-limit';
import { renderOperationalMetrics } from '../lib/operational-metrics';

async function main() {
  assert.equal(process.env.DRAPIXAI_DISPOSABLE_DB_APPROVAL, 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE');
  assert.match(process.env.DRAPIXAI_EMAIL_FIXTURE_NONCE || '', /^[a-f0-9]{16}$/);
  const db = new URL(process.env.DATABASE_URL!);
  assert.equal(db.protocol, 'postgresql:'); assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.pathname, '/drapixai_email_test'); assert.equal(db.username, 'email_fixture_api');
  const cache = new URL(process.env.REDIS_URL!); assert.equal(cache.hostname, '127.0.0.1');
  Object.assign(process.env, emailFixtureEnv());
  const prisma = new PrismaClient(), fresh = new PrismaClient();
  const identity = await prisma.$queryRaw<Array<{ name: string; who: string; superuser: boolean }>>`SELECT current_database() AS name, current_user AS who, rolsuper AS superuser FROM pg_roles WHERE rolname=current_user`;
  assert.equal(identity[0].name, 'drapixai_email_test'); assert.equal(identity[0].who, 'email_fixture_api'); assert.equal(identity[0].superuser, false);
  let count = 0;
  const pass = (name: string) => { count++; console.log(`PASS ${name}`); };
  const app = express(); mountEmailWebhook(app, prisma);
  app.use('/failure', express.raw({ type: 'application/json', limit: 65536 }), createEmailWebhookRouter(async () => { throw Error('PRIVATE-DATABASE-ERROR'); }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const post = async (body: Buffer, headers = emailFixtureHeaders(body), extra: Record<string,string> = {}, route = '/email/webhooks/resend') => {
    const response = await fetch(origin + route, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers, ...extra }, signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const body = emailFixtureBody(), headers = emailFixtureHeaders(body);
    assert.equal((await post(Buffer.concat([body, Buffer.from(' ')]), headers)).status, 401);
    assert.equal((await post(body, { ...headers, 'svix-signature': 'v1,' + Buffer.alloc(32).toString('base64') })).status, 401);
    assert.equal(await prisma.emailDeliveryEvent.count(), 0);
    pass('Actual raw HTTP route rejects altered/signature-forged callbacks before any SQL write');
    assert.equal((await post(Buffer.alloc(70000))).status, 413);
    assert.equal((await post(zlib.gzipSync(body), headers, { 'Content-Encoding': 'gzip' })).status, 415);
    assert.equal((await post(body, headers, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal(await prisma.emailDeliveryEvent.count(), 0);
    pass('Bounded raw parser refuses oversized/compressed/wrong-content-type bodies without writes or raw error disclosure');
    const firstClaims = await Promise.all(Array.from({ length: 6 }, () => post(body, headers)));
    assert.ok(firstClaims.some(result => result.status === 200));
    for (const result of firstClaims) assert.ok([200,503].includes(result.status));
    assert.equal((await post(body, headers)).status, 200);
    assert.equal(await prisma.emailDeliveryEvent.count(), 1); assert.equal(await prisma.emailRecipientSuppression.count(), 1);
    const stored = JSON.stringify(await prisma.emailDeliveryEvent.findMany());
    for (const text of ['recipient@fixture.invalid','PRIVATE-OTP','PRIVATE-DIAGNOSTIC']) assert.ok(!stored.includes(text));
    pass('Verified permanent bounce atomically stores minimized event metadata and a hashed suppression under the restricted role');
    const replay = await post(body, headers); assert.equal(replay.status, 200); assert.equal(replay.body.duplicate, true);
    const replies = await Promise.all(Array.from({ length: 8 }, () => post(body, headers)));
    for (const result of replies) assert.ok([200,503].includes(result.status));
    assert.equal((await post(body, headers)).status, 200); assert.equal(await prisma.emailDeliveryEvent.count(), 1);
    pass('Repeated/concurrent retry delivery has one durable event and stable suppression');
    const altered = emailFixtureBody('email.bounced', { to: ['different@fixture.invalid'] });
    const conflict = await post(altered, emailFixtureHeaders(altered, headers['svix-id'])); assert.equal(conflict.status, 409);
    assert.equal(await prisma.emailDeliveryEvent.count(), 1);
    pass('A validly signed reused event ID with different bytes is a conflict, not a second side effect');

    const delivered = emailFixtureBody('email.delivered'); assert.equal((await post(delivered)).status, 200);
    assert.equal(await canSendTransactionalEmail(prisma, 'recipient@fixture.invalid'), false);
    const complaint = emailFixtureBody('email.complained'); assert.equal((await post(complaint)).status, 200);
    const lateBounce = emailFixtureBody(); assert.equal((await post(lateBounce)).status, 200);
    assert.equal((await prisma.emailRecipientSuppression.findFirstOrThrow()).reason, 'complaint');
    pass('Delivery and later/out-of-order bounce cannot clear a block or downgrade a complaint');
    let smtpCalls = 0;
    const sender = createEmailSender({
      createTransport: () => { smtpCalls++; return { sendMail: async () => ({ accepted: [], rejected: [] }) }; },
      writeLog: async () => ({ id: 1 }), canSend: recipient => canSendTransactionalEmail(fresh, recipient),
    });
    assert.equal((await sender(null, 'recipient@fixture.invalid', 'fixture', 'Subject', 'body')).error, 'EMAIL_RECIPIENT_SUPPRESSED'); assert.equal(smtpCalls, 0);
    pass('A fresh Prisma client and actual sender observe the durable block before constructing SMTP transport');

    const pending = emailFixtureBody('email.delivery_delayed', { to: ['temporary@fixture.invalid'], bounce: { type: 'Transient' } });
    assert.equal((await post(pending)).status, 200); assert.equal(await canSendTransactionalEmail(prisma, 'temporary@fixture.invalid'), true);
    const beforeIgnored = await prisma.emailDeliveryEvent.count();
    for (const ignored of [emailFixtureBody('email.opened'),emailFixtureBody('email.bounced',{from:'no-reply-staging@fixture.invalid'})]) assert.equal((await post(ignored)).body.ignored, true);
    assert.equal(await prisma.emailDeliveryEvent.count(), beforeIgnored);
    pass('Temporary delay stays sendable; tracking and other-environment sender callbacks have no persistence/suppression effect');

    const oldSecret = process.env.DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET;
    process.env.DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.DRAPIXAI_EMAIL_RECIPIENT_HASH_PREVIOUS_SECRETS = oldSecret;
    assert.equal(await canSendTransactionalEmail(fresh, 'recipient@fixture.invalid'), false);
    assert.equal((await post(body, headers)).body.duplicate, true);
    process.env.DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET = oldSecret; delete process.env.DRAPIXAI_EMAIL_RECIPIENT_HASH_PREVIOUS_SECRETS;
    pass('Key overlap preserves existing blocks and callback idempotency across a new digest key');
    const rollbackBody = emailFixtureBody('email.bounced',{to:['rollback@fixture.invalid']});
    const event = parseVerifiedEmailEvent(rollbackBody, 'msg_rollback', getEmailDeliveryConfig()!)!;
    await assert.rejects(persistEmailDeliveryEvent(prisma, { ...event, suppression: 'invalid' } as any));
    assert.equal(await prisma.emailDeliveryEvent.findUnique({ where: { webhookId: event.webhookId } }), null);
    pass('A real SQL suppression-constraint failure rolls back the event claim atomically');
    const unavailable = await post(emailFixtureBody(), undefined, {}, '/failure'); assert.equal(unavailable.status, 503); assert.ok(!JSON.stringify(unavailable.body).includes('PRIVATE'));
    pass('Persistence failure returns a sanitized retryable HTTP result rather than acknowledging an uncommitted event');

    const old = new Date(Date.now() - 40 * 86400000);
    await prisma.emailDeliveryEvent.create({ data: { ...Object.fromEntries(Object.entries(event).filter(([key]) => !['suppression','priorEventDigests'].includes(key))), webhookId: 'msg_expired', receivedAt: old } as any });
    assert.equal(await purgeExpiredEmailEvents(prisma), 1); assert.equal(await prisma.emailRecipientSuppression.count(), 1);
    await assert.rejects(prisma.$executeRaw`DELETE FROM "EmailRecipientSuppression" WHERE false`);
    await assert.rejects(prisma.emailRecipientSuppression.updateMany({ data: { recipientHash: '0'.repeat(64) } }));
    await assert.rejects(prisma.emailRecipientSuppression.updateMany({ data: { reason: 'hard_bounce', priority: 1 } }));
    assert.equal((await prisma.emailRecipientSuppression.findFirstOrThrow()).reason, 'complaint');
    pass('Bounded retention preserves suppression; SQL grants/trigger reject deletion, moving the recipient hash and complaint downgrade');
    const metrics = await renderOperationalMetrics(prisma, { lLen: async () => 0, zCard: async () => 0 });
    assert.match(metrics, /drapixai_email_complaints_recent 1/); assert.match(metrics, /drapixai_email_suppression_count 1/); assert.match(metrics, /drapixai_email_retention_overdue 0/);
    assert.ok(!metrics.includes('recipient@') && !metrics.includes(event.recipientHash) && !metrics.includes('PRIVATE'));
    pass('Persisted complaint/suppression/retention metrics survive a client boundary without recipient or payload labels');
    console.log(`Email event SQL/HTTP checks passed: ${count} groups. Disposable SQL/Redis, no SMTP or external provider.`);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await closeRateLimitForTests(); await prisma.$disconnect(); await fresh.$disconnect();
  }
}
main().catch(error => { console.error('EMAIL_EVENT_DATABASE_TEST_FAILED', error.message); process.exitCode = 1; });
