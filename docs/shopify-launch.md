# DrapixAI Shopify Launch Guide

## What is implemented

- Shopify OAuth authorization with signed query and state validation.
- AES-256-GCM encrypted offline access tokens.
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

1. Create a Shopify Partner/Dev Dashboard app named `DrapixAI Virtual Try-On`.
2. Use `apps/shopify/shopify.app.toml.example` as the configuration template.
3. Set the app URL to `https://api.drapixai.com/shopify/install`.
4. Set the callback URL to `https://api.drapixai.com/shopify/callback`.
5. Grant only `read_products` for the first launch.
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
SHOPIFY_SCOPES=read_products
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

Use Shopify CLI from `apps/shopify` after copying the example configuration:

```bash
shopify app dev
```

## Security behavior

- Offline tokens are never returned to the browser.
- Shopify-managed installation owns the requested scope set; the standalone app uses authorization-code grant only to acquire its offline token and rejects incomplete grants.
- Storefront keys are public-client credentials but remain restricted to the verified primary storefront domain.
- Dashboard management operations require the signed DrapixAI dashboard session and dashboard proxy token.
- Webhooks require Shopify HMAC validation and are idempotent by webhook ID.
- Storefront configuration is delivered only through Shopify's signed app proxy and uses a five-minute credential; the permanent key remains server-side.
- Uninstall deactivates the storefront key and removes the stored offline token.
- Shop-redact removes Shopify-origin catalog records and installation data.
- Catalog synchronization only queues preparation. The worker is explicitly enabled with `DRAPIXAI_SHOPIFY_AUTO_PREPARE=1`, retries transient failures with backoff, and never publishes a prepared garment until review and product confirmation are complete.

## GPU-off workflow

Keep `DRAPIXAI_SHOPIFY_AUTO_PREPARE=0` while the AI worker is offline. Shopify catalog synchronization will continue and eligible base products remain queued without consuming retry attempts. Set it to `1` only after `/ready` confirms the AI service is healthy, then restart the API or use the protected **Prepare next batch** action.

## External steps still required

The implementation cannot be exercised end to end until real Shopify Partner credentials, a development store, public HTTPS callback URLs, and Shopify CLI authentication are available.
