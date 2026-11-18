import type { ApiIdempotencyRecord, Prisma, TryOnResult } from '@prisma/client';
import { queueWebhookEvent } from '../services/webhooks';

export const PUBLIC_TRYON_ROUTE = 'POST /v1/tryons';
export type PublicTryOnReceipt = Pick<ApiIdempotencyRecord, 'id' | 'userId' | 'apiKeyId' | 'expiresAt'>;

export const publicTryOnReceiptOwner = (receipt: PublicTryOnReceipt) => ({
  id: receipt.id,
  userId: receipt.userId,
  apiKeyId: receipt.apiKeyId,
  route: PUBLIC_TRYON_ROUTE,
  state: 'processing',
  expiresAt: receipt.expiresAt,
});

export const completePublicTryOn = async (
  transaction: Prisma.TransactionClient, receipt: PublicTryOnReceipt, result: TryOnResult,
) => {
  const rejected = result.status === 'rejected';
  if (receipt.userId !== result.userId || receipt.apiKeyId !== result.apiKeyId
    || (!rejected && result.status !== 'generated')) {
    throw new Error('PUBLIC_TRYON_RESULT_MISMATCH');
  }
  const completed = await transaction.apiIdempotencyRecord.updateMany({
    where: publicTryOnReceiptOwner(receipt),
    data: { state: 'completed', responseStatus: rejected ? 422 : 200, tryOnResultId: result.id },
  });
  if (completed.count !== 1) throw new Error('PUBLIC_TRYON_RECEIPT_LOST');

  await queueWebhookEvent(transaction, receipt.userId, `evt_${receipt.id}`, rejected ? 'tryon.rejected' : 'tryon.completed', {
    tryon_id: String(result.id),
    product_id: result.productId,
    status: result.status,
    quality_score: result.qualityScore,
    latency_ms: result.latencyMs,
    warnings: result.warnings,
  });
};
