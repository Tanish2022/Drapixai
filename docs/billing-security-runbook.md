# DrapixAI Billing Security Runbook

## Boundary

DrapixAI uses Stripe-hosted Checkout and the Stripe customer portal. Card data,
tax identifiers, billing addresses, raw webhook payloads, checkout URLs, and
customer portal URLs are never persisted by DrapixAI. The API stores only the
provider identifiers and subscription state needed to enforce plan access.

Checkout completion does not activate a paid plan. Only a verified Stripe
subscription or paid-invoice event can grant paid access. Failed, paused,
incomplete, unpaid, and canceled subscriptions fail closed in plan enforcement.

## Live Setup

1. Create separate Stripe test and live products and recurring Prices for
   Starter, Growth, and Pro.
2. Configure the live webhook endpoint as
   `https://api.drapixai.com/billing/webhooks/stripe`.
3. Subscribe it to checkout session, customer subscription, invoice paid,
   invoice payment failed, and charge refund events.
4. Put the three live `price_...` identifiers in the production API config.
5. Put the live `sk_live_...` key and endpoint-specific `whsec_...` signing
   secret only in the managed secret provider.
6. Keep `DRAPIXAI_STRIPE_LIVE_MODE=1` in production and `0` in sandbox/staging.
7. Run `bash deploy/scripts/validate-env.sh api` against the resolved runtime
   environment before starting the API.
8. Run `npm --prefix apps/api run billing:verify-catalog` and retain its PASS
   output. Every Price must be active, monthly, licensed, per-unit, in the
   configured currency, and attached to an active Product.

## Verification

Run `npm --prefix apps/api run test:billing-security`. In staging, additionally
run `npm --prefix apps/api run test:billing-database` against the isolated staging
database. Then
prove one successful purchase, one canceled checkout, one failed-payment event,
one duplicate event, one stale signature, and one test/live mode mismatch. Save
redacted evidence containing event IDs and outcomes only. Never save raw event
payloads or Stripe secrets.

## Rotation

1. Create a restricted replacement Stripe key.
2. Update the managed secret version and restart one API replica as a canary.
3. Complete a test Checkout and portal launch.
4. Roll the remaining replicas, revoke the old key, and record the rotation in
   the immutable security audit and operator evidence.
5. For a webhook-secret rotation, create a replacement endpoint or use Stripe's
   controlled signing-secret rotation window. Keep overlap as short as possible,
   verify delivery, then remove the old secret.

## Refunds And Disputes

Refund events are authenticated and audited but do not silently cancel an active
subscription. Operators process refunds through the approved policy, then cancel
or adjust the subscription in Stripe. The resulting signed subscription event is
the source of truth for DrapixAI access.

## Incident Response

If a Stripe key or webhook secret may be exposed, disable billing intake at the
edge, rotate and revoke the credential, inspect immutable audit entries and
provider event delivery, and verify that no entitlement changed without a signed
event. Do not delete webhook-event records during the investigation. Follow the
main security operations runbook for notification, evidence preservation, and
post-incident review.
