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

## Policy hardening review - 7 September 2026

Status: preparation only; security certification and legal approval remain open.
No production deployment, legal sign-off, commercial licence, or compliance
certification is established by this review. Complete the security evidence
first, then reconcile the final policies against the exact deployed release.

### Immediate corrections made

- Terms now limit shopper-image processing to the requested service and repeat
  the no-training promise, instead of broadly licensing images to improve the
  service. This wording still requires operational and vendor-contract proof.
- Terms distinguish DrapixAI-owned materials from third-party models/software.
- Removed the public drafting placeholder for a liability cap. Counsel must
  still settle the actual commercial allocation of liability; no monetary cap
  or governing court has been invented.
- Clarified that generated previews do not guarantee sizing or physical fit.

### Unresolved publication and commercial-launch blockers

| Area | Required work and proof | Owner |
| --- | --- | --- |
| Entity identity | Registered legal name, address, registration identifiers as applicable, working legal/privacy contact and grievance escalation; consistent across policies, invoices and contracts. | Founder + counsel |
| Commercial model rights | Verify rights for the exact deployed code, checkpoints, base model and preprocessing dependencies. CatVTON publicly states CC BY-NC-SA 4.0 for its code, checkpoints and demo. Obtain a sufficient written commercial grant from the relevant rights holders or approve a commercially permitted alternative before paid use; do not assume a free brand pilot is exempt. | Founder + IP counsel |
| Privacy notice | Identify purposes, actual processing roles, legal basis, recipients, locations, withdrawal/request channels, applicable age handling and effective policy version. Replace the generic possible-vendor list with verified providers. | Privacy owner + counsel |
| Retention | Prove the stated 15-minute interrupted-job cleanup across retries, crashes and temporary storage; cover backups, queue payloads and support attachments. Define separate schedules for consent, billing, account, garment and security records. Do not turn a no-training promise into a claim that no personal data is ever processed or retained. | Engineering + privacy owner |
| Cookies and marketing | Inventory actual cookies/SDKs and lifetimes; remove future-tense drafting notes from public notices after implementation is verified. Establish applicable consent, unsubscribe and suppression handling, separate from OTP/security mail. | Engineering + counsel |
| Merchant contracts | Finalize DPA, subprocessor schedule, security annex, incident assistance, termination/deletion, content rights, accepted use, SLA and liability terms. Confirm fiduciary/processor roles per activity, not solely by contract label. | Counsel + founder |
| Billing | Match SDK/API prices, credits, failed-job charging, renewals, cancellation method, refunds, GST and export invoicing to tested checkout and ledger behaviour. | Founder + accountant + counsel |
| Claims and assets | Verify published quality/latency claims against test conditions; distinguish targets from guarantees and roadmap from supported scope. Secure model releases and garment/demo image rights before public use. | Product + counsel |
| Incident obligations | Determine applicable CERT-In reporting, designated contact, time synchronization and log requirements; document the on-call procedure and a timed drill. Reconcile these with deletion and legal-hold rules. | Security owner + counsel |

### India-specific review boundaries

- The official MeitY publication includes final DPDP Rules, a corrigendum and
  enforcement timeline. Review the Act and Rules commencement separately for
  the actual launch date; do not treat every DPDP requirement as already in
  force, or assume phased commencement removes existing obligations.
- CERT-In's 28 April 2022 directions include reporting specified incidents
  within six hours of noticing them or being informed, a designated contact,
  clock synchronization and rolling 180-day ICT log retention in India for
  covered entities. Counsel must confirm applicability and current amendments.
  Required security logs are not permission to log shopper images, credentials
  or unrestricted request bodies. Preserve necessary metadata with access
  controls and an approved retention schedule.
- Counsel should assess the applicable IT Act/rules, consumer/e-commerce and
  advertising obligations, electronic contracting, IP, and cross-border
  requirements for the actual service. The accountant should assess GST and
  invoicing. Indian company registration alone does not establish compliance.

### Official and upstream sources checked

- [MeitY: DPDP Rules, corrigendum and enforcement timeline](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit)
- [CERT-In: directions and FAQs](https://www.cert-in.org.in/Directions70B.jsp)
- [CERT-In: 28 April 2022 directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)
- [CatVTON: published licence statement](https://github.com/Zheng-Chong/CatVTON#license)

Keep confidential licence agreements and counsel correspondence in restricted
company storage. Reference redacted approval evidence in the release record.
Do not close `legal-privacy-approval` based on this checklist or policy edits.
