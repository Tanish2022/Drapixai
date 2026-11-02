# DrapixAI Brand Outreach

This directory contains reviewed lead metadata and the durable outreach suppression list. It must not contain SMTP credentials, customer data, shopper photos, or exported platform databases.

Merchant search/answer discovery preparation, content priorities and the later
public-indexing checklist are in Task 16 (operational evidence retained privately).
Local preparation does not authorize publication, outreach or search submissions.

The proposed small-store founding pilot is documented in
the programme draft (operational evidence retained privately), with
initial research (operational evidence retained privately). Benefits are proposals;
the documents do not authorize messaging, change pricing or certify readiness.

The Task 17 operational packet (operational evidence retained privately)
provides blank merchant/permissions, activation, evaluation/feedback and
offboarding/exit worksheets. No researched prospect is a confirmed client.

Use `brand-leads-template.csv` as a research worksheet. Do not populate an email until the public business source, role, relevance, and manual approval have been checked. A populated row is still blocked when `approved_to_contact` is not `yes` or when its address appears in `outreach-suppression.csv`.

Available message variants:

- `pilot`: garment-faithful, evidence-first product pilot
- `shopify`: controlled Shopify storefront integration pilot

Run `npm --prefix apps/api run email:outreach:preview` with `OUTREACH_DRY_RUN=true` before any live batch. Read [email-operations.md](../docs/email-operations.md) for the complete process.
