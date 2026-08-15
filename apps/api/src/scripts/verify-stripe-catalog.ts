import Stripe from 'stripe';
import {
  assertStripeEnvironment,
  getStripeClient,
  getStripeCurrency,
  getStripePriceId,
} from '../lib/billing';
import { PUBLIC_PLAN_KEYS } from '../lib/plans';

const main = async () => {
  assertStripeEnvironment();
  const stripe = getStripeClient();
  const expectedCurrency = getStripeCurrency();
  const priceIds = PUBLIC_PLAN_KEYS.map(getStripePriceId);
  if (new Set(priceIds).size !== priceIds.length) throw new Error('STRIPE_PRICE_IDS_MUST_BE_UNIQUE');

  for (const plan of PUBLIC_PLAN_KEYS) {
    const price = await stripe.prices.retrieve(getStripePriceId(plan), { expand: ['product'] });
    if (!price.active) throw new Error(`STRIPE_PRICE_INACTIVE:${plan}`);
    if (price.type !== 'recurring' || !price.recurring) throw new Error(`STRIPE_PRICE_NOT_RECURRING:${plan}`);
    if (price.recurring.interval !== 'month' || price.recurring.interval_count !== 1) {
      throw new Error(`STRIPE_PRICE_NOT_MONTHLY:${plan}`);
    }
    if (price.recurring.usage_type !== 'licensed') throw new Error(`STRIPE_PRICE_USAGE_TYPE_INVALID:${plan}`);
    if (price.billing_scheme !== 'per_unit' || !price.unit_amount || price.unit_amount <= 0) {
      throw new Error(`STRIPE_PRICE_AMOUNT_INVALID:${plan}`);
    }
    if (price.currency.toLowerCase() !== expectedCurrency) throw new Error(`STRIPE_PRICE_CURRENCY_MISMATCH:${plan}`);
    const product = price.product as Stripe.Product;
    if (!product || typeof product === 'string' || product.deleted || !product.active) {
      throw new Error(`STRIPE_PRODUCT_INACTIVE:${plan}`);
    }
    console.log(`PASS ${plan} monthly recurring Price and active Product (${expectedCurrency.toUpperCase()})`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'STRIPE_CATALOG_VERIFICATION_FAILED');
  process.exit(1);
});
