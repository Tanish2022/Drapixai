import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildOtpEmail } from '../services/email-templates';
import { sendEmail } from '../services/emailer';

export const STAGING_EMAIL_TEST_RECIPIENT = 'owner-approved@example.invalid';
export const buildStagingEmailTests = () => (['signup', 'password_reset'] as const).map(purpose => {
  const content = buildOtpEmail('DEMO-CODE', purpose);
  const id = purpose === 'signup' ? '20261022-APP-SIGNUP-01' : '20261022-APP-RESET-01';
  const notice = `TEST ONLY. Test ID: ${id}. This is an email template example. DEMO-CODE is not a usable verification code. No account action was requested or changed.`;
  return {
    id, purpose,
    subject:`TEST ONLY - DrapixAI ${purpose === 'signup' ? 'signup' : 'password-reset'} email - ${id}`,
    text:`${notice}\n\n${content.text}`,
    html:content.html.replace(/(<body[^>]*>)/, `$1<p style="padding:16px;background:#fff3cd;color:#332701;font:16px Arial;">${notice}</p>`),
    idempotencyKey:`cpu-staging-app-email/${id}`,
  };
});

const main = async () => {
  const tests = buildStagingEmailTests();
  if (!process.argv.includes('--send')) {
    const output = path.resolve(__dirname, '../../../../runtime/email-previews/staging-20261022');
    await fs.mkdir(output, {recursive:true});
    for (const test of tests) await fs.writeFile(path.join(output, `${test.id}.html`), test.html);
    console.log(JSON.stringify({dryRun:true,messagesSent:0,from:'DrapixAI <no-reply@mail.drapixai.com>',replyTo:'support@drapixai.com',to:STAGING_EMAIL_TEST_RECIPIENT,cc:[],bcc:[],tests:tests.map(({id,subject,text})=>({id,subject,text}))},null,2));
    return;
  }
  if (STAGING_EMAIL_TEST_RECIPIENT.endsWith('.invalid')) throw new Error('STAGING_RECIPIENT_NOT_CONFIGURED');
  if (!process.argv.includes(`--approved-recipient=${STAGING_EMAIL_TEST_RECIPIENT}`)) throw new Error('EXPLICIT_TEST_RECIPIENT_APPROVAL_REQUIRED');
  let raw = '';
  for await (const chunk of process.stdin) {raw += chunk.toString();if (Buffer.byteLength(raw)>4096) throw new Error('SMTP_INPUT_INVALID');}
  const input = JSON.parse(raw) as {password?:unknown};
  if (typeof input.password !== 'string' || !/^re_[A-Za-z0-9_-]{16,509}$/.test(input.password)) throw new Error('SMTP_INPUT_INVALID');
  if (!process.env.LOCALAPPDATA) throw new Error('LOCAL_PRIVATE_DIRECTORY_REQUIRED');
  const journal = path.join(process.env.LOCALAPPDATA,'DrapixAI/secrets/cpu-staging-email/application-tests-20261022.json');
  const report: {recipientSha256:string;state:string;attempts:Array<{id:string;state:string}>} = {
    recipientSha256:crypto.createHash('sha256').update(STAGING_EMAIL_TEST_RECIPIENT).digest('hex'),state:'started',attempts:[],
  };
  // A persistent local marker refuses accidental repeat sends, including after
  // an ambiguous failure. Reconcile provider records rather than deleting it.
  await fs.writeFile(journal,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  const settings = {
    SMTP_HOST:'smtp.resend.com',SMTP_PORT:'465',SMTP_SECURE:'1',SMTP_USER:'resend',SMTP_PASS:input.password,
    SMTP_FROM:'DrapixAI <no-reply@mail.drapixai.com>',SMTP_REPLY_TO:'support@drapixai.com',
    EMAIL_PUBLIC_BASE_URL:'https://drapixai.com',EMAIL_BRAND_LOGO_URL:'https://drapixai.com/drapixai_wordmark.webp',EMAIL_SUPPORT_ADDRESS:'support@drapixai.com',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
  Object.assign(process.env,settings);
  raw='';input.password=undefined;
  try {
    for (const test of tests) {
      const attempt={id:test.id,state:'started'};report.attempts.push(attempt);
      await fs.writeFile(journal,JSON.stringify(report,null,2));
      const result=await sendEmail(null,STAGING_EMAIL_TEST_RECIPIENT,`staging_${test.purpose}_template_test`,test.subject,test.text,{
        html:test.html,headers:{'Resend-Idempotency-Key':test.idempotencyKey,'X-DrapixAI-Test-ID':test.id},
      });
      attempt.state=result.sent?'accepted':'acceptance-not-confirmed';
      await fs.writeFile(journal,JSON.stringify(report,null,2));
      if (!result.sent) throw new Error('STAGING_TEST_SEND_NOT_CONFIRMED');
      console.log(JSON.stringify({id:test.id,accepted:true,accountChanged:false,databaseAccessed:false}));
    }
    report.state='accepted';await fs.writeFile(journal,JSON.stringify(report,null,2));
  } finally {
    for (const key of Object.keys(settings)) previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];
  }
};
if (require.main===module) main().catch(()=>{console.error('STAGING_EMAIL_TEST_FAILED_OR_PREVIOUSLY_ATTEMPTED');process.exitCode=1;});
