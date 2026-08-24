# India Legal Launch Readiness

This is a counsel-review checklist, not legal advice and not a substitute for a
qualified Indian lawyer. P0 gate `legal-privacy-approval` remains **PENDING**
until counsel reviews the final public policies, customer agreements, actual
vendors, production geography, and the exact release commit.

## Product facts counsel must verify

- DrapixAI is a B2B virtual try-on platform for fashion brands.
- The Standard upper-body pipeline transiently processes a shopper's submitted
  photo and returns a generated preview. It is not used to train DrapixAI or
  third-party models.
- Person photos and previews are not deliberately persisted. Interrupted jobs
  have a 15-minute private cleanup window; image bytes and base64 payloads are
  excluded from application logs.
- Merchant garment assets, product mappings, quality metadata, security audit
  records, billing metadata, and consent records have separate retention needs.
- Shopify launch access is limited to `read_products`; it does not request
  customer, order, payment, or checkout data.

These statements must match the deployed service before publication. The source
of truth for the current implementation is `apps/web/app/privacy/page.tsx`,
`apps/api/src/lib/privacy.ts`, and the retention implementation.

## Required counsel deliverables

1. **Public Privacy Policy**: purpose-specific photo processing notice, no
   training statement, retention and deletion window, security safeguards,
   rights/contact channel, current vendor/subprocessor disclosure, international
   transfer position, and effective date/version history.
2. **Shopper consent text**: clear notice immediately before image upload;
   record consent version, timestamp, brand, and lawful processing context
   without retaining the image itself. Ensure any age/guardian handling is
   appropriate for the brands and markets served.
3. **Terms of Service**: customer responsibilities for image rights, permitted
   use, prohibited use, acceptable-use enforcement, intellectual property,
   availability, limitation of liability, governing law, dispute process,
   suspension, refunds, and change notice. Replace all placeholder language
   before launch.
4. **Merchant agreement and DPA**: controller/processor roles per actual
   processing, documented instructions, confidentiality, technical and
   organizational measures, subprocessors, assistance with data requests and
   incidents, deletion/return at termination, audit rights, and liability.
5. **Subprocessor register**: every real production provider, service purpose,
   data categories, processing location, security contract, and notice/change
   process. Do not publish generic providers as if they are deployed.
6. **Data-subject and merchant request procedure**: verified request intake,
   identity checks, owner/SLA, deletion workflow, immutable metadata-only audit
   trail, and escalation to counsel for legal-hold conflicts.
7. **Security incident procedure**: breach triage, evidence preservation,
   notification decision owner, customer communications, regulator assessment,
   and post-incident remediation. Reconcile it with the security operations
   runbook.
8. **Commercial and tax review**: invoices, GST treatment, payment/refund
   terms, API/SDK usage limits, promotions, and the final price pages.
9. **Intellectual-property review**: trademark ownership/filing plan, code and
   contractor IP assignment, open-source licence inventory, model/checkpoint
   licences, demo-image rights, and customer content warranties.

## Regulatory baseline for the counsel review

Use the current official text rather than summaries. As of this document's
creation, MeitY's Digital Personal Data Protection Rules, 2025 were notified on
13 November 2025. Their commencement is phased: rules 1, 2 and 17-21 commenced
on notification; rule 4 follows after one year; rules 3, 5-16 and 22-23 follow
after eighteen months. The Digital Personal Data Protection Act, 2023 also has
a phased commencement notification. Counsel must determine what is already in
force for DrapixAI's exact launch date and jurisdictions.

Keep the following sources in the release evidence package:

- MeitY, *Digital Personal Data Protection Rules, 2025* and corrigendum.
- Gazette notification G.S.R. 843(E) on DPDP Act commencement.
- The applicable Information Technology Act/rules and any sectoral, consumer,
  advertising, contractual, tax, and cross-border requirements.

## Evidence required to close P0 gate 21

Store a redacted PDF at:

`runtime/launch-evidence/release-record/legal-privacy-approval.pdf`

It must identify:

- qualified reviewer and organization;
- scope reviewed, including the above deliverables and actual providers;
- exact 40-character release commit;
- review date, findings, and accepted exceptions;
- confirmation that all material launch blockers are resolved or expressly
  accepted by an authorized company officer.

Then use `scripts/record-launch-evidence.mjs` to hash and record the artifact.
Never put shopper photos, secrets, customer data, or unredacted contracts in
the release-evidence directory.

## Founder inputs still needed before counsel can approve

- Exact registered entity name, CIN/LLPIN as applicable, registered address,
  support/privacy/legal contact addresses, and governing-law preference.
- Launch countries, customer types, age policy, and whether consumer-facing
  features will operate outside India.
- Final production vendor list, region/data residency, billing processor,
  analytics, email/support tools, and any model-hosting provider.
- Final shopper-photo deletion window and merchant garment-cache retention
  policy.
- Named privacy and incident-response owner plus an escalation contact.

