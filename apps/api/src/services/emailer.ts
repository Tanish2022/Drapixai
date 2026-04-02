import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === '1',
  auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

export const sendEmail = async (userId: number, to: string, event: string, subject: string, text: string) => {
  if (!process.env.SMTP_HOST) return;
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'no-reply@drapixai.com',
      to,
      subject,
      text
    });
    await prisma.emailLog.create({
      data: { userId, email: to, event, status: 'sent' }
    });
  } catch (err: any) {
    await prisma.emailLog.create({
      data: { userId, email: to, event, status: 'failed', error: String(err?.message || err) }
    });
  }
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
