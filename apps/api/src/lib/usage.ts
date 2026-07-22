import { PrismaClient } from '@prisma/client';

const utcMonth = (at: Date) => ({
  month: at.getUTCMonth() + 1,
  year: at.getUTCFullYear(),
});

const utcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export const getUserMonthlyUsage = async (prisma: PrismaClient, userId: number, at = new Date()) => {
  const period = utcMonth(at);
  const usage = await prisma.usage.aggregate({
    where: {
      ...period,
      apiKey: { userId },
    },
    _sum: { renderCount: true },
  });
  return usage._sum.renderCount || 0;
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
  const period = utcMonth(at);
  const date = utcDay(at);
  await prisma.$transaction([
    prisma.usage.upsert({
      where: { apiKeyId_month_year: { apiKeyId, ...period } },
      update: { renderCount: { increment: 1 } },
      create: { apiKeyId, renderCount: 1, ...period },
    }),
    prisma.usageDaily.upsert({
      where: { apiKeyId_date: { apiKeyId, date } },
      update: { count: { increment: 1 } },
      create: { apiKeyId, date, count: 1 },
    }),
  ]);
};
