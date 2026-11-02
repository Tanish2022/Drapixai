# DrapixAI Shopify Launch Guide

27 October 2026: **preparation only, not ready for public installation or App
Store distribution**. Expiring offline-token handling now has local SQL/HTTP
verification; live provider acceptance, the staging migration/runtime grant,
live embedded-app acceptance and Shopify app billing remain open. Embedded home,
ID-token owner verification and explicit workspace confirmation now have local
tests; these do not constitute a Shopify review. See
Task 13 evidence (operational evidence retained privately).

## What is implemented

- Shopify OAuth authorization with signed query and state validation.
- Embedded App Bridge home with HS256 ID-token validation and shop-bound data
  requests; account linking requires a provider-confirmed store owner.
- AES-256-GCM encrypted expiring offline access/refresh tokens with guarded,
  serialized renewal and revocation handling (local verification only).
- One-time, expiring linkage between an authorized store and a signed-in DrapixAI account.
- Separate domain-bound storefront API keys.
- Automatic product and variant catalog synchronization.
- Persistent preparation queue for eligible base-product images; variants synchronize without duplicating GPU preparation work.
- Secure Shopify CDN image ingestion with HTTPS host allowlisting, byte limits, pixel limits, file-signature checks, and no redirect following.
- Product create, update, and delete webhook recovery sync.
- App uninstall, customer data request, customer redact, and shop redact webhook handling.
- Fifteen-minute scheduled recovery for pending webhook synchronization.
- A Theme App Extension product block that loads the brand-adaptive DrapixAI SDK without Liquid editing.
- A post-install Theme Editor deep link that previews the try-on block on the default product template before the merchant saves it.

## Required Shopify Partner steps

1. The development app `DrapixAI Virtual Try-On Dev` already exists.
2. Review `apps/shopify/shopify.app.development.toml.example` for development;
   `shopify.app.toml.example` describes the proposed production shape.
3. Use embedded=true and app URL ending in `/shopify/app`. Production proposal:
   `https://api.drapixai.com/shopify/app`. Development proposal:
   `https://staging-api.drapixai.com/shopify/app` (not provisioned).
4. Set the callback URL to `https://api.drapixai.com/shopify/callback`.
5. Request exactly `read_products,write_app_proxy`: catalog reading and the
   storefront app proxy. This local scope change was approved by the owner on
   27 October 2026; an installation must still obtain the merchant's grant.
6. Register the webhook URL `https://api.drapixai.com/shopify/webhooks`.
7. Run `python apps/shopify/scripts/validate_shopify_config.py apps/shopify/shopify.app.toml`.
8. Test through a Shopify development store before requesting App Store review.

Shopify must initiate public installation. Do not add a form that asks a merchant to type a `myshopify.com` domain; Shopify App Store requirements prohibit that standard installation pattern.

## API environment

```text
DRAPIXAI_SHOPIFY_ENABLED=1
SHOPIFY_API_KEY=<partner app client id>
SHOPIFY_API_SECRET=<partner app client secret>
SHOPIFY_API_VERSION=2026-07
SHOPIFY_SCOPES=read_products,write_app_proxy
SHOPIFY_USE_LEGACY_INSTALL_FLOW=0
DRAPIXAI_SHOPIFY_AUTO_PREPARE=1
DRAPIXAI_SHOPIFY_PREPARE_BATCH_SIZE=3
DRAPIXAI_SHOPIFY_PREPARE_MAX_ATTEMPTS=3
DRAPIXAI_SHOPIFY_IMAGE_HOSTS=cdn.shopify.com,*.shopifycdn.com
DRAPIXAI_PUBLIC_API_BASE_URL=https://api.drapixai.com
DRAPIXAI_WEB_BASE_URL=https://drapixai.com
DRAPIXAI_SHOPIFY_STATE_SECRET=<at least 32 random characters>
DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY=<exactly 32 random bytes encoded as base64>
DRAPIXAI_STOREFRONT_TOKEN_SECRET=<a separate secret of at least 32 random characters>
```

Generate the encryption key on Linux:

```bash
openssl rand -base64 32
```

## Web environment

After Shopify provides a listing or install URL:

```text
NEXT_PUBLIC_SHOPIFY_APP_INSTALL_URL=<Shopify-owned install or listing URL>
```

## Local verification

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:migrate:deploy
npm --prefix apps/api run test:shopify
npm --prefix apps/api run build
npm --prefix apps/web run build
```

Use `prisma:migrate:deploy` for every fresh or migration-managed environment. If an older DrapixAI database was created with `prisma db push`, back it up and verify that it already matches the current schema before marking `20260713150000_initial_launch_schema` as applied with `prisma migrate resolve`; never run the initial migration directly against populated tables.

CLI dev/deploy changes are not an account-setup step. Import/link the existing
app, inspect its diff and review the reachable host before running them.
Automatic URL changes are disabled; no public tunnel is authorized by this guide.

## Security behavior

- Offline tokens are never returned to the browser.
- Shopify-managed installation owns the requested scope set. Embedded calls
  validate a fresh App Bridge ID token, derive the tenant from its destination,
  and verify account-owner authority before offline exchange/handoff. The
  authorization-code routes remain a separately tested fallback; they are not
  the embedded application_url.
- Storefront keys are public-client credentials but remain restricted to the verified primary storefront domain.
- Dashboard management operations require the signed DrapixAI dashboard session and dashboard proxy token.
- Webhooks require Shopify HMAC validation and are idempotent by webhook ID.
- Busy/reclaimed webhook attempts keep retry semantics; a processing delivery
  does not receive a success acknowledgement merely because its ID exists.
- Store-link token consumption and key creation share a transaction and are
  serialized across replicas. A stale token cannot leave an orphan active key.
- A signed-in workspace previews the server-validated shop, then explicitly
  confirms linking. Merely opening a handoff URL no longer attaches a store.
- Storefront configuration is delivered only through Shopify's signed app proxy and uses a five-minute credential; the permanent key remains server-side.
- Uninstall deactivates the storefront key and removes the stored offline token.
- Shop-redact removes Shopify-origin catalog records and installation data.
- Versioned garment objects use the existing version-aware eraser. Failures
  retain database references for retry; erasure requires versioning and the
  corresponding version-list/delete permissions.
- Catalog synchronization only queues preparation. The worker is explicitly enabled with `DRAPIXAI_SHOPIFY_AUTO_PREPARE=1`, retries transient failures with backoff, and never publishes a prepared garment until review and product confirmation are complete.

## GPU-off workflow

Keep `DRAPIXAI_SHOPIFY_AUTO_PREPARE=0` while the AI worker is offline. Shopify catalog synchronization will continue and eligible base products remain queued without consuming retry attempts. Set it to `1` only after `/ready` confirms the AI service is healthy, then restart the API or use the protected **Prepare next batch** action.

## External steps still required

The organization, development store and app identity exist. End-to-end tests
still need privately installed app credentials, current schema/runtime grants,
reviewed reachable HTTPS endpoints and Shopify CLI authentication/configuration.

Expiring offline tokens, encrypted refresh persistence and guarded renewal have
local verification. Actual provider rotation, expiry/revocation/reinstall and
lost-response recovery still need live evidence.
Do not work around this by creating a legacy app. API version `2026-07` stays
pinned until a tested upgrade; do not change it just to select the newest date.

Paid App Store app charges require Shopify App Pricing or Shopify Billing
unless Shopify explicitly authorizes an exception. Razorpay preparation for
direct/private-site customers is not that authorization. The standalone app
experience still needs review against current embedded-app requirements
before submission. Do not deploy placeholder production URLs or start a
public tunnel as an incidental part of account setup.

Follow the staging acceptance plan (operational evidence retained privately).
