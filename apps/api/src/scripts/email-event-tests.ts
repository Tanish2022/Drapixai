import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EmailEventError, getEmailDeliveryConfig, parseVerifiedEmailEvent, recipientDigests, verifyEmailWebhookSignature } from '../lib/email-delivery-policy';
import { createEmailSender } from '../services/emailer';

const syntheticKey = Buffer.alloc(24, 17);
export const emailFixtureEnv = () => ({
  NODE_ENV: 'test', SMTP_HOST: 'smtp.resend.com', SMTP_PORT: '587', SMTP_USER: 'resend', SMTP_PASS: 'synthetic-smtp-password',
  SMTP_FROM: 'Synthetic <sender@fixture.invalid>', DRAPIXAI_EMAIL_EVENTS_ENABLED: '1',
  DRAPIXAI_EMAIL_EVENT_SENDERS: 'sender@fixture.invalid',
  DRAPIXAI_RESEND_WEBHOOK_SECRET: `whsec_${syntheticKey.toString('base64')}`,
  DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET: crypto.randomBytes(32).toString('hex'),
});
export const emailFixtureBody = (type = 'email.bounced', changes: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  type, created_at: new Date().toISOString(), data: {
    email_id: crypto.randomUUID(), from: 'Synthetic <sender@fixture.invalid>', to: ['recipient@fixture.invalid'],
    subject: 'PRIVATE-OTP-123456', bounce: { type: 'Permanent', message: 'PRIVATE-DIAGNOSTIC' }, ...changes,
  },
}));
export const emailFixtureHeaders = (body: Buffer, id = `msg_${crypto.randomBytes(12).toString('hex')}`, key = syntheticKey, timestamp = String(Math.floor(Date.now() / 1000))) => ({
  'svix-id': id, 'svix-timestamp': timestamp,
  'svix-signature': 'v1,' + crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body])).digest('base64'),
});

async function main() {
  let cases = 0;
  const pass = (message: string) => { cases++; console.log(`PASS ${message}`); };
  const env = emailFixtureEnv(), config = getEmailDeliveryConfig(env)!;
  assert.equal(getEmailDeliveryConfig({}), null);
  for (const change of [
    { DRAPIXAI_EMAIL_EVENTS_ENABLED: 'true' }, { DRAPIXAI_RESEND_WEBHOOK_SECRET: 'bad' },
    { DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET: 'short' }, { DRAPIXAI_EMAIL_EVENT_SENDERS: 'someone@else.invalid' },
    { DRAPIXAI_EMAIL_EVENT_SENDERS: 'sender@fixture.invalid,invalid' },
  ]) assert.throws(() => getEmailDeliveryConfig({ ...env, ...change }), /EMAIL_EVENT_CONFIG_INVALID/);
  pass('Disabled-by-default callback requires valid isolated keys and an explicit matching sender before activation');

  // Fixed public interoperability vector from Svix's manual-verification docs.
  const publicVector = { ...config, signingKeys: [Buffer.from('plJ3nmyCDGBKInavdOK15jsl', 'base64')] };
  assert.equal(verifyEmailWebhookSignature(Buffer.from('{"event_type":"ping","data":{"success":true}}'), {
    'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121',
    'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
  }, publicVector, 1731705121000), 'msg_loFOjxBNrRLzqYUf');
  pass('Manual signature verification matches the independent published Svix interoperability vector');
  const body = emailFixtureBody(), headers = emailFixtureHeaders(body);
  assert.equal(verifyEmailWebhookSignature(body, headers, config), headers['svix-id']);
  for (const [raw, supplied] of [
    [Buffer.concat([body, Buffer.from(' ')]), headers],
    [body, { ...headers, 'svix-id': 'another' }],
    [body, { ...headers, 'svix-signature': 'v1,' + Buffer.alloc(32).toString('base64') }],
    [body, { ...headers, 'svix-timestamp': String(Math.floor(Date.now()/1000)-301) }],
    [body, { ...headers, 'svix-timestamp': String(Math.floor(Date.now()/1000)+301) }],
    [body, { ...headers, 'svix-timestamp': ['1','2'] }],
    [Buffer.alloc(65537), headers],
  ] as const) assert.throws(() => verifyEmailWebhookSignature(raw, supplied as any, config), EmailEventError);
  pass('Altered bytes/identity, stale/future/duplicate headers, oversized payloads and wrong signatures fail verification');
  const oldKey = Buffer.alloc(24, 31);
  const rotated = getEmailDeliveryConfig({ ...env, DRAPIXAI_RESEND_WEBHOOK_PREVIOUS_SECRETS: 'whsec_' + oldKey.toString('base64') })!;
  const oldHeaders = emailFixtureHeaders(body, headers['svix-id'], oldKey);
  assert.equal(verifyEmailWebhookSignature(body, { ...oldHeaders, 'svix-signature': `v2,ignored ${oldHeaders['svix-signature']} ${headers['svix-signature']}` }, rotated), headers['svix-id']);
  pass('Bounded signing-key overlap and multiple versioned signatures preserve verified delivery');

  const event = parseVerifiedEmailEvent(body, headers['svix-id'], config)!;
  assert.equal(event.suppression, 'hard_bounce');
  const minimized = JSON.stringify(event);
  for (const sensitive of ['recipient@fixture.invalid', 'PRIVATE-OTP', 'PRIVATE-DIAGNOSTIC', env.DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET]) assert.ok(!minimized.includes(sensitive));
  assert.notEqual(event.eventDigest, crypto.createHash('sha256').update(body).digest('hex'));
  pass('Persistence data omits recipient, subject, OTP, diagnostics and raw body; recipient/body bindings use keyed digests');
  for (const type of ['email.sent','email.delivered','email.delivery_delayed','email.failed']) assert.equal(parseVerifiedEmailEvent(emailFixtureBody(type), 'msg_fixture', config)!.suppression, null);
  for (const type of ['Transient','Undetermined']) assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.bounced', { bounce: { type } }), 'msg_fixture', config)!.suppression, null);
  assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.complained'), 'msg_fixture', config)!.suppression, 'complaint');
  assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.suppressed', { suppressed: { reason: 'previous_complaint' } }), 'msg_fixture', config)!.suppression, 'complaint');
  assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.suppressed', { suppressed: { reason: 'previous_bounce' } }), 'msg_fixture', config)!.suppression, 'hard_bounce');
  pass('Confirmed permanent bounces/complaints suppress; temporary or operational failures do not become permanent blocks');
  assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.opened'), 'msg_fixture', config), null);
  assert.equal(parseVerifiedEmailEvent(emailFixtureBody('email.bounced', { from: 'staging@fixture.invalid' }), 'msg_fixture', config), null);
  for (const change of [{ to: ['one@fixture.invalid','two@fixture.invalid'] },{ to: ['bad,name@fixture.invalid'] },{ to: ['bad\0name@fixture.invalid'] },{ email_id: 'bad' }]) assert.throws(() => parseVerifiedEmailEvent(emailFixtureBody('email.bounced', change), 'msg_fixture', config));
  assert.throws(() => parseVerifiedEmailEvent(Buffer.from([0xff]), 'msg_fixture', config));
  pass('Tracking and unrelated senders are ignored; malformed UTF-8, ambiguous recipients and malformed provider IDs are rejected');
  const oldHash = config.hashKeys[0];
  const newConfig = getEmailDeliveryConfig({ ...env, DRAPIXAI_EMAIL_RECIPIENT_HASH_SECRET: crypto.randomBytes(32).toString('hex'), DRAPIXAI_EMAIL_RECIPIENT_HASH_PREVIOUS_SECRETS: oldHash })!;
  assert.ok(recipientDigests('recipient@fixture.invalid', newConfig).includes(event.recipientHash));
  assert.ok(parseVerifiedEmailEvent(body, headers['svix-id'], newConfig)!.priorEventDigests.includes(event.eventDigest));
  pass('Recipient-key overlap retains old suppression lookup and same-event replay binding');

  const saved = { ...process.env };
  try {
    Object.assign(process.env, env);
    let sends = 0;
    const base = { createTransport: () => ({ sendMail: async () => { sends++; return { accepted: ['recipient@fixture.invalid'], rejected: [] }; } }), writeLog: async () => ({ id: 1 }) };
    const blocked = createEmailSender({ ...base, canSend: async () => false });
    assert.equal((await blocked(null, 'recipient@fixture.invalid', 'fixture', 'Subject', 'body')).error, 'EMAIL_RECIPIENT_SUPPRESSED');
    const unavailable = createEmailSender({ ...base, canSend: async () => { throw Error('PRIVATE-DATABASE-DETAILS'); } });
    assert.equal((await unavailable(null, 'recipient@fixture.invalid', 'fixture', 'Subject', 'body')).error, 'EMAIL_SUPPRESSION_CHECK_UNAVAILABLE');
    const missing = createEmailSender(base);
    assert.equal((await missing(null, 'recipient@fixture.invalid', 'fixture', 'Subject', 'body')).error, 'EMAIL_SUPPRESSION_CHECK_UNAVAILABLE');
    assert.equal(sends, 0);
    assert.equal((await blocked(null, 'bad\0name@fixture.invalid', 'fixture', 'Subject', 'body')).error, 'EMAIL_RECIPIENT_INVALID');
    const accepted = createEmailSender({ ...base, canSend: async () => true });
    assert.equal((await accepted(null, 'recipient@fixture.invalid', 'fixture', 'Subject', 'body')).sent, true); assert.equal(sends, 1);
    pass('Actual sender blocks before SMTP on suppression or guard failure, and permits one checked synthetic acceptance');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  console.log(`Email event policy checks passed: ${cases} groups. No network, email or live database.`);
}
if (require.main === module) main().catch(error => { console.error('EMAIL_EVENT_POLICY_TEST_FAILED', error.message); process.exitCode = 1; });
