import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { appendSecurityAudit, appendSecurityAuditInTransaction } from '../lib/audit-log';
import { DatabaseLockBusy, runDatabaseTransaction } from '../lib/database-transaction';
import { resolveActiveApiKey } from '../lib/api-key-auth';
import {
  BILLING_CHECKOUT_TTL_MS,
  BILLING_EVENT_CLAIM_TIMEOUT_MS,
  getBillingRedirectUrls,
  getBillingStatePriority,
  getStripeClient,
  getStripeInvoiceSubscriptionId,
  getStripePriceId,
  getStripeRequestIdempotencyKey,
  getStripeSubscriptionSnapshot,
  hashBillingIdempotencyKey,
  isStripeBillingEnabled,
  isStripeLiveMode,
  normalizeBillingIdempotencyKey,
  stripeObjectId,
  verifyStripeWebhook,
} from '../lib/billing';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { normalizeSelectedPlan, type PublicPlanKey } from '../lib/plans';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { formatLogError } from '../lib/security';

const prisma = new PrismaClient();
const router = Router();
export const stripeWebhookRouter = Router();

type BillingRequest = Request & {
  billingApiKey?: {
    id: number;
    userId: number;
    kind: string;
  };
};

const requestId = (req: Request) => {
  const supplied = String(req.headers['x-request-id'] || '').trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
};

const billingDisabled = (res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'BILLING_UNAVAILABLE' });
};

const resolveBillingKey = async (req: BillingRequest, res: Response, next: () => void) => {
  const activeKey = await resolveActiveApiKey(prisma, req.headers.authorization);
  if (!activeKey) return res.status(401).json({ error: 'INVALID_API_KEY' });
  if (activeKey.kind !== 'dashboard') return res.status(403).json({ error: 'DASHBOARD_KEY_REQUIRED' });
  req.billingApiKey = activeKey;
  return next();
};

router.use(requireDashboardProxy);
router.use(resolveBillingKey);
router.use(createRateLimitMiddleware(
  20,
  15 * 60 * 1000,
  (req: BillingRequest) => `billing:${req.billingApiKey?.userId || 'unknown'}:${req.path}`,
));

const recoverCheckoutAttempt = async (userId: number, keyHash: string, plan: PublicPlanKey) => {
  const existing = await prisma.billingCheckoutAttempt.findUnique({
    where: { userId_idempotencyKeyHash: { userId, idempotencyKeyHash: keyHash } },
  });
  if (!existing) return { action: 'retry' as const, attempt: null };
  if (existing.plan !== plan) return { action: 'conflict' as const, attempt: existing };
  if (existing.providerSessionId) return { action: 'retrieve' as const, attempt: existing };
  if (existing.status === 'creating' && existing.updatedAt > new Date(Date.now() - 60_000)) {
    return { action: 'processing' as const, attempt: existing };
  }
  const reclaimed = await prisma.billingCheckoutAttempt.updateMany({
    where: {
      id: existing.id,
      providerSessionId: null,
      updatedAt: existing.updatedAt,
    },
    data: {
      status: 'creating',
      expiresAt: new Date(Date.now() + BILLING_CHECKOUT_TTL_MS),
    },
  });
  return reclaimed.count === 1
    ? { action: 'retry' as const, attempt: existing }
    : { action: 'processing' as const, attempt: existing };
};

router.post('/checkout', async (req: BillingRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isStripeBillingEnabled()) return billingDisabled(res);
  const apiKey = req.billingApiKey!;
  const plan = normalizeSelectedPlan(req.body?.plan);
  if (!plan) return res.status(400).json({ error: 'BILLING_PLAN_INVALID' });
  const idempotencyKey = normalizeBillingIdempotencyKey(req.headers['idempotency-key']);
  if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_INVALID' });
  const keyHash = hashBillingIdempotencyKey(idempotencyKey);
  const auditRequestId = requestId(req);

  let shouldCreate = false;
  try {
    await prisma.billingCheckoutAttempt.create({
      data: {
        userId: apiKey.userId,
        idempotencyKeyHash: keyHash,
        plan,
        expiresAt: new Date(Date.now() + BILLING_CHECKOUT_TTL_MS),
      },
    });
    shouldCreate = true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }

  if (!shouldCreate) {
    const recovered = await recoverCheckoutAttempt(apiKey.userId, keyHash, plan);
    if (recovered.action === 'conflict') {
      return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_PLAN' });
    }
    if (recovered.action === 'processing') {
      res.setHeader('Retry-After', '2');
      return res.status(409).json({ error: 'BILLING_CHECKOUT_IN_PROGRESS' });
    }
    if (recovered.action === 'retrieve' && recovered.attempt?.providerSessionId) {
      const session = await getStripeClient().checkout.sessions.retrieve(recovered.attempt.providerSessionId);
      if (!session.url || session.status === 'complete' || session.status === 'expired') {
        return res.status(409).json({ error: 'BILLING_CHECKOUT_ALREADY_FINALIZED' });
      }
      return res.json({ url: session.url, reused: true });
    }
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
    if (!user) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
    const reusableSubscriptionStatuses = new Set([
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'paused',
      'incomplete',
    ]);
    if (
      user.subscriptionProvider === 'stripe'
      && user.subscriptionId
      && reusableSubscriptionStatuses.has(String(user.subscriptionStatus || '').toLowerCase())
    ) {
      await prisma.billingCheckoutAttempt.updateMany({
        where: { userId: user.id, idempotencyKeyHash: keyHash, providerSessionId: null },
        data: { status: 'blocked_existing_subscription' },
      });
      return res.status(409).json({ error: 'USE_BILLING_PORTAL_FOR_EXISTING_SUBSCRIPTION' });
    }
    const urls = getBillingRedirectUrls();
    const session = await getStripeClient().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: getStripePriceId(plan), quantity: 1 }],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      client_reference_id: String(user.id),
      customer: user.subscriptionCustomerId || undefined,
      customer_email: user.subscriptionCustomerId ? undefined : user.email,
      metadata: {
        drapixai_user_id: String(user.id),
        plan,
      },
      subscription_data: {
        metadata: {
          drapixai_user_id: String(user.id),
          plan,
        },
      },
    }, {
      idempotencyKey: getStripeRequestIdempotencyKey(user.id, keyHash),
    });
    if (!session.url) throw new Error('STRIPE_CHECKOUT_URL_MISSING');
    await prisma.billingCheckoutAttempt.update({
      where: { userId_idempotencyKeyHash: { userId: user.id, idempotencyKeyHash: keyHash } },
      data: {
        providerSessionId: session.id,
        status: 'created',
        expiresAt: session.expires_at
          ? new Date(session.expires_at * 1000)
          : new Date(Date.now() + BILLING_CHECKOUT_TTL_MS),
      },
    });
    await appendSecurityAudit(prisma, {
      actorUserId: user.id,
      actorRole: 'brand_admin',
      action: 'billing.checkout.created',
      targetType: 'billing_plan',
      targetId: plan,
      requestId: auditRequestId,
      ip: req.ip,
      metadata: { plan },
    });
    return res.json({ url: session.url, reused: false });
  } catch (error) {
    await prisma.billingCheckoutAttempt.updateMany({
      where: { userId: apiKey.userId, idempotencyKeyHash: keyHash, providerSessionId: null },
      data: { status: 'failed' },
    }).catch(() => undefined);
    console.error('Stripe checkout creation failed:', formatLogError(error));
    return res.status(502).json({ error: 'BILLING_PROVIDER_UNAVAILABLE' });
  }
});

router.post('/portal', async (req: BillingRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isStripeBillingEnabled()) return billingDisabled(res);
  const apiKey = req.billingApiKey!;
  const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
  if (!user?.subscriptionCustomerId || user.subscriptionProvider !== 'stripe') {
    return res.status(409).json({ error: 'BILLING_CUSTOMER_NOT_AVAILABLE' });
  }
  try {
    const session = await getStripeClient().billingPortal.sessions.create({
      customer: user.subscriptionCustomerId,
      return_url: getBillingRedirectUrls().portalReturnUrl,
    });
    await appendSecurityAudit(prisma, {
      actorUserId: user.id,
      actorRole: 'brand_admin',
      action: 'billing.portal.created',
      targetType: 'billing_account',
      targetId: user.id,
      requestId: requestId(req),
      ip: req.ip,
    });
    return res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal creation failed:', formatLogError(error));
    return res.status(502).json({ error: 'BILLING_PROVIDER_UNAVAILABLE' });
  }
});

type ClaimResult = { status: 'claimed'; attemptCount: number } | { status: 'processed' } | { status: 'busy' };

const claimWebhookEvent = async (event: Stripe.Event): Promise<ClaimResult> => {
  const providerCreatedAt = event.created > 0 ? new Date(event.created * 1000) : null;
  try {
    const created = await prisma.billingWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type,
        livemode: event.livemode,
        providerCreatedAt,
      },
    });
    return { status: 'claimed', attemptCount: created.attemptCount };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
  }

  const existing = await prisma.billingWebhookEvent.findUnique({ where: { id: event.id } });
  if (!existing) return { status: 'busy' };
  if (existing.type !== event.type || existing.livemode !== event.livemode
    || existing.providerCreatedAt?.getTime() !== providerCreatedAt?.getTime()) {
    throw new Error('BILLING_EVENT_IDENTITY_CONFLICT');
  }
  if (existing.status === 'processed') return { status: 'processed' };
  const staleBefore = new Date(Date.now() - BILLING_EVENT_CLAIM_TIMEOUT_MS);
  const reclaimed = await prisma.billingWebhookEvent.updateMany({
    where: {
      id: event.id,
      attemptCount: existing.attemptCount,
      OR: [
        { status: 'failed' },
        { status: 'processing', updatedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'processing',
      errorCode: null,
      attemptCount: { increment: 1 },
    },
  });
  return reclaimed.count === 1
    ? { status: 'claimed', attemptCount: existing.attemptCount + 1 }
    : { status: 'busy' };
};

const resolveWebhookUser = async (input: {
  metadataUserId?: number | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}, db: Prisma.TransactionClient = prisma) => {
  if (input.metadataUserId) {
    const byId = await db.user.findUnique({ where: { id: input.metadataUserId } });
    if (byId) return byId;
  }
  if (input.subscriptionId) {
    const bySubscription = await db.user.findFirst({ where: { subscriptionId: input.subscriptionId } });
    if (bySubscription) return bySubscription;
  }
  if (input.customerId) {
    return db.user.findFirst({ where: { subscriptionCustomerId: input.customerId } });
  }
  return null;
};

// All webhook writes use one transaction. Serialize per-account linkage checks
// and re-read after the try-lock so concurrent events cannot use stale bindings.
const resolveLockedWebhookUser = async (db: Prisma.TransactionClient, input: Parameters<typeof resolveWebhookUser>[0]) => {
  const candidate = await resolveWebhookUser(input, db);
  if (!candidate) return null;
  const [lock] = await db.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(1730349238, ${candidate.id}::integer) AS acquired`;
  if (!lock?.acquired) throw new DatabaseLockBusy();
  return db.user.findUnique({ where: { id: candidate.id } });
};

const applySubscriptionEvent = async (event: Stripe.Event, db: Prisma.TransactionClient) => {
  const snapshot = getStripeSubscriptionSnapshot(event.data.object);
  const user = await resolveLockedWebhookUser(db, snapshot);
  if (!user) throw new Error('BILLING_USER_NOT_FOUND');
  if (!snapshot.subscriptionId || !snapshot.customerId) throw new Error('BILLING_SUBSCRIPTION_INVALID');
  if (!snapshot.plan) throw new Error('BILLING_PRICE_NOT_CONFIGURED');
  if (user.subscriptionCustomerId && user.subscriptionCustomerId !== snapshot.customerId) {
    throw new Error('BILLING_CUSTOMER_MISMATCH');
  }
  if (
    user.subscriptionId
    && user.subscriptionId !== snapshot.subscriptionId
    && !['canceled', 'incomplete_expired'].includes(String(user.subscriptionStatus || '').toLowerCase())
  ) {
    throw new Error('BILLING_SUBSCRIPTION_MISMATCH');
  }
  const active = snapshot.status === 'active' || snapshot.status === 'trialing';
  if (active && !snapshot.currentPeriodEndsAt) throw new Error('BILLING_PERIOD_INVALID');
  const terminal = snapshot.status === 'canceled' || snapshot.status === 'incomplete_expired';
  const eventCreatedAt = new Date(event.created * 1000);
  const eventPriority = getBillingStatePriority(snapshot.status);
  const updated = await db.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { subscriptionEventCreatedAt: null },
        { subscriptionEventCreatedAt: { lt: eventCreatedAt } },
        {
          subscriptionEventCreatedAt: eventCreatedAt,
          subscriptionEventPriority: { lte: eventPriority },
        },
      ],
    },
    data: {
      selectedPlan: snapshot.plan,
      subscriptionPlan: snapshot.plan,
      subscriptionStatus: snapshot.status,
      subscriptionProvider: 'stripe',
      subscriptionCustomerId: snapshot.customerId,
      subscriptionId: snapshot.subscriptionId,
      subscriptionCurrentPeriodEndsAt: snapshot.currentPeriodEndsAt,
      subscriptionEventCreatedAt: eventCreatedAt,
      subscriptionEventPriority: eventPriority,
      planType: active ? snapshot.plan : terminal ? 'canceled' : user.planType,
    },
  });
  return {
    userId: user.id,
    plan: snapshot.plan,
    status: updated.count === 1 ? snapshot.status : 'ignored_stale',
  };
};

const applyCheckoutCompleted = async (event: Stripe.Event, db: Prisma.TransactionClient) => {
  const session = event.data.object as Stripe.Checkout.Session;
  const metadataUserId = Number(session.metadata?.drapixai_user_id || session.client_reference_id);
  const customerId = stripeObjectId(session.customer);
  const subscriptionId = stripeObjectId(session.subscription);
  const plan = normalizeSelectedPlan(session.metadata?.plan);
  const user = await resolveLockedWebhookUser(db, {
    metadataUserId: Number.isSafeInteger(metadataUserId) && metadataUserId > 0 ? metadataUserId : null,
    customerId,
    subscriptionId,
  });
  if (!user || !customerId || !subscriptionId || !plan) throw new Error('BILLING_CHECKOUT_LINK_INVALID');
  if (user.subscriptionCustomerId && user.subscriptionCustomerId !== customerId) {
    throw new Error('BILLING_CUSTOMER_MISMATCH');
  }
  if (user.subscriptionId && user.subscriptionId !== subscriptionId
    && !['canceled', 'incomplete_expired'].includes(String(user.subscriptionStatus || '').toLowerCase())) {
    throw new Error('BILLING_SUBSCRIPTION_MISMATCH');
  }
  const eventCreatedAt = new Date(event.created * 1000);
  const updated = await db.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { subscriptionEventCreatedAt: null },
        { subscriptionEventCreatedAt: { lt: eventCreatedAt } },
      ],
    },
    data: {
      selectedPlan: plan,
      subscriptionPlan: plan,
      subscriptionProvider: 'stripe',
      subscriptionCustomerId: customerId,
      subscriptionId,
    },
  });
  await db.billingCheckoutAttempt.updateMany({
    where: { providerSessionId: session.id },
    data: { status: 'completed' },
  });
  return {
    userId: user.id,
    plan,
    status: updated.count === 1 ? 'checkout_completed' : 'ignored_stale',
  };
};

const applyInvoiceEvent = async (event: Stripe.Event, paid: boolean, db: Prisma.TransactionClient, current: Stripe.Subscription | undefined) => {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return { userId: null, plan: null, status: 'ignored_non_subscription_invoice' };
  }
  const customerId = stripeObjectId(invoice.customer);
  const user = await resolveLockedWebhookUser(db, { customerId, subscriptionId });
  if (!user) throw new Error('BILLING_USER_NOT_FOUND');
  if (user.subscriptionId && user.subscriptionId !== subscriptionId) {
    throw new Error('BILLING_SUBSCRIPTION_MISMATCH');
  }
  if (customerId && user.subscriptionCustomerId && user.subscriptionCustomerId !== customerId) {
    throw new Error('BILLING_CUSTOMER_MISMATCH');
  }
  if (!customerId || !invoice.id || (paid && invoice.status !== 'paid')) {
    throw new Error('BILLING_INVOICE_INVALID');
  }
  // An invoice payment is not the current subscription state: an older invoice
  // can be paid after cancellation or after a newer invoice has failed.
  if (!current || current.id !== subscriptionId || stripeObjectId(current.customer) !== customerId
    || current.livemode !== isStripeLiveMode()) throw new Error('BILLING_SUBSCRIPTION_MISMATCH');
  if (stripeObjectId(current.latest_invoice) !== invoice.id) {
    return { userId: user.id, plan: null, status: 'ignored_historical_invoice' };
  }
  return applySubscriptionEvent({ ...event, data: { object: current } } as Stripe.Event, db);
};

const processWebhookEvent = async (event: Stripe.Event, db: Prisma.TransactionClient, current: Stripe.Subscription | undefined) => {
  if (event.type === 'checkout.session.completed') return applyCheckoutCompleted(event, db);
  if (event.type.startsWith('customer.subscription.')) return applySubscriptionEvent(event, db);
  if (event.type === 'invoice.paid') return applyInvoiceEvent(event, true, db, current);
  if (event.type === 'invoice.payment_failed') return applyInvoiceEvent(event, false, db, current);
  return { userId: null, plan: null, status: 'ignored' };
};

// Provider I/O is outside the database transaction; it never holds SQL locks.
const prepareInvoiceSubscription = async (event: Stripe.Event) => {
  if (!['invoice.paid', 'invoice.payment_failed'].includes(event.type)) return undefined;
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return undefined;
  if (!invoice.id || !stripeObjectId(invoice.customer) || (event.type === 'invoice.paid' && invoice.status !== 'paid')) {
    throw new Error('BILLING_INVOICE_INVALID');
  }
  return getStripeClient().subscriptions.retrieve(subscriptionId);
};

stripeWebhookRouter.post('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isStripeBillingEnabled()) return billingDisabled(res);
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'STRIPE_RAW_BODY_REQUIRED' });
  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(req.body, String(req.headers['stripe-signature'] || ''));
  } catch {
    return res.status(400).json({ error: 'STRIPE_SIGNATURE_INVALID' });
  }
  if (event.livemode !== isStripeLiveMode()) {
    return res.status(400).json({ error: 'STRIPE_MODE_MISMATCH' });
  }

  let claim: ClaimResult;
  try { claim = await claimWebhookEvent(event); }
  catch (error) {
    if (error instanceof Error && error.message === 'BILLING_EVENT_IDENTITY_CONFLICT') {
      return res.status(409).json({ error: 'BILLING_EVENT_IDENTITY_CONFLICT' });
    }
    throw error;
  }
  if (claim.status === 'processed') return res.json({ received: true, duplicate: true });
  if (claim.status === 'busy') {
    res.setHeader('Retry-After', '5');
    return res.status(409).json({ error: 'STRIPE_EVENT_PROCESSING' });
  }
  const attemptCount = claim.attemptCount;

  try {
    const current = await prepareInvoiceSubscription(event);
    await runDatabaseTransaction(prisma, async db => {
      // This conditional write also locks the receipt row until commit. A
      // reclaimed old worker may neither apply state nor complete/fail its heir.
      const owned = await db.billingWebhookEvent.updateMany({
        where: { id: event.id, status: 'processing', attemptCount }, data: { errorCode: null },
      });
      if (owned.count !== 1) throw new Error('BILLING_EVENT_CLAIM_LOST');
      const result = await processWebhookEvent(event, db, current);
      await appendSecurityAuditInTransaction(db, {
        actorUserId: result.userId,
        actorRole: 'billing_provider',
        action: `billing.webhook.${event.type}`,
        targetType: 'billing_event',
        targetId: event.id,
        metadata: {
          plan: result.plan,
          status: result.status,
          livemode: event.livemode,
        },
      });
      const completed = await db.billingWebhookEvent.updateMany({
        where: { id: event.id, status: 'processing', attemptCount },
        data: { status: 'processed', processedAt: new Date(), errorCode: null },
      });
      if (completed.count !== 1) throw new Error('BILLING_EVENT_CLAIM_LOST');
    });
    return res.json({ received: true });
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)
      ? error.message
      : 'BILLING_EVENT_PROCESSING_FAILED';
    await prisma.billingWebhookEvent.updateMany({
      where: { id: event.id, status: 'processing', attemptCount },
      data: { status: 'failed', errorCode },
    }).catch(() => undefined);
    console.error('Stripe webhook processing failed:', formatLogError(error));
    return res.status(500).json({ error: 'STRIPE_EVENT_PROCESSING_FAILED' });
  }
});

export default router;
