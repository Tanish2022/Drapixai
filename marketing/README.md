# DrapixAI Brand Outreach

This directory contains reviewed lead metadata and the durable outreach suppression list. It must not contain SMTP credentials, customer data, shopper photos, or exported platform databases.

Use `brand-leads-template.csv` as a research worksheet. Do not populate an email until the public business source, role, relevance, and manual approval have been checked. A populated row is still blocked when `approved_to_contact` is not `yes` or when its address appears in `outreach-suppression.csv`.

Available message variants:

- `pilot`: garment-faithful, evidence-first product pilot
- `shopify`: controlled Shopify storefront integration pilot

Run `npm --prefix apps/api run email:outreach:preview` with `OUTREACH_DRY_RUN=true` before any live batch. Read [email-operations.md](../docs/email-operations.md) for the complete process.
