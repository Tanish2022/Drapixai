import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import {
  buildGarmentDecisionEmail,
  buildOtpEmail,
  buildTrialReminderEmail,
  buildWelcomeEmail,
} from './email-templates';

const prisma = new PrismaClient();

type EmailSendResult = {
  sent: boolean;
  skipped: boolean;
  logId?: number;
  error?: string;
};

type EmailSendOptions = {
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === '1',
  auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

export const sendEmail = async (
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

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'DrapixAI <no-reply@mail.drapixai.com>',
      to,
      subject,
      text,
      html: options.html,
      replyTo: options.replyTo || process.env.SMTP_REPLY_TO || process.env.EMAIL_SUPPORT_ADDRESS || 'support@drapixai.com',
      headers: {
        'X-Auto-Response-Suppress': 'All',
        ...options.headers,
      },
    });
    if (userId) {
      const log = await prisma.emailLog.create({
        data: { userId, email: to, event, status: 'sent' }
      });
      return { sent: true, skipped: false, logId: log.id };
    }
    return { sent: true, skipped: false };
  } catch (err: any) {
    const error = String(err?.code || err?.name || 'SMTP_DELIVERY_FAILED').slice(0, 120);
    if (userId) {
      const log = await prisma.emailLog.create({
        data: { userId, email: to, event, status: 'failed', error }
      });
      return { sent: false, skipped: false, logId: log.id, error };
    }
    return { sent: false, skipped: false, error };
  }
};

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
