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

## Repository gates

- API and web production builds pass.
- `npm --prefix apps/api run test:launch` passes.
- `npm --prefix apps/api run test:authorization` passes.
- `npm --prefix apps/api run test:storefront-tokens` passes.
- Prisma migrations apply to a disposable PostgreSQL database and the audit mutation triggers reject UPDATE and DELETE.
- Both hardened Compose manifests render successfully from example environment files.
- Production CSP contains a per-request nonce and contains no `unsafe-inline`.
- Production dependency and container-image scans contain no unresolved critical or high findings.
- `npm run launch:report:repository` reports no failed repository gate for the exact release commit.

CI applies every migration to disposable PostgreSQL and then runs `npm --prefix apps/api run test:audit-immutability`. Never point that command at a retained development, staging, or production database because its verification row is intentionally append-only.

CI builds and scans the API and web runtime images with the immutable Trivy image pinned in `deploy/scripts/scan-container-images.sh`. Before GPU promotion, run the same script against the exact AI image digest on Linux and attach all three scan outputs to the release record. Do not mark `container-image-scan` passed from dependency audits alone.

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
4. Run `deploy/scripts/pentest-staging.sh https://staging.example.com` with an approved digest-pinned ZAP image.
5. Verify `npm --prefix apps/api run security:audit:verify` reports `valid: true`.
6. Exercise retention with a short test window, confirm object deletion, database URL clearing, failure retry, and immutable audit evidence.
7. Verify Redis, PostgreSQL, MinIO/S3 management, and the GPU worker have no public listener. Only HTTPS edge ports may be public.
8. Verify backup restore, secret rotation, key revocation, alert delivery, and incident rollback.

## Independent penetration test

An authorized independent tester must cover authentication and MFA, session lifecycle, RBAC, IDOR/cross-tenant access, storefront-token replay and scope, SSRF, upload parsing, CORS/CSRF/CSP, rate-limit bypass, Shopify signatures/webhooks, object-storage authorization, queue access, dependency/container escape exposure, and denial-of-service limits. Test only staging or a written-authorized production window.

No public launch with unresolved critical or high findings. Medium findings require an owner, accepted risk rationale, and remediation date. Retest all fixes and keep the final report, scope, timestamps, release commit, and tester authorization with the release record.
