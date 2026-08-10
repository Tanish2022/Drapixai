# DrapixAI Public Launch Readiness Checklist

Last updated: 2026-07-30

This is the final go/no-go checklist for the first DrapixAI public release. The
launch scope is **Standard upper-body virtual try-on only**. A checked
implementation item means the control exists in the repository; it does not
replace dated evidence from the exact release commit.

## Launch Decision

- [ ] Every P0 item below is complete.
- [ ] `npm run launch:report` reports `PASS` for the exact clean release commit.
- [ ] No unresolved critical or high security finding exists.
- [ ] The founders sign the release record and approve public traffic.

If any item above is incomplete, the decision is **NO-GO**.

## 1. Freeze The Public Product Scope

- [x] CatVTON is the only public try-on engine.
- [x] Standard is the only public quality mode.
- [x] Public generation uses one candidate.
- [x] SDK and REST API use the same try-on handler and quality path.
- [ ] Keep lower-body and full-body routes disabled in production until their
      separate matrices and manual reviews pass.
- [ ] Record the final supported garment list: shirts, T-shirts, polos,
      hoodies/sweatshirts, blouses/tops, short kurtis, and sleeveless tops.
- [ ] Remove or revise every website claim that exceeds the verified launch
      scope, latency, garment coverage, or quality evidence.

Evidence:

- Release commit and production environment values
- Screenshot or export of final public claims
- Feature-flag verification showing future try-on modes disabled

## 2. Freeze The Release Commit

- [ ] Separate intended launch changes from unrelated or experimental changes.
- [ ] Confirm no secret, `.env` file, model weight, shopper image, customer
      data, runtime output, or test result is tracked by Git.
- [ ] Commit the exact release candidate and record its 40-character SHA.
- [ ] Tag the approved release.
- [ ] Copy `deploy/launch-evidence.example.json` to
      `runtime/launch-evidence/approved-evidence.json`.
- [ ] Put the release SHA, verifier, timestamp, artifact path, and SHA-256 digest on every
      external gate. Store redacted artifacts only beneath `runtime/launch-evidence/`.

Required command:

```bash
npm run launch:report:repository
```

## 3. Repository And CI Gates

- [x] Executable repository gates are defined in `deploy/launch-gates.json`.
- [x] GitHub Actions covers builds, migrations, authorization, storefront
      tokens, CORS, upload security, Shopify contracts, dependency audits,
      Python contracts, secret scanning, and container scanning.
- [ ] All repository gates pass on the exact clean release commit.
- [ ] GitHub Actions is green on the exact release commit.
- [ ] API and web production dependency audits have no unresolved high or
      critical finding.
- [ ] API, web, and exact AI production image scans have no unresolved high or
      critical finding.
- [ ] Prisma migrations apply to a disposable PostgreSQL database.
- [ ] Immutable audit database triggers reject update and delete operations.
- [ ] Hardened edge and AI Compose manifests render from production templates.
- [ ] Production CSP passes and contains no `unsafe-inline`.

Required commands:

```bash
npm run launch:report:repository
npm --prefix apps/api run test:audit-immutability
```

## 4. AI Quality And Target GPU

- [ ] Run the rights-cleared 50-case upper-body matrix on the exact production
      AI image and target GPU.
- [ ] Every accepted case uses Standard, one candidate, and the approved
      garment cache.
- [ ] Every public matrix result meets the approved `0.95` quality threshold.
- [ ] No public matrix result contains a warning.
- [ ] Face, body, pose, hands, background, garment color, print/logo, texture,
      sleeve, collar, and hem preservation pass manual review.
- [ ] Warm end-to-end shopper latency meets the advertised 10-12 second target.
- [ ] SDK output matches direct Standard output for identical person, product,
      cache, seed/settings, and generation environment.
- [ ] Three simultaneous shopper requests are tested on the RTX PRO 6000 96 GB
      workstation without OOM, worker crash, quality regression, starvation,
      or hidden error.
- [ ] If three requests cannot remain inside the approved user-experience
      target, reduce concurrency and publish honest queue behavior.
- [ ] Cold start, model reload, malformed input, GPU OOM, worker restart, and
      queue recovery behavior are tested.
- [ ] Human reviewers approve the final catalog; automated score alone is not
      sufficient.

Evidence:

- `release-record/upper-body-50-summary.json`
- Before/garment/after catalog
- Direct-versus-SDK comparison
- Three-user latency, VRAM, GPU utilization, and failure report

## 5. SDK, Shopify And Public API

- [x] Browser SDK supports upload, consent, close, reset, download, buy, and
      brand-adaptive styling.
- [x] Storefront credentials are short-lived and product-scoped.
- [x] Permanent server keys are forbidden in browsers and mobile binaries.
- [x] Public REST API is versioned under `/v1`.
- [x] OpenAPI, idempotency, usage reporting, and signed webhooks exist.
- [x] Product mapping and DrapixAI-Ready garment cache are required.
- [ ] Install the Shopify app and Theme App Extension on a real test store.
- [ ] Prove automatic product and variant synchronization.
- [ ] Prove garment preprocessing, review, approval, cache regeneration, and
      storefront publication with real products.
- [ ] Test SDK modal close, consent, upload, retry, download, buy, and error
      states on Chrome, Edge, Safari, Android, and iOS.
- [ ] Test responsive behavior at phone, tablet, laptop, and wide desktop
      widths.
- [ ] Run REST API onboarding from a clean customer account using only public
      documentation.
- [ ] Verify API and SDK return identical quality and latency metadata.
- [ ] Verify idempotent retries never consume quota twice.
- [ ] Verify HTTP 422 quality rejection never consumes quota.
- [ ] Verify quota exhaustion returns HTTP 429 without automatic overage.
- [ ] Deliver one working mobile integration example before marketing native
      mobile-app support.

## 6. Pricing, Billing And Commercial Controls

- [x] Public pricing defines Starter, Growth, Pro, and Enterprise quotas.
- [x] SDK and REST API share the account quota.
- [x] Only the first successful publishable result consumes a unit.
- [ ] Connect the production payment provider.
- [ ] Test subscription creation, renewal, upgrade, downgrade, cancellation,
      failed payment, invoice, refund, and webhook replay.
- [ ] Confirm dashboard quota and billing records match successful API usage.
- [ ] Configure GST/tax handling, invoice identity, currency, and accounting
      process with a qualified professional.
- [ ] Approve enterprise order form, data-processing terms, support scope,
      service limits, and any SLA.
- [ ] Verify pricing, terms, refund policy, dashboard, invoices, and sales
      material use the same plan names and limits.

## 7. Production Infrastructure And Network

- [ ] Provision physically separate production and sandbox PostgreSQL, Redis,
      object-storage buckets, secrets, keys, and private AI endpoints.
- [ ] Put an upstream DDoS/WAF edge in front of public HTTPS. Cloudflare Free
      or another reviewed equivalent is acceptable for the initial launch.
- [ ] Configure the hardware firewall with deny-by-default inbound rules.
- [ ] Permit public traffic only to HTTPS through the approved edge.
- [ ] Permit SSH and administrative services only through Tailscale or another
      approved VPN with MFA.
- [ ] Keep PostgreSQL, Redis, object-storage administration, model services,
      RQ workers, and GPU management off the public internet.
- [ ] Put the GPU workstation, office devices, management interfaces, and
      guest Wi-Fi on separate VLANs.
- [ ] Use private DNS and authenticated TLS or mTLS between Node API and AI.
- [ ] Store production secrets in a managed secret store or permission-checked
      read-only secret mount.
- [ ] Configure UPS monitoring, automatic recovery, temperature alerts, and a
      safe GPU shutdown procedure.
- [ ] Verify domain, DNS, HTTPS certificates, origin firewall, and email DNS.

Evidence:

- Network diagram and firewall export
- Private-listener verification
- Sandbox/production isolation report
- VPN and operator-access test

## 8. Security And Abuse Resistance

- [x] IP, server-key, API-key, tenant, quota, and GPU-concurrency controls exist.
- [x] Tenant-scoped data access and immutable security audit logging exist.
- [x] Image signature and decompression-bomb defenses exist.
- [x] Webhook secrets are encrypted and deliveries are signed.
- [ ] Run the live two-tenant security harness against production-like staging.
- [ ] Test IDOR, cross-tenant access, expired/replayed token, wrong-origin
      token, privilege escalation, forged upload, SSRF, CSRF, CORS, and rate
      limit bypass.
- [ ] Run the approved staging web/API scanner.
- [ ] Commission an authorized independent penetration test.
- [ ] Remediate and retest every critical and high finding.
- [ ] Assign an owner, accepted-risk rationale, and remediation date to every
      accepted medium finding.
- [ ] Verify the immutable staging audit chain after attack testing.
- [ ] Test server-key, webhook-key, JWT, database, storage, and operator-key
      rotation and revocation.

Required commands:

```bash
npm --prefix apps/api run test:security:live
npm --prefix apps/api run security:audit:verify
```

## 9. Privacy, Retention And Legal

- [x] Privacy, terms, refund, and cookie pages exist.
- [x] Shopper consent language exists in the SDK.
- [x] Retention purge and customer-deletion tooling exist.
- [ ] Obtain Indian legal review of privacy, terms, refund, cookies, data
      processing, consent, and international subprocessors.
- [ ] Confirm the public policy and SDK use the same retention periods.
- [ ] Schedule the production retention purge and monitor every run.
- [ ] Prove 30-day shopper image/result deletion, URL clearing, failure retry,
      and immutable audit evidence in staging.
- [ ] Prove account deletion, Shopify uninstall/redact, and brand data export.
- [ ] Publish whether shopper images are used for training. Default launch
      policy should be no training without separate explicit consent.
- [ ] Document breach notification, privacy request, and law-enforcement
      request handling.

Required commands:

```bash
npm --prefix apps/api run tryon:purge-review-retention -- --dry-run
npm --prefix apps/api run tryon:purge-review-retention -- --confirm
```

## 10. Reliability, Monitoring And Operations

- [ ] Deploy health, latency, quality, authentication, quota, queue, GPU,
      storage, database, webhook, and worker metrics.
- [ ] Deliver test alerts to named on-call operators.
- [ ] Publish and monitor the status page.
- [ ] Define warning and critical thresholds for queue depth and failure rate.
- [ ] Run backup, restore, rollback, worker-restart, and database-failover
      drills.
- [ ] Test key rotation, breach response, customer deletion, and outage
      tabletop exercises with named operators.
- [ ] Document deploy, rollback, emergency disable, GPU maintenance, and
      customer communication procedures.
- [ ] Confirm support and privacy inboxes are monitored.
- [ ] Define support hours, severity levels, first-response targets, and
      escalation contacts.
- [ ] Maintain spare storage, replacement parts, and a temporary rented-GPU
      fallback plan for workstation failure.

## 11. Brand Onboarding And Support

- [ ] A new brand can register, verify email, connect a store, sync products,
      prepare a garment, approve its cache, install the widget, and complete a
      test try-on without DrapixAI engineering access.
- [ ] Failed onboarding states explain the problem and provide a recovery path.
- [ ] Public documentation covers Shopify, HTML, React, REST API, webhooks,
      image requirements, cache rules, billing, security, and troubleshooting.
- [ ] Prepare a brand onboarding checklist and one realistic integration guide.
- [ ] Prepare before/garment/after examples using rights-cleared assets.
- [ ] Prepare the supported-garment certification explanation.
- [ ] Prepare a demo video and sales demo account with no customer data.
- [ ] Train both founders to perform onboarding, cache regeneration, rollback,
      and first-line support without developer assistance.

## 12. Controlled Rollout

- [ ] Complete internal testing on the exact production stack.
- [ ] Launch with one friendly pilot brand and a small certified catalog.
- [ ] Use a tenant feature flag and traffic cap.
- [ ] Review quality, warnings, latency, queue time, failures, conversion
      events, privacy requests, and support tickets daily.
- [ ] Expand to 3-5 pilot brands only after the first pilot remains stable.
- [ ] Keep a one-command or one-control emergency disable for try-on creation.
- [ ] Keep the previous production image and database rollback evidence.
- [ ] Announce general availability only after the pilot exit criteria pass.

## Required P0 Evidence Files

The release record must contain, at minimum:

- `release-record/release-commit.txt`
- `release-record/repository-gates.json`
- `release-record/migrations.md`
- `release-record/container-scan.json`
- `release-record/live-security-boundaries.json`
- `release-record/audit-chain.json`
- `release-record/retention.md`
- `release-record/network-exposure.md`
- `release-record/backup-restore.md`
- `release-record/secret-rotation.md`
- `release-record/alert-delivery.md`
- `release-record/sdk-quality-parity.json`
- `release-record/upper-body-50-summary.json`
- `release-record/three-user-gpu-report.json`
- `release-record/billing-e2e.md`
- `release-record/pentest-final-report.pdf`
- `release-record/founder-go-live-approval.md`

## Final Go-Live Command

Run only after every evidence file is attached to the exact release commit:

```bash
npm run launch:report
```

The command must exit successfully. A visually good try-on, a passing local
build, or a successful single smoke test is not sufficient public-launch
evidence.
