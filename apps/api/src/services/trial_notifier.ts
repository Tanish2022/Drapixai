import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { runDatabaseTransaction } from '../lib/database-transaction';
import { formatLogError } from '../lib/security';
import { sendTrialReminderEmail } from './emailer';

const DAY_MS = 24 * 60 * 60 * 1000;
const reminderWindow = (now: Date) => ({ gte: now, lte: new Date(now.getTime() + 3 * DAY_MS) });

export const claimTrialReminder = (db: PrismaClient, userId: number, now: Date) => runDatabaseTransaction(db, async tx => {
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(1730349239, ${userId}::integer) AS acquired`;
  if (!lock?.acquired) return null;
  const user = await tx.user.findFirst({
    where: { id: userId, planType: 'trial', trialExpiresAt: reminderWindow(now) },
    select: { id: true, email: true, trialExpiresAt: true },
  });
  if (!user) return null;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const event = 'trial_reminder_claim';
  if (await tx.emailLog.findFirst({ where: { userId, event, createdAt: { gte: dayStart } }, select: { id: true } })) return null;
  // Commit before SMTP so an ambiguous result cannot trigger another send that day.
  await tx.emailLog.create({ data: { userId, email: '', event, status: 'claimed' } });
  return user;
});

export const startTrialNotifications = () => {
  cron.schedule('0 9 * * *', async () => {
    try {
      const users = await prisma.user.findMany({
        where: { planType: 'trial', trialExpiresAt: reminderWindow(new Date()) }, select: { id: true },
      });
      for (const { id } of users) {
        const claimed = await claimTrialReminder(prisma, id, new Date());
        if (!claimed?.trialExpiresAt) continue;
        const daysLeft = Math.max(0, Math.ceil((claimed.trialExpiresAt.getTime() - Date.now()) / DAY_MS));
        await sendTrialReminderEmail(claimed.id, claimed.email, daysLeft);
      }
    } catch (error) {
      console.error('Trial reminder job failed:', formatLogError(error));
    }
  }, { timezone: 'UTC' });
};
