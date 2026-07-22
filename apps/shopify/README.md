# DrapixAI Shopify App

This directory contains the Shopify app configuration template and Theme App Extension for DrapixAI.

## Architecture

- Shopify authorization, encrypted offline tokens, webhooks, and catalog synchronization run in `apps/api`.
- Merchant account linking runs at `/shopify/connect` in `apps/web`.
- The Theme App Extension in `extensions/drapixai-tryon` places the try-on control on product pages without editing theme code.
- The storefront block fetches a short no-store configuration from the DrapixAI API. The returned SDK key is restricted to the verified Shopify primary domain.

## Partner setup

1. Create a public app in the Shopify Dev Dashboard.
2. Copy `shopify.app.toml.example` to `shopify.app.toml` and replace the client ID and production URLs.
3. Configure the API environment variables documented in `docs/shopify-launch.md`.
4. Validate the configuration with `python scripts/validate_shopify_config.py`.
5. Run `shopify app dev` from this directory against a Shopify development store.
6. Deploy the app configuration and extension with `shopify app deploy`.

Do not commit `shopify.app.toml` when it contains account-specific identifiers. The repository ignores that file.

The validator fails closed when credentials are placeholders, URLs are not HTTPS, scopes exceed `read_products`, mandatory privacy webhooks are missing, or the Theme App Extension metadata is invalid. To verify the committed template itself, run `python scripts/validate_shopify_config.py shopify.app.toml.example --allow-placeholders`.
