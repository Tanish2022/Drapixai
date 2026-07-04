import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type EmailSendResult = {
  sent: boolean;
  skipped: boolean;
  logId?: number;
  error?: string;
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
  text: string
): Promise<EmailSendResult> => {
  if (!process.env.SMTP_HOST) {
    return { sent: false, skipped: true, error: 'SMTP_HOST_NOT_CONFIGURED' };
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'no-reply@drapixai.com',
      to,
      subject,
      text
    });
    if (userId) {
      const log = await prisma.emailLog.create({
        data: { userId, email: to, event, status: 'sent' }
      });
      return { sent: true, skipped: false, logId: log.id };
    }
    return { sent: true, skipped: false };
  } catch (err: any) {
    const error = String(err?.message || err);
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
  const subjectMap = {
    signup: 'Your DrapixAI sign-up verification code',
    email_change_current: 'Verify your current DrapixAI email',
    email_change_new: 'Verify your new DrapixAI email',
    password_reset: 'Your DrapixAI password reset code',
  } as const;

  const introMap = {
    signup: 'Use this code to complete your DrapixAI sign-up:',
    email_change_current: 'Use this code to confirm your current account email before changing it:',
    email_change_new: 'Use this code to verify your new account email address:',
    password_reset: 'Use this code to reset your DrapixAI password:',
  } as const;

  const text = `${introMap[purpose]}\n\n${code}\n\nThis code expires in 10 minutes. If you did not request this, you can ignore this email.`;
  await sendEmail(userId ?? null, to, purpose, subjectMap[purpose], text);
};

export const sendGarmentApprovalEmail = async (
  userId: number,
  email: string,
  garmentId: string,
  status: 'approved' | 'rejected',
  reason?: string | null
) => {
  const subject = status === 'approved'
    ? `Garment approved: ${garmentId}`
    : `Garment rejected: ${garmentId}`;
  const text = status === 'approved'
    ? `Your garment "${garmentId}" has been approved and is now ready for try-on.`
    : `Your garment "${garmentId}" was rejected. Reason: ${reason || 'Not specified'}`;
  const event = status === 'approved' ? 'garment_approved' : 'garment_rejected';
  await sendEmail(userId, email, event, subject, text);
};
