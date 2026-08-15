import crypto from 'crypto';
import Stripe from 'stripe';
import { normalizeSelectedPlan, type PublicPlanKey } from './plans';

export const STRIPE_API_VERSION = '2026-07-29.dahlia' as const;
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
export const BILLING_CHECKOUT_TTL_MS = 30 * 60 * 1000;
export const BILLING_EVENT_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
export const BILLING_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

let stripeClient: Stripe | null = null;

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
};

export const isStripeBillingEnabled = () => process.env.DRAPIXAI_STRIPE_BILLING_ENABLED === '1';
export const isStripeLiveMode = () => process.env.DRAPIXAI_STRIPE_LIVE_MODE === '1';

export const normalizeBillingIdempotencyKey = (value: unknown) => {
  const key = String(value || '').trim();
  return BILLING_IDEMPOTENCY_KEY_PATTERN.test(key) ? key : null;
};

export const hashBillingIdempotencyKey = (key: string) => crypto
  .createHash('sha256')
  .update(key)
  .digest('hex');

export const getStripeRequestIdempotencyKey = (userId: number, keyHash: string) =>
  `drapixai-checkout-${userId}-${keyHash}`;

export const getBillingRedirectUrls = () => {
  const base = new URL(required('DRAPIXAI_WEB_BASE_URL'));
  return {
    successUrl: new URL('/subscription?billing=success', base).toString(),
    cancelUrl: new URL('/subscription?billing=canceled', base).toString(),
    portalReturnUrl: new URL('/subscription', base).toString(),
  };
};

export const getStripeClient = () => {
  if (!isStripeBillingEnabled()) throw new Error('STRIPE_BILLING_DISABLED');
  if (!stripeClient) {
    stripeClient = new Stripe(required('DRAPIXAI_STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
  }
  return stripeClient;
};

export const getStripeWebhookSecret = () => {
  const secret = required('DRAPIXAI_STRIPE_WEBHOOK_SECRET');
  if (!secret.startsWith('whsec_') || secret.length < 32) {
    throw new Error('STRIPE_WEBHOOK_SECRET_INVALID');
  }
  return secret;
};

const priceEnvironmentName: Record<PublicPlanKey, string> = {
  starter: 'DRAPIXAI_STRIPE_PRICE_STARTER',
  growth: 'DRAPIXAI_STRIPE_PRICE_GROWTH',
  pro: 'DRAPIXAI_STRIPE_PRICE_PRO',
};

export const getStripePriceId = (plan: PublicPlanKey) => {
  const priceId = required(priceEnvironmentName[plan]);
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error('STRIPE_PRICE_ID_INVALID');
  return priceId;
};

export const getStripeCurrency = () => {
  const currency = String(process.env.DRAPIXAI_STRIPE_CURRENCY || '').trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error('STRIPE_CURRENCY_INVALID');
  return currency;
};

export const getPlanForStripePrice = (priceId: unknown): PublicPlanKey | null => {
  const normalized = String(priceId || '').trim();
  for (const plan of Object.keys(priceEnvironmentName) as PublicPlanKey[]) {
    if (normalized && normalized === String(process.env[priceEnvironmentName[plan]] || '').trim()) return plan;
  }
  return null;
};

export const verifyStripeWebhook = (payload: Buffer, signature: string) => {
  if (!signature || signature.length > 2048) throw new Error('STRIPE_SIGNATURE_INVALID');
  return getStripeClient().webhooks.constructEvent(
    payload,
    signature,
    getStripeWebhookSecret(),
    STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  );
};

export const stripeObjectId = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
};

const finiteUnixDate = (value: unknown) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
};

export type StripeSubscriptionSnapshot = {
  customerId: string | null;
  subscriptionId: string | null;
  plan: PublicPlanKey | null;
  status: string;
  currentPeriodEndsAt: Date | null;
  metadataUserId: number | null;
};

export const getStripeSubscriptionSnapshot = (input: unknown): StripeSubscriptionSnapshot => {
  const subscription = (input || {}) as Record<string, any>;
  const items = Array.isArray(subscription.items?.data) ? subscription.items.data : [];
  const priceId = items.map((item: any) => stripeObjectId(item?.price)).find(Boolean) || null;
  const metadataPlan = normalizeSelectedPlan(subscription.metadata?.plan);
  const periodEnds = [
    finiteUnixDate(subscription.current_period_end),
    ...items.map((item: any) => finiteUnixDate(item?.current_period_end)),
  ].filter((value): value is Date => Boolean(value));
  const metadataUserId = Number(subscription.metadata?.drapixai_user_id);

  return {
    customerId: stripeObjectId(subscription.customer),
    subscriptionId: stripeObjectId(subscription.id),
    plan: getPlanForStripePrice(priceId) || metadataPlan,
    status: String(subscription.status || '').trim().toLowerCase(),
    currentPeriodEndsAt: periodEnds.length
      ? new Date(Math.max(...periodEnds.map((date) => date.getTime())))
      : null,
    metadataUserId: Number.isSafeInteger(metadataUserId) && metadataUserId > 0 ? metadataUserId : null,
  };
};

export const getStripeInvoiceSubscriptionId = (input: unknown) => {
  const invoice = (input || {}) as Record<string, any>;
  return stripeObjectId(invoice.subscription)
    || stripeObjectId(invoice.parent?.subscription_details?.subscription)
    || null;
};

export const getBillingStatePriority = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['canceled', 'incomplete_expired'].includes(normalized)) return 100;
  if (['past_due', 'unpaid', 'paused', 'incomplete'].includes(normalized)) return 80;
  if (['active', 'trialing'].includes(normalized)) return 50;
  return 25;
};

export const assertStripeEnvironment = () => {
  if (!isStripeBillingEnabled()) return;
  const secret = required('DRAPIXAI_STRIPE_SECRET_KEY');
  const expectedPrefix = isStripeLiveMode() ? 'sk_live_' : 'sk_test_';
  if (!secret.startsWith(expectedPrefix) || secret.length < 32) {
    throw new Error(`DRAPIXAI_STRIPE_SECRET_KEY_MUST_USE_${expectedPrefix.toUpperCase()}`);
  }
  getStripeWebhookSecret();
  for (const plan of ['starter', 'growth', 'pro'] as PublicPlanKey[]) getStripePriceId(plan);
  getStripeCurrency();
  getBillingRedirectUrls();
};

export const resetStripeClientForTests = () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY_OPERATION');
  stripeClient = null;
};
