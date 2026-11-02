# DrapixAI Billing Security Runbook

## Current provider status (27 October 2026)

Razorpay onboarding is deferred at the owner's request until the owner has
power-of-attorney documents. Preserve the existing account flow and local test
evidence. Resume only when the owner is ready; payment-provider acceptance
remains open during this deferral.

The owner has no Stripe account and needs a new company payment account.
Razorpay Subscriptions is the recommended next candidate for Indian merchant
pilots, subject to onboarding, recurring/international capability and pricing
verification. See Task 12 (operational evidence retained privately).

The implementation below is **Stripe-only preparation**, not an operational
payment service or a Razorpay integration. Do not put Razorpay keys in Stripe
configuration or enable paid intake using synthetic credentials.

## Existing Stripe implementation boundary

The prepared code uses Stripe-hosted Checkout and the Stripe customer portal. Card data,
tax identifiers, billing addresses, raw webhook payloads, checkout URLs, and
customer portal URLs are never persisted by DrapixAI. The API stores only the
provider identifiers and subscription state needed to enforce plan access.

Checkout completion does not activate a paid plan. Only a verified Stripe
subscription state can grant paid access. Invoice events retrieve the current
subscription, require matching customer/mode and latest invoice, and use its
configured price/status/period; a paid historical invoice does not reactivate
a canceled subscription. Unknown prices cannot fall back to metadata. Failed, paused,
incomplete, unpaid, and canceled subscriptions fail closed in plan enforcement.

## Stripe setup only if separately selected

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
9. Verify the actual portal configuration allows cancellation at period end
   without proration. The existing portal call uses the provider's default
   configuration; this policy is not yet enforced or verified by the code.

## Verification

Run `npm --prefix apps/api run test:billing-security`. Run the database fixture
only against a separate, disposable loopback PostgreSQL database with migrations
applied and `DRAPIXAI_DISPOSABLE_DB_APPROVAL=I_ACKNOWLEDGE_DISPOSABLE_DATABASE`.
Its database name must include a `test`, `p0` or `disposable` segment, or be the
CI-only `drapixai_launch_gate`. Set `DATABASE_URL` explicitly in the test process;
never use an application's normal environment or point this cleanup fixture at
staging/production data. Launch CI provides its own disposable service and runs
the target-refusal checks before the positive fixture. See
`docs/billing-verification-2026-10-17.md` for the verification scope.

`node scripts/verify-billing-runtime.mjs` creates its own fresh loopback-only
PostgreSQL and Redis, applies the existing SQL migrations, runs accounting and
actual billing routes with real SDK signatures, and removes its own fixtures.
Outbound Stripe operations are synthetic adapters with SDK network disabled.
This proves neither provider delivery nor actual charges, refunds, recurring
mandates, invoice delivery, Google Sheets sync or Razorpay support.

Against the approved staging billing integration, separately prove one
successful purchase, one canceled checkout, one failed-payment event,
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

## Remaining event and invoice work

Subscription snapshot ordering still uses provider event timestamps with a
conservative tie priority. The 1 November local follow-up now commits entitlement/audit/receipt together,
fences reclaimed attempts and re-reads tenant linkage under a lock; its 27-group
HTTP/SQL fixture passes. See Task 6 (operational evidence retained privately).
Full provider reconciliation, payload binding, parallel checkout/cross-event
ordering and actual host/process-death recovery remain unqualified. Invoice state refresh addresses
the tested historical-invoice issue; it does not close these broader gaps.
Refund webhook audit is not a refund executor. Invoice snapshots, tax/issuer
review, a durable delivery outbox and Sheets synchronization are not implemented.
