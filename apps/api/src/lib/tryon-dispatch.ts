import type { PrismaClient } from '@prisma/client';
import { markUsageDispatched, releaseProvenNoResultUsage, type QuotaTicket } from './quota-reservations';
import { dispatchTryOnSlot, observeTryOnTerminalResponse, releaseTryOnSlot, type TryOnLease } from './tryon-concurrency';

export const createTryOnDispatcher = (dependencies: {
  markUsage: typeof markUsageDispatched;
  releaseQuota: typeof releaseProvenNoResultUsage;
  dispatchSlot: typeof dispatchTryOnSlot;
  observe: typeof observeTryOnTerminalResponse;
  releaseSlot: typeof releaseTryOnSlot;
}) => async (prisma: PrismaClient, ticket: QuotaTicket, lease: TryOnLease, send: () => Promise<Response>) => {
  let invoked = false;
  try {
    if (lease.signal.aborted) throw new Error('TRYON_ADMISSION_LEASE_LOST');
    await dependencies.markUsage(prisma, ticket);
    await dependencies.dispatchSlot(lease);
    invoked = true;
    const response = await send();
    dependencies.observe(lease, response);
    if (lease.phase !== 'terminal') throw new Error(response.status === 504 ? 'AI_REQUEST_TIMEOUT' : 'AI_WORK_OUTCOME_UNCONFIRMED');
    if (!response.ok) {
      try { await dependencies.releaseQuota(prisma, ticket, response.headers.get('x-drapixai-work-state') === 'not-dispatched' ? 'ai_not_dispatched' : 'ai_terminal_failure'); }
      catch { throw new Error('TRYON_QUOTA_RECONCILIATION_REQUIRED'); }
    }
    return response;
  } finally {
    let cleanupFailed = false;
    if (!invoked) {
      // This exact reservation never invoked HTTP, even if SQL/Redis commit
      // acknowledgements were lost. It cannot have created remote AI work.
      lease.phase = 'terminal';
      try { await dependencies.releaseQuota(prisma, ticket, 'transport_not_invoked'); }
      catch { cleanupFailed = true; }
    }
    await dependencies.releaseSlot(lease);
    if (cleanupFailed) throw new Error('TRYON_QUOTA_RECONCILIATION_REQUIRED');
  }
};

export const dispatchTryOnWithUsage = createTryOnDispatcher({
  markUsage: markUsageDispatched, releaseQuota: releaseProvenNoResultUsage,
  dispatchSlot: dispatchTryOnSlot, observe: observeTryOnTerminalResponse, releaseSlot: releaseTryOnSlot,
});
