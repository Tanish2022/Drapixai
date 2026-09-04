import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendTrialReminderEmail } from './emailer';

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
      await sendTrialReminderEmail(u.id, u.email, daysLeft);
    }
  });
};
