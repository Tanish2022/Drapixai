import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import {
  buildGarmentDecisionEmail,
  buildOtpEmail,
  buildTrialReminderEmail,
  buildWelcomeEmail,
} from './email-templates';
import { getEmailDeliveryConfig, normalizeMailRecipient } from '../lib/email-delivery-policy';
import { canSendTransactionalEmail } from './email-delivery-events';
import { observeEmailSend } from '../lib/operational-metrics';

const prisma = new PrismaClient();

type EmailSendResult = {
  sent: boolean;
  skipped: boolean;
  logId?: number;
  error?: string;
  logError?: 'EMAIL_LOG_WRITE_FAILED';
};

type EmailSendOptions = {
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export const getSmtpTransportOptions = (env: NodeJS.ProcessEnv = process.env) => {
  const host = (env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 587);
  const implicitTls = port === 465 || port === 2465;
  const startTlsPort = [25, 587, 2587].includes(port);
  const secure = env.SMTP_SECURE === undefined ? implicitTls : env.SMTP_SECURE === '1';
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535
    || (env.SMTP_SECURE !== undefined && !['0', '1'].includes(env.SMTP_SECURE))
    || (implicitTls && !secure) || (startTlsPort && secure)
    || !(env.SMTP_USER || '').trim() || !env.SMTP_PASS) {
    throw new Error('SMTP_CONFIGURATION_INVALID');
  }
  return {
    host, port, secure,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    dnsTimeout: 10_000,
    logger: false as const,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
};

export const assertSmtpConfiguration = () => { getSmtpTransportOptions(); };

type EmailLogData = { userId: number; email: string; event: string; status: string; error?: string };
type EmailMessage = {
  from: string; to: string; subject: string; text: string;
  html?: string; replyTo: string; headers: Record<string, string>;
};
type EmailDependencies = {
  createTransport: (options: ReturnType<typeof getSmtpTransportOptions>) => {
    sendMail: (message: EmailMessage) => Promise<unknown>;
  };
  writeLog: (data: EmailLogData) => Promise<{ id: number }>;
  canSend?: (recipient: string) => Promise<boolean>;
};
const smtpErrorCodes = new Set([
  'EAUTH', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ETIMEOUT',
  'EDNS', 'ENOTFOUND', 'ETLS', 'ESOCKET', 'EENVELOPE', 'EMESSAGE',
]);
const safeSmtpError = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && smtpErrorCodes.has(code) ? code : 'SMTP_DELIVERY_FAILED';
};

export const createEmailSender = (dependencies: EmailDependencies) => async (
  userId: number | null,
  to: string,
  event: string,
  subject: string,
  text: string,
  options: EmailSendOptions = {}
): Promise<EmailSendResult> => {
  if (!process.env.SMTP_HOST) {
    return { sent: false, skipped: true, error: 'SMTP_HOST_NOT_CONFIGURED' };
  }

  // Nodemailer supports recipient lists. Account messages must have exactly one
  // bare recipient so untrusted text cannot introduce additional recipients.
  const recipient = to.trim();
  if (!normalizeMailRecipient(recipient)) {
    return { sent: false, skipped: false, error: 'EMAIL_RECIPIENT_INVALID' };
  }
  let transportOptions: ReturnType<typeof getSmtpTransportOptions>;
  try {
    transportOptions = getSmtpTransportOptions();
  } catch {
    return { sent: false, skipped: false, error: 'SMTP_CONFIGURATION_INVALID' };
  }
  try {
    if (getEmailDeliveryConfig()) {
      if (!dependencies.canSend) throw new Error('EMAIL_SUPPRESSION_GUARD_REQUIRED');
      if (!await dependencies.canSend(recipient)) {
        observeEmailSend('blocked');
        return { sent: false, skipped: false, error: 'EMAIL_RECIPIENT_SUPPRESSED' };
      }
    }
  } catch {
    observeEmailSend('failed');
    return { sent: false, skipped: false, error: 'EMAIL_SUPPRESSION_CHECK_UNAVAILABLE' };
  }
  let result: EmailSendResult;
  try {
    const info = await dependencies.createTransport(transportOptions).sendMail({
      from: process.env.SMTP_FROM || 'DrapixAI <no-reply@mail.drapixai.com>',
      to: recipient,
      subject,
      text,
      html: options.html,
      replyTo: options.replyTo || process.env.SMTP_REPLY_TO || process.env.EMAIL_SUPPORT_ADDRESS || 'support@drapixai.com',
      headers: {
        'X-Auto-Response-Suppress': 'All',
        ...options.headers,
      },
    }) as { accepted?: unknown[]; rejected?: unknown[] } | null;
    const accepted = info?.accepted;
    result = Array.isArray(accepted) && accepted.length === 1
      && typeof accepted[0] === 'string' && accepted[0].toLowerCase() === recipient.toLowerCase()
      && (!info?.rejected || info.rejected.length === 0)
      ? { sent: true, skipped: false }
      : { sent: false, skipped: false, error: 'SMTP_ACCEPTANCE_UNCONFIRMED' };
  } catch (error: unknown) {
    result = { sent: false, skipped: false, error: safeSmtpError(error) };
  }
  if (!result.sent) console.warn('SMTP_SEND_FAILED', result.error);
  observeEmailSend(result.sent ? 'accepted' : result.error === 'SMTP_ACCEPTANCE_UNCONFIRMED' || ['ETIMEDOUT','ETIMEOUT','ECONNRESET','ESOCKET'].includes(result.error || '') ? 'unknown' : 'failed');
  // SMTP acceptance and log persistence are separate outcomes. A log outage
  // must not turn an accepted email into a failed send and encourage a resend.
  if (userId) {
    try {
      const log = await dependencies.writeLog({
        userId, email: recipient, event, status: result.sent ? 'sent' : 'failed',
        ...(result.error ? { error: result.error } : {}),
      });
      result = { ...result, logId: log.id };
    } catch {
      result.logError = 'EMAIL_LOG_WRITE_FAILED';
      console.warn('EMAIL_LOG_WRITE_FAILED');
    }
  }
  return result;
};

export const sendEmail = createEmailSender({
  createTransport: options => nodemailer.createTransport(options),
  writeLog: data => prisma.emailLog.create({ data }),
  canSend: recipient => canSendTransactionalEmail(prisma, recipient),
});

export const sendOtpEmail = async (
  to: string,
  code: string,
  purpose: 'signup' | 'email_change_current' | 'email_change_new' | 'password_reset',
  userId?: number | null
) => {
  const content = buildOtpEmail(code, purpose);
  return sendEmail(userId ?? null, to, purpose, content.subject, content.text, { html: content.html });
};

export const sendGarmentApprovalEmail = async (
  userId: number,
  email: string,
  garmentId: string,
  status: 'approved' | 'rejected',
  reason?: string | null
) => {
  const content = buildGarmentDecisionEmail(garmentId, status, reason);
  const event = status === 'approved' ? 'garment_approved' : 'garment_rejected';
  return sendEmail(userId, email, event, content.subject, content.text, { html: content.html });
};

export const sendWelcomeEmail = async (
  userId: number,
  email: string,
  companyName?: string | null
) => {
  const content = buildWelcomeEmail(companyName);
  return sendEmail(userId, email, 'workspace_welcome', content.subject, content.text, { html: content.html });
};

export const sendTrialReminderEmail = async (
  userId: number,
  email: string,
  daysLeft: number
) => {
  const content = buildTrialReminderEmail(daysLeft);
  return sendEmail(userId, email, daysLeft <= 1 ? 'trial_end_today' : 'trial_ending_soon', content.subject, content.text, { html: content.html });
};
