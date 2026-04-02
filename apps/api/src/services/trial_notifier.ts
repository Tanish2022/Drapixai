import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './emailer';

const prisma = new PrismaClient();

export const startTrialNotifications = () => {
  cron.schedule('0 9 * * *', async () => {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const users = await prisma.user.findMany({
      where: { planType: 'trial', trialExpiresAt: { lte: inThreeDays, gte: now } }
    });

    for (const u of users) {
      const daysLeft = Math.max(0, Math.ceil((u.trialExpiresAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const isLastDay = daysLeft <= 1;
      const subject = isLastDay ? 'Your DrapixAI trial ends today' : 'Your DrapixAI trial is ending soon';
      const upgradeUrl = process.env.BILLING_UPGRADE_URL || 'https://drapixai.com/pricing';
      const text = isLastDay
        ? `Your DrapixAI trial ends today. Upgrade now to avoid interruption: ${upgradeUrl}`
        : `Your DrapixAI trial ends in ${daysLeft} day(s). Upgrade to keep using AI try-on without interruption: ${upgradeUrl}`;
      const event = isLastDay ? 'trial_end_today' : 'trial_ending_soon';
      await sendEmail(u.id, u.email, event, subject, text);
    }
  });
};
