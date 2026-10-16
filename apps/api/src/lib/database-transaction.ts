import { Prisma, PrismaClient } from '@prisma/client';

export class DatabaseLockBusy extends Error {
  constructor() { super('DATABASE_LOCK_BUSY'); }
}

// Callbacks must contain database operations only. A failed try-lock rolls back
// before waiting; never exhaust the pool with blocking advisory-lock queries.
export const runDatabaseTransaction = async <T>(
  prisma: PrismaClient, callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  const deadline = Date.now() + 3000;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 1000, timeout: 5000,
      });
    } catch (error) {
      const retryable = error instanceof DatabaseLockBusy
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034');
      if (!retryable) throw error;
      if (attempt === 29 || Date.now() >= deadline) throw new Error('DATABASE_BUSY_RETRY');
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, 5 + attempt * 3)));
    }
  }
  throw new Error('DATABASE_BUSY_RETRY');
};
