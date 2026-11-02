# DrapixAI Shopify App

This directory contains the Shopify app configuration template and Theme App Extension for DrapixAI.

## Architecture

- Embedded App Bridge home, ID-token authentication/owner verification, encrypted
  expiring offline tokens, webhooks, and catalog synchronization run in `apps/api`.
- Merchant account linking runs at `/shopify/connect` in `apps/web`.
- The Theme App Extension in `extensions/drapixai-tryon` places the try-on control on product pages without editing theme code.
- The storefront block fetches a short no-store configuration from the DrapixAI API. The returned SDK key is restricted to the verified Shopify primary domain.

## Partner setup

1. Use the existing development app `DrapixAI Virtual Try-On Dev`; do not create
   another app or install its `setup-only` version as the working integration.
2. Review `shopify.app.development.toml.example` for the development identity.
   Its staging hostname is proposed and not provisioned. The production template
   is separate. Link/import CLI configuration only after reviewing changes.
3. Configure the API environment variables documented in `docs/shopify-launch.md`.
4. Validate the configuration with `python scripts/validate_shopify_config.py`.
5. Verify the reachable HTTPS staging design and secrets before running CLI
   development commands; automatic URL changes are disabled to avoid an
   incidental tunnel/reconfiguration.
6. Review and authorize the exact version before `shopify app deploy` or an
   installation grant. Neither command has been run for the embedded phase.

Do not commit `shopify.app.toml` when it contains account-specific identifiers. The repository ignores that file.

The validator fails closed when credentials are placeholders, URLs are not HTTPS, scopes differ from `read_products,write_app_proxy`, mandatory privacy webhooks are missing, or the Theme App Extension metadata is invalid. To verify the committed template itself, run `python scripts/validate_shopify_config.py shopify.app.toml.example --allow-placeholders`.

This is a preparation template, not App Store approval. The embedded home and
explicit account-link confirmation have local route/browser-adapter tests.
Actual Shopify iframe/App Bridge/privacy-browser behavior remains unverified.
Expiring offline-token
handling has local SQL/HTTP verification but still needs a staging migration,
explicit new-table runtime grants and live provider qualification. The full
merchant experience, including external account linking, still needs review
against current embedded-app requirements before distribution. Paid App Store
charges require Shopify App Pricing/Billing unless Shopify explicitly provides
an exception. See the Task 13 assessment in `docs/` before installing or deploying.
