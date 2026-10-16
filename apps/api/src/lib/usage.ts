import { Prisma, PrismaClient } from '@prisma/client';
import { TRIAL_DAYS } from './plans';
import { DatabaseLockBusy, runDatabaseTransaction } from './database-transaction';

const utcMonth = (at: Date) => ({
  month: at.getUTCMonth() + 1,
  year: at.getUTCFullYear(),
});

const utcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

type UsagePeriodUser = {
  createdAt: Date;
  planType?: string | null;
  subscriptionProvider?: string | null;
  subscriptionCurrentPeriodEndsAt?: Date | null;
  trialExpiresAt?: Date | null;
};

const subtractUtcMonth = (value: Date) => {
  const previousMonth = value.getUTCMonth() === 0 ? 11 : value.getUTCMonth() - 1;
  const year = value.getUTCMonth() === 0 ? value.getUTCFullYear() - 1 : value.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, previousMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    previousMonth,
    Math.min(value.getUTCDate(), lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
};

export const getUsagePeriodBounds = (user: UsagePeriodUser, at = new Date()) => {
  const plan = String(user.planType || '').trim().toLowerCase();
  if (plan === 'trial') {
    return {
      periodStart: user.createdAt,
      periodEnd: user.trialExpiresAt || new Date(user.createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      source: 'trial' as const,
    };
  }
  if (
    user.subscriptionProvider === 'stripe'
    && user.subscriptionCurrentPeriodEndsAt
    && ['starter', 'growth', 'pro'].includes(plan)
  ) {
    return {
      periodStart: subtractUtcMonth(user.subscriptionCurrentPeriodEndsAt),
      periodEnd: user.subscriptionCurrentPeriodEndsAt,
      source: 'subscription' as const,
    };
  }
  return {
    periodStart: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
    source: 'calendar' as const,
  };
};

export const getUserUsagePeriod = async (prisma: PrismaClient, userId: number, at = new Date()) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      planType: true,
      subscriptionProvider: true,
      subscriptionCurrentPeriodEndsAt: true,
      trialExpiresAt: true,
    },
  });
  return user ? getUsagePeriodBounds(user, at) : null;
};

export const getUserMonthlyUsage = async (prisma: PrismaClient, userId: number, at = new Date()) => {
  const period = await getUserUsagePeriod(prisma, userId, at);
  if (!period) return 0;
  const usage = await prisma.billingUsagePeriod.aggregate({
    where: {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      apiKey: { userId },
    },
    _sum: { renderCount: true },
  });
  return usage._sum.renderCount || 0;
};

export const getUserQuotaUsage = async (prisma: PrismaClient, userId: number, at = new Date()) => {
  return runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, userId);
    const user = await transaction.user.findUnique({ where: { id: userId } });
    if (!user) return { used: 0, reserved: 0, period: null };
    const period = getUsagePeriodBounds(user, at);
    const completed = await transaction.billingUsagePeriod.aggregate({
      where: { periodStart: period.periodStart, periodEnd: period.periodEnd, apiKey: { userId } },
      _sum: { renderCount: true },
    });
    const reserved = await transaction.usageReservation.count({
      where: { userId, periodStart: period.periodStart, periodEnd: period.periodEnd, status: 'reserved' },
    });
    return { used: completed._sum.renderCount || 0, reserved, period };
  });
};

export const getUserDailyUsage = async (
  prisma: PrismaClient,
  userId: number,
  start: Date,
) => {
  const rows = await prisma.usageDaily.groupBy({
    by: ['date'],
    where: {
      apiKey: { userId },
      date: { gte: start },
    },
    _sum: { count: true },
    orderBy: { date: 'asc' },
  });
  return rows.map((row) => ({ date: row.date, count: row._sum.count || 0 }));
};

export const incrementApiKeyUsage = async (
  prisma: PrismaClient,
  apiKeyId: number,
  at = new Date(),
) => {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { userId: true } });
  if (!key) throw new Error('USAGE_API_KEY_NOT_FOUND');
  await runDatabaseTransaction(prisma, async (transaction) => {
    await lockAccountUsage(transaction, key.userId);
    const apiKey = await transaction.apiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        user: {
          select: {
            createdAt: true,
            planType: true,
            subscriptionProvider: true,
            subscriptionCurrentPeriodEndsAt: true,
            trialExpiresAt: true,
          },
        },
      },
    });
    if (!apiKey) throw new Error('USAGE_API_KEY_NOT_FOUND');
    const billingPeriod = getUsagePeriodBounds(apiKey.user, at);
    await incrementUsageInTransaction(transaction, apiKeyId, at, billingPeriod);
  });
};

// Every quota admission/settlement and compatibility counter write shares this
// account lock. No transaction is held open while contacting AI or Redis.
export const lockAccountUsage = async (transaction: Prisma.TransactionClient, userId: number) => {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('USAGE_ACCOUNT_INVALID');
  const [lock] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(1720349237, ${userId}::integer) AS acquired`;
  if (!lock?.acquired) throw new DatabaseLockBusy();
};

export const incrementUsageInTransaction = async (
  transaction: Prisma.TransactionClient,
  apiKeyId: number,
  at: Date,
  billingPeriod: { periodStart: Date; periodEnd: Date },
) => {
  const period = utcMonth(at);
  const date = utcDay(at);
  await transaction.usage.upsert({
    where: { apiKeyId_month_year: { apiKeyId, ...period } },
    update: { renderCount: { increment: 1 } },
    create: { apiKeyId, renderCount: 1, ...period },
  });
  await transaction.usageDaily.upsert({
    where: { apiKeyId_date: { apiKeyId, date } },
    update: { count: { increment: 1 } },
    create: { apiKeyId, date, count: 1 },
  });
  await transaction.billingUsagePeriod.upsert({
    where: {
      apiKeyId_periodStart_periodEnd: {
        apiKeyId,
        periodStart: billingPeriod.periodStart,
        periodEnd: billingPeriod.periodEnd,
      },
    },
    update: { renderCount: { increment: 1 } },
    create: { apiKeyId, periodStart: billingPeriod.periodStart, periodEnd: billingPeriod.periodEnd, renderCount: 1 },
  });
};
