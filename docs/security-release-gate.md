# DrapixAI Security Release Gate

Public production remains blocked until every item below has evidence attached to the release record.

This document is the authoritative DrapixAI public-launch security gate. `deploy/production-readiness.md` explains how to operate the environments, but it does not override these requirements.

## Automated evidence report

Run every local repository gate and write a redacted JSON and Markdown report under the ignored `runtime/launch-evidence/` directory:

```bash
npm run launch:report:repository
```

Run the complete launch report, including the external release evidence that must still be attached manually:

```bash
npm run launch:report
```

Copy `deploy/launch-evidence.example.json` to the ignored `runtime/launch-evidence/approved-evidence.json`, set the exact 40-character release commit, and place each redacted evidence artifact beneath `runtime/launch-evidence/`. For every completed external gate, record the verifier, timestamp, artifact path, and SHA-256 digest. `PASS` entries are accepted only when the evidence file targets the current commit and the referenced artifact exists under that directory with the recorded hash.

Initialize a fresh record for the current commit with `npm run launch:evidence:init`.
The command preserves a prior-commit record under `runtime/launch-evidence/archive/`
instead of silently reusing or destroying it.

The complete command intentionally exits nonzero while any release evidence is `PENDING` or any gate is `FAIL`. A report is evidence for the exact commit and working-tree state it records; it must not be reused for a different release. Never put credentials, shopper images, or customer data in the evidence metadata.

Use the recorder after reviewing a redacted artifact. It verifies that the artifact
is inside the evidence directory, hashes it, and atomically updates only the
specified gate in the current-commit release record:

```bash
node scripts/record-launch-evidence.mjs \
  --gate container-image-scan \
  --status PASS \
  --verified-by release-owner@example.com \
  --artifact runtime/launch-evidence/release-record/container-scan.json
```

The command does not decide that a gate passed; the operator remains accountable
for the evidence. It makes the recorded artifact, hash, timestamp, gate identity,
and release commit mechanically consistent.

## Complete P0 evidence set

Public launch requires all 22 gates below. Repository tests may prove that a
control exists, but they do not replace dated evidence from the exact deployed
commit and environment.

1. Exact clean release commit.
2. Disposable database migration and immutable-audit trigger proof.
3. Exact API, web, and AI container-image scans.
4. Live two-tenant staging attack harness.
5. Valid staging audit hash chain.
6. Retention, deletion, retry, and URL-clearing proof.
7. Private database, Redis, storage administration, and GPU services.
8. Backup restoration and rollback drill.
9. Secret rotation and revocation drill.
10. Delivered security, availability, queue, and quality alerts.
11. SDK and direct Standard quality parity.
12. Three-tenant GPU quality, latency, capacity, and isolation proof.
13. Rights-cleared 50-case upper-body quality matrix.
14. Authorized independent penetration test with no unresolved high/critical findings.
15. WAF/edge, firewall, VPN-only administration, MFA, and operator-access proof.
16. Physical sandbox/production data, queue, storage, secret, key, and AI isolation.
17. Complete user and operator authentication/session lifecycle proof.
18. Production log-privacy proof across API, web, AI, proxies, and observability exports.
19. Production billing lifecycle, signed-webhook replay, quota, refund, and tax proof.
20. Queue, GPU, worker, dependency, tenant-fairness, and emergency-disable failure containment.
21. Qualified legal approval for privacy, consent, retention, terms, refunds, DPA, and subprocessors.
22. Controlled-pilot exit evidence and founder approval for the exact commit.

No gate may be marked `PASS` from a planned configuration, screenshot without
context, local-only test, or unverified statement. External reviews and approvals
must identify the reviewer, scope, timestamp, exact release commit, and artifact
digest.

## Repository gates

- API and web production builds pass.
- `npm --prefix apps/api run test:launch` passes.
- `npm --prefix apps/api run test:authorization` passes.
- `npm --prefix apps/api run test:storefront-tokens` passes.
- `npm --prefix apps/api run test:distributed-security` passes.
- AI structured-log redaction regression tests pass.
- Sandbox/production isolation and staging-topology contract tests pass.
- Prisma migrations apply to a disposable PostgreSQL database and the audit mutation triggers reject UPDATE and DELETE.
- Both hardened Compose manifests render successfully from example environment files.
- Production CSP contains a per-request nonce and contains no `unsafe-inline`.
- Production dependency and container-image scans contain no unresolved critical or high findings.
- `npm run launch:report:repository` reports no failed repository gate for the exact release commit.

CI applies every migration to disposable PostgreSQL and then runs `npm --prefix apps/api run test:audit-immutability`. Never point that command at a retained development, staging, or production database because its verification row is intentionally append-only.

For a local disposable loopback database whose name contains `p0`, `test`, or
`disposable`, set `DRAPIXAI_DISPOSABLE_DB_APPROVAL=I_ACKNOWLEDGE_DISPOSABLE_DATABASE`
and run `npm run launch:certify:disposable-db`. The helper refuses remote and
ambiguously named databases and writes a redacted `release-record/migrations.md`.

CI builds and scans the API and web runtime images with the immutable Trivy image pinned in `deploy/scripts/scan-container-images.sh`. Before GPU promotion, run the same script against the exact AI image digest on Linux and attach all three scan outputs to the release record. Do not mark `container-image-scan` passed from dependency audits alone.

For a clean local or staging checkout, preserve the exact-image summary and raw
Trivy reports instead of relying on console output:

```bash
DRAPIXAI_RELEASE_COMMIT="$(git rev-parse HEAD)" \
DRAPIXAI_CONTAINER_SCAN_EVIDENCE="runtime/launch-evidence/release-record/container-scan.json" \
  bash deploy/scripts/scan-container-images.sh \
  "drapixai-api:$(git rev-parse HEAD)" \
  "drapixai-web:$(git rev-parse HEAD)" \
  "drapixai-ai:$(git rev-parse HEAD)"
```

The summary records the pinned scanner, exact local image IDs, embedded release
revision labels, high/critical counts, retained report paths, and SHA-256
digests. Evidence mode rejects an image whose
`org.opencontainers.image.revision` label differs from the release commit. A
failed or incomplete scan writes `FAIL` evidence and keeps the release gate
closed.

## Staging gates

1. Deploy the exact release commit to an isolated production-like staging environment.
2. Create two disposable brand tenants, one ready product per tenant, one shopper token for tenant A, and one try-on result for tenant B.
3. Run `npm --prefix apps/api run test:security:live` with two disposable tenants and:
   - `DRAPIXAI_SECURITY_TEST_API_URL`
   - `DRAPIXAI_SECURITY_TEST_SERVER_KEY_A`
   - `DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A`
   - `DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A`
   - `DRAPIXAI_SECURITY_TEST_PRODUCT_A`
   - `DRAPIXAI_SECURITY_TEST_PRODUCT_B`
   - `DRAPIXAI_SECURITY_TEST_RESULT_B`
   - `DRAPIXAI_SECURITY_TEST_ORIGIN_A`
   - `DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A`
   - `DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH`
   - `DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS`
   - `DRAPIXAI_SECURITY_TEST_ENVIRONMENT`

   The staging-only harness exercises cross-tenant product and result access, expired-token replay, cross-origin token replay, forged image uploads, brand-to-admin privilege escalation, localhost webhook SSRF, hostile-origin CORS/CSRF behavior, and bounded API-key rate limiting. Use an access token scoped to `api:usage` and `api:webhooks`; configure the staging API-key rate limit to 20 for this temporary test, then restore it. Delete the test tenants afterward.
4. Run the authorized staging-only scanner with an approved digest-pinned ZAP image. The helper refuses any host whose name does not include `staging`, requires `DRAPIXAI_PENTEST_ENVIRONMENT=staging`, and requires a written authorization reference:

   ```bash
   export DRAPIXAI_PENTEST_ENVIRONMENT=staging
   export DRAPIXAI_PENTEST_AUTHORIZATION_ID=SEC-YYYY-NNNN
   export DRAPIXAI_ZAP_IMAGE=approved-zap-image@sha256:replace-with-64-hex-digest
   bash deploy/scripts/pentest-staging.sh https://staging.example.com
   ```
5. Verify `npm --prefix apps/api run security:audit:verify` reports `valid: true`.
6. Exercise retention with a short test window, confirm object deletion, database URL clearing, failure retry, and immutable audit evidence.
7. Verify Redis, PostgreSQL, MinIO/S3 management, and the GPU worker have no public listener. Only HTTPS edge ports may be public. Save the GPU listener check plus an API-host mTLS test that proves no-client access is rejected and the dedicated API client certificate receives `/health` HTTP `200`.
8. Verify backup restore, secret rotation, key revocation, alert delivery, and incident rollback.
9. Run the three-tenant public API batch on the exact serving GPU image and release commit. It must form worker batches of three, retain at least 20% VRAM headroom, preserve tenant isolation, return no warnings, meet the approved Standard quality threshold, and report p95 total latency at or below 12 seconds. Attach the redacted `three-user-gpu-report.json` before launch.

## Independent penetration test

An authorized independent tester must cover authentication and MFA, session lifecycle, RBAC, IDOR/cross-tenant access, storefront-token replay and scope, SSRF, upload parsing, CORS/CSRF/CSP, rate-limit bypass, Shopify signatures/webhooks, object-storage authorization, queue access, dependency/container escape exposure, and denial-of-service limits. Test only staging or a written-authorized production window.

No public launch with unresolved critical or high findings. Medium findings require an owner, accepted risk rationale, and remediation date. Retest all fixes and keep the final report, scope, timestamps, release commit, and tester authorization with the release record.
