import assert from 'node:assert/strict';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { createEmailSender, getSmtpTransportOptions } from '../services/emailer';
import { verifyEmailFailureRoutes } from './email-route-failure-tests';
import { verifyStagingSmtp } from './verify-staging-smtp';
import { buildStagingEmailTests, STAGING_EMAIL_TEST_RECIPIENT } from './send-staging-email-tests';

const names = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_REPLY_TO', 'EMAIL_SUPPORT_ADDRESS', 'DRAPIXAI_EMAIL_EVENTS_ENABLED'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const setFixtureEnv = () => {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_USER: 'synthetic', SMTP_PASS: 'not-a-real-key', DRAPIXAI_EMAIL_EVENTS_ENABLED: '0' });
};
let cases = 0;
const passed = (name: string) => { cases++; console.log(`PASS ${name}`); };
const to = 'recipient@example.invalid';
const main = async () => {
  setFixtureEnv();
  const starttls = getSmtpTransportOptions();
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);
  assert.equal(starttls.tls.rejectUnauthorized, true);
  assert.equal(starttls.tls.minVersion, 'TLSv1.2');
  assert.equal(starttls.debug, false);
  assert.equal(starttls.logger, false);
  assert.equal(starttls.disableUrlAccess, true);
  assert.equal(starttls.disableFileAccess, true);
  assert.ok(starttls.socketTimeout <= 20_000);
  passed('STARTTLS is mandatory, certificates are verified, content logging and external content loading are disabled');
  for (const port of ['465', '2465']) {
    assert.equal(getSmtpTransportOptions({ ...process.env, SMTP_PORT: port, SMTP_SECURE: undefined }).secure, true);
  }
  passed('implicit TLS is inferred for the Resend SMTPS ports');
  for (const change of [
    { SMTP_PORT: 'abc' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' }, { SMTP_PORT: '1.5' },
    { SMTP_PORT: '465', SMTP_SECURE: '0' }, { SMTP_PORT: '587', SMTP_SECURE: '1' },
    { SMTP_SECURE: 'false' }, { SMTP_USER: '' }, { SMTP_PASS: '' },
  ]) assert.throws(() => getSmtpTransportOptions({ ...process.env, ...change }), /SMTP_CONFIGURATION_INVALID/);
  passed('invalid transport configuration cannot initiate a send');

  const messages: any[] = [], logs: any[] = [];
  let sends = 0, mode = 'accepted', logFails = false;
  const sender = createEmailSender({
    createTransport: () => ({ sendMail: async message => {
      sends++; messages.push(message);
      if (mode === 'auth') throw { code: 'EAUTH', message: 'not-a-real-key 123456 PRIVATE CONTENT' };
      if (mode === 'unknownError') throw { code: 'not-a-real-key', name: '123456 PRIVATE CONTENT' };
      if (mode === 'timeout') throw { code: 'ETIMEDOUT' };
      if (mode === 'rejected') return { accepted: [], rejected: [to] };
      if (mode === 'otherRecipient') return { accepted: ['someone-else@example.invalid'], rejected: [] };
      if (mode === 'missingReceipt') return undefined;
      return { accepted: [to], rejected: [] };
    } }),
    writeLog: async data => {
      logs.push(data);
      if (logFails) throw new Error('private-database-url');
      return { id: logs.length };
    },
  });
  delete process.env.SMTP_HOST;
  assert.deepEqual(await sender(42, to, 'test', 'Subject', '123456'), { sent: false, skipped: true, error: 'SMTP_HOST_NOT_CONFIGURED' });
  assert.equal(sends, 0); assert.equal(logs.length, 0);
  passed('unconfigured local mail is explicitly skipped without network or database work');
  setFixtureEnv();
  for (const bad of ['one@example.invalid,two@example.invalid', 'Name <one@example.invalid>', 'one@example.invalid\r\nBcc: other@example.invalid', 'group:one@example.invalid;',
    'Victim (x(y) <attacker@evil.invalid>) <v@victim.invalid>',
    'G: (a; <attacker@evil.invalid>) <v@victim.invalid>;',
    '<"a@evil.invalid>"@victim.invalid>',
  ]) {
    assert.equal((await sender(42, bad, 'test', 'Subject', 'text')).error, 'EMAIL_RECIPIENT_INVALID');
  }
  assert.equal(sends, 0);
  passed('account mail rejects recipient lists, display names, groups and header injection');
  const ok = await sender(42, to, 'password_reset', 'Subject', '123456', {html:'<p>123456</p>'});
  assert.equal(ok.sent, true); assert.equal(ok.logId, 1);
  assert.equal(messages[0].from, 'DrapixAI <no-reply@mail.drapixai.com>');
  assert.equal(messages[0].replyTo, 'support@drapixai.com');
  assert.equal(messages[0].to, to); assert.equal(messages[0].cc, undefined); assert.equal(messages[0].bcc, undefined);
  assert.equal(logs[0].status, 'sent'); assert.equal(logs[0].text, undefined);
  passed('accepted single-recipient account mail preserves sender, Support replies and metadata-only audit logging');
  const warnings: string[] = [], originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    logFails = true;
    const before = sends;
    const acceptedWithLogFailure = await sender(42, to, 'test', 'Subject', 'secret-body');
    assert.equal(acceptedWithLogFailure.sent, true);
    assert.equal(acceptedWithLogFailure.error, undefined);
    assert.equal(acceptedWithLogFailure.logError, 'EMAIL_LOG_WRITE_FAILED');
    assert.equal(sends, before + 1);
    assert.equal(logs.at(-1).status, 'sent');
    passed('accepted mail remains accepted when database logging fails, with no second send or failed-status rewrite');
    for (const [kind, code] of [['auth','EAUTH'], ['timeout','ETIMEDOUT'], ['unknownError','SMTP_DELIVERY_FAILED']]) {
      mode = kind;
      const failure = await sender(42, to, 'test', 'Subject', 'secret-body');
      assert.equal(failure.sent, false); assert.equal(failure.error, code);
      assert.equal(failure.logError, 'EMAIL_LOG_WRITE_FAILED');
    }
    assert.ok(warnings.every(warning => warning === 'EMAIL_LOG_WRITE_FAILED'
      || /^SMTP_SEND_FAILED (EAUTH|ETIMEDOUT|SMTP_DELIVERY_FAILED)$/.test(warning)));
    passed('SMTP and database failures return stable codes without throwing or leaking error content');
  } finally { console.warn = originalWarn; logFails = false; }
  for (const kind of ['rejected', 'otherRecipient', 'missingReceipt']) {
    mode = kind;
    const failure = await sender(42, to, 'test', 'Subject', 'text');
    assert.equal(failure.sent, false); assert.equal(failure.error, 'SMTP_ACCEPTANCE_UNCONFIRMED');
  }
  passed('rejected, mismatched and missing provider receipts cannot report a successful send');
  mode = 'accepted';
  const beforeLogs = logs.length;
  assert.equal((await sender(null, to, 'signup', 'Subject', 'text')).sent, true);
  assert.equal(logs.length, beforeLogs);
  passed('pre-account signup mail does not require a database user');
  await verifyEmailFailureRoutes();
  passed('account email failure response regression');
  let probeCalls = 0, probeClosed = 0;
  const probeFactory = (options: ReturnType<typeof getSmtpTransportOptions>) => {
    probeCalls++;
    assert.equal(options.host, 'smtp.resend.com'); assert.equal(options.port, 465);
    assert.equal(options.secure, true); assert.equal(options.tls.rejectUnauthorized, true);
    return {verify:async()=>true,close:()=>{probeClosed++;}};
  };
  for (const bad of [undefined, '', 'not-a-provider-key', 're_'+'a'.repeat(510)]) {
    await assert.rejects(verifyStagingSmtp(bad, probeFactory), /SMTP_INPUT_INVALID/);
  }
  assert.equal(probeCalls, 0);
  const probeResult = await verifyStagingSmtp('re_'+'synthetic'.repeat(3), probeFactory);
  assert.equal(probeResult.messagesSent, 0); assert.equal(probeResult.applicationConnected, false);
  assert.equal(probeCalls, 1); assert.equal(probeClosed, 1);
  await assert.rejects(verifyStagingSmtp('re_'+'synthetic'.repeat(3), () => ({verify:async()=>{throw new Error('private-provider-message');},close:()=>{probeClosed++;}})));
  assert.equal(probeClosed, 2);
  passed('private staging probe validates input, fixes the Resend TLS destination, performs authentication only and closes success/failure connections');
  const mailPlan = buildStagingEmailTests();
  assert.equal(STAGING_EMAIL_TEST_RECIPIENT, 'owner-approved@example.invalid');
  assert.deepEqual(mailPlan.map(item=>item.purpose), ['signup','password_reset']);
  assert.equal(new Set(mailPlan.map(item=>item.idempotencyKey)).size, 2);
  for (const item of mailPlan) {
    assert.ok(item.subject.startsWith('TEST ONLY -'));
    assert.ok(item.text.includes('DEMO-CODE is not a usable verification code'));
    assert.ok(item.html.includes('No account action was requested or changed'));
    assert.ok(!item.html.includes('<script'));
  }
  passed('controlled app-email plan contains exactly two marked examples, no usable OTP and unique provider idempotency keys');

  // Real Nodemailer against a synthetic loopback SMTP server, never a provider.
  // No TLS bypass: the plaintext server must be rejected before AUTH or DATA.
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 fixture.example.invalid ESMTP\r\n');
    let pending = '';
    socket.on('data', chunk => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        const verb = line.split(' ')[0].toUpperCase(); commands.push(verb);
        if (verb === 'EHLO') socket.write('250-fixture.example.invalid\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (verb === 'STARTTLS') socket.write('454 TLS unavailable\r\n');
        else if (verb === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('500 Not permitted by fixture\r\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address() as net.AddressInfo;
    Object.assign(process.env, {SMTP_HOST:'127.0.0.1', SMTP_PORT:String(address.port), SMTP_SECURE:'0'});
    const actual = createEmailSender({createTransport: options => nodemailer.createTransport(options), writeLog: async () => ({id:1})});
    const blocked = await actual(null, to, 'test', 'Synthetic subject', 'Synthetic body');
    assert.equal(blocked.sent, false);
    assert.ok(commands.includes('STARTTLS'), `TLS fixture result: ${blocked.error}; commands: ${commands.join(',')}`);
    assert.ok(!commands.includes('AUTH') && !commands.includes('MAIL') && !commands.includes('DATA'));
    passed('real SMTP refuses a server without TLS before disclosing authentication or email content');
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
  console.log(`Email delivery checks passed: ${cases} groups. Synthetic data only; no external email or database connection.`);
};
main().catch((error: unknown) => {
  const failure = error as { code?: string; stack?: string };
  console.error('EMAIL_DELIVERY_TEST_FAILED', failure.code || 'ASSERTION_OR_RUNTIME_ERROR');
  if ((failure as { message?: string }).message?.startsWith('TLS fixture result:')) console.error((failure as { message?: string }).message);
  // Stack locations aid fixture diagnosis without printing SMTP error messages.
  console.error((failure.stack || '').split('\n').filter(line => line.trim().startsWith('at ')).slice(0, 3).join('\n'));
  process.exitCode = 1;
}).finally(() => {
  for (const name of names) saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name];
});
