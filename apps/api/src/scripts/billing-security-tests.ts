import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  assertStripeEnvironment,
  getBillingRedirectUrls,
  getBillingStatePriority,
  getPlanForStripePrice,
  getStripeClient,
  getStripeInvoiceSubscriptionId,
  getStripeRequestIdempotencyKey,
  getStripeSubscriptionSnapshot,
  hashBillingIdempotencyKey,
  normalizeBillingIdempotencyKey,
  resetStripeClientForTests,
  verifyStripeWebhook,
} from '../lib/billing';
import { getPlanAccessContext } from '../lib/plans';
import { getUsagePeriodBounds } from '../lib/usage';

process.env.NODE_ENV = 'test';
process.env.DRAPIXAI_STRIPE_BILLING_ENABLED = '1';
process.env.DRAPIXAI_STRIPE_LIVE_MODE = '0';
process.env.DRAPIXAI_STRIPE_SECRET_KEY = `sk_test_${'a'.repeat(48)}`;
process.env.DRAPIXAI_STRIPE_WEBHOOK_SECRET = `whsec_${'b'.repeat(48)}`;
process.env.DRAPIXAI_STRIPE_PRICE_STARTER = 'price_starterSecure';
process.env.DRAPIXAI_STRIPE_PRICE_GROWTH = 'price_growthSecure';
process.env.DRAPIXAI_STRIPE_PRICE_PRO = 'price_proSecure';
process.env.DRAPIXAI_STRIPE_CURRENCY = 'usd';
process.env.DRAPIXAI_WEB_BASE_URL = 'https://dashboard.drapixai.example/base';
resetStripeClientForTests();

const checks: string[] = [];
const check = (name: string, callback: () => void) => {
  callback();
  checks.push(name);
};

check('billing environment validates test-mode secrets and fixed prices', () => {
  assert.doesNotThrow(() => assertStripeEnvironment());
  assert.equal(getPlanForStripePrice('price_growthSecure'), 'growth');
  assert.equal(getPlanForStripePrice('price_unknown'), null);
});

check('checkout and portal redirects are server-owned HTTPS URLs', () => {
  const urls = getBillingRedirectUrls();
  assert.equal(urls.successUrl, 'https://dashboard.drapixai.example/subscription?billing=success');
  assert.equal(urls.cancelUrl, 'https://dashboard.drapixai.example/subscription?billing=canceled');
  assert.equal(urls.portalReturnUrl, 'https://dashboard.drapixai.example/subscription');
});

check('idempotency keys are constrained and irreversibly hashed', () => {
  const key = 'checkout-test-1234567890';
  assert.equal(normalizeBillingIdempotencyKey(key), key);
  assert.equal(normalizeBillingIdempotencyKey('short'), null);
  assert.equal(normalizeBillingIdempotencyKey('invalid key with spaces'), null);
  const digest = hashBillingIdempotencyKey(key);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(getStripeRequestIdempotencyKey(42, digest), `drapixai-checkout-42-${digest}`);
});

const eventPayload = JSON.stringify({
  id: 'evt_secure_billing_test',
  object: 'event',
  api_version: '2026-07-29.dahlia',
  created: Math.floor(Date.now() / 1000),
  data: { object: { id: 'sub_secure_test' } },
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type: 'customer.subscription.updated',
});

check('valid Stripe signature authenticates the untouched raw body', () => {
  const signature = getStripeClient().webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: process.env.DRAPIXAI_STRIPE_WEBHOOK_SECRET!,
  });
  const event = verifyStripeWebhook(Buffer.from(eventPayload), signature);
  assert.equal(event.id, 'evt_secure_billing_test');
  assert.equal(event.livemode, false);
});

check('modified webhook body is rejected', () => {
  const signature = getStripeClient().webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: process.env.DRAPIXAI_STRIPE_WEBHOOK_SECRET!,
  });
  assert.throws(() => verifyStripeWebhook(Buffer.from(`${eventPayload} `), signature));
});

check('stale webhook timestamp is rejected', () => {
  const signature = getStripeClient().webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: process.env.DRAPIXAI_STRIPE_WEBHOOK_SECRET!,
    timestamp: Math.floor(Date.now() / 1000) - 301,
  });
  assert.throws(() => verifyStripeWebhook(Buffer.from(eventPayload), signature));
});

check('subscription snapshot maps provider price and preserves period boundary', () => {
  const periodEnd = Math.floor(Date.now() / 1000) + 3600;
  const snapshot = getStripeSubscriptionSnapshot({
    id: 'sub_secure_test',
    customer: 'cus_secure_test',
    status: 'active',
    metadata: { drapixai_user_id: '42', plan: 'starter' },
    items: {
      data: [{ price: { id: 'price_proSecure' }, current_period_end: periodEnd }],
    },
  });
  assert.equal(snapshot.customerId, 'cus_secure_test');
  assert.equal(snapshot.subscriptionId, 'sub_secure_test');
  assert.equal(snapshot.plan, 'pro');
  assert.equal(snapshot.metadataUserId, 42);
  assert.equal(snapshot.currentPeriodEndsAt?.getTime(), periodEnd * 1000);
});

check('invoice subscription lookup supports the current nested Stripe shape', () => {
  assert.equal(getStripeInvoiceSubscriptionId({
    parent: { subscription_details: { subscription: { id: 'sub_nested' } } },
  }), 'sub_nested');
});

check('paid quota period follows the exact monthly provider boundary', () => {
  const period = getUsagePeriodBounds({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    planType: 'growth',
    subscriptionProvider: 'stripe',
    subscriptionCurrentPeriodEndsAt: new Date('2026-03-31T18:30:00.000Z'),
  }, new Date('2026-03-10T00:00:00.000Z'));
  assert.equal(period.source, 'subscription');
  assert.equal(period.periodStart.toISOString(), '2026-02-28T18:30:00.000Z');
  assert.equal(period.periodEnd.toISOString(), '2026-03-31T18:30:00.000Z');
});

check('stale Stripe entitlement fails closed after the renewal grace window', () => {
  const access = getPlanAccessContext({
    planType: 'pro',
    subscriptionStatus: 'active',
    subscriptionProvider: 'stripe',
    subscriptionCurrentPeriodEndsAt: '2026-08-01T00:00:00.000Z',
    at: '2026-08-01T00:15:00.000Z',
  });
  assert.equal(access.active, false);
  assert.equal(access.blockedReason, 'SUBSCRIPTION_PERIOD_EXPIRED');
});

check('same-second state ordering favors conservative billing outcomes', () => {
  assert(getBillingStatePriority('canceled') > getBillingStatePriority('past_due'));
  assert(getBillingStatePriority('past_due') > getBillingStatePriority('active'));
});

const repositoryRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(repositoryRoot, relative), 'utf8');

check('webhook raw body is mounted before global JSON parsing', () => {
  const server = read('apps/api/src/server.ts');
  const rawMount = server.indexOf("app.use('/billing/webhooks/stripe', express.raw");
  const jsonMount = server.indexOf("app.use(express.json({ limit: '10mb' }))");
  assert(rawMount >= 0 && jsonMount > rawMount);
});

check('billing endpoints require dashboard proxy, dashboard key, and distributed limits', () => {
  const route = read('apps/api/src/routes/billing.ts');
  assert(route.includes('router.use(requireDashboardProxy)'));
  assert(route.includes("activeKey.kind !== 'dashboard'"));
  assert(route.includes('createRateLimitMiddleware('));
  assert(route.includes('IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_PLAN'));
  assert(route.includes('USE_BILLING_PORTAL_FOR_EXISTING_SUBSCRIPTION'));
});

check('webhook replay claim and mode separation are durable contracts', () => {
  const route = read('apps/api/src/routes/billing.ts');
  const schema = read('apps/api/prisma/schema.prisma');
  assert(route.includes('claimWebhookEvent(event)'));
  assert(route.includes('event.livemode !== isStripeLiveMode()'));
  assert(route.includes("status: 'processed'"));
  assert(route.includes('subscriptionEventPriority: { lte: eventPriority }'));
  assert(schema.includes('model BillingWebhookEvent'));
  assert(schema.includes('id                String    @id'));
});

check('checkout cannot activate access and webhooks own entitlement changes', () => {
  const route = read('apps/api/src/routes/billing.ts');
  const checkoutStart = route.indexOf('const applyCheckoutCompleted');
  const subscriptionStart = route.indexOf('const applySubscriptionEvent');
  const checkoutBlock = route.slice(checkoutStart, route.indexOf('const applyInvoiceEvent'));
  assert(!checkoutBlock.includes('planType:'));
  assert(subscriptionStart >= 0);
  assert(route.includes('planType: active ? snapshot.plan'));
  assert(route.includes("planType: paid ? plan"));
  assert(route.includes("status: 'ignored_non_subscription_invoice'"));
  assert(route.includes("throw new Error('BILLING_CUSTOMER_MISMATCH')"));
});

check('dashboard proxy forwards idempotency only to allowlisted billing actions', () => {
  const proxy = read('apps/web/app/api/dashboard/proxy/[...path]/route.ts');
  assert(proxy.includes("new Set(['checkout', 'portal'])"));
  assert(proxy.includes("headers.set('Idempotency-Key', idempotencyKey)"));
});

console.log(`Billing security tests passed (${checks.length}):`);
for (const name of checks) console.log(`- ${name}`);
