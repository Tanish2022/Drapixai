import nodemailer from 'nodemailer';
import { getSmtpTransportOptions } from '../services/emailer';

// This bounded probe reads only the privately supplied key from stdin. It never
// loads dotenv, queries a database, sends mail or accepts a configurable target.
type ProbeTransport = {verify():Promise<unknown>;close():void};
export const verifyStagingSmtp = async (password: unknown,
  createTransport: (options: ReturnType<typeof getSmtpTransportOptions>) => ProbeTransport = options => nodemailer.createTransport(options)) => {
  if (typeof password !== 'string' || !/^re_[A-Za-z0-9_-]{16,509}$/.test(password)) throw new Error('SMTP_INPUT_INVALID');
  const transporter = createTransport(getSmtpTransportOptions({
    SMTP_HOST:'smtp.resend.com', SMTP_PORT:'465', SMTP_SECURE:'1',
    SMTP_USER:'resend', SMTP_PASS:password,
  }));
  try {
    await transporter.verify();
    return {passed:true,host:'smtp.resend.com',port:465,tls:'certificate-verified',authenticated:true,messagesSent:0,applicationConnected:false};
  } finally { transporter.close(); }
};
const main = async () => {
  let payload = '';
  for await (const chunk of process.stdin) {
    payload += chunk.toString();
    if (Buffer.byteLength(payload) > 4096) throw new Error('SMTP_INPUT_INVALID');
  }
  const input = JSON.parse(payload) as {password?: unknown};
  const result = await verifyStagingSmtp(input.password);
  payload = ''; input.password = undefined;
  console.log(JSON.stringify(result));
};
if (require.main === module) main().catch(() => {
  console.error('STAGING_SMTP_VERIFICATION_FAILED');
  process.exitCode = 1;
});
