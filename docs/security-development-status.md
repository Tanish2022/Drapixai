# DrapixAI Security Development Status

Last local verification: 2026-08-16

This document separates controls implemented in the repository from controls
that require real infrastructure, staging credentials, or an independent
security assessor. Public launch remains blocked until every external gate is
supported by dated evidence.

## Implemented and locally verified

- Stable `/v1` API, scoped access tokens, idempotency, OpenAPI, and webhook
  persistence.
- IP, server-key, API-key, and tenant rate limits.
- Atomic global and per-tenant GPU concurrency leases in Redis.
- Atomic webhook delivery claims with stale-claim recovery.
- Managed secret bootstrap through AWS Secrets Manager or a permission-checked
  mounted secret file.
- AWS workload identity enforced for the production edge configuration.
- Token, audit-chain, and webhook-encryption rotation overlap support.
- Separate sandbox and production environment templates and an executable
  resource-isolation verifier.
- PostgreSQL migration wrapper that creates a custom-format backup, verifies
  its catalog, records SHA-256, and writes migration evidence.
- Guarded PostgreSQL restore command for rollback.
- Cloudflare DNS, managed WAF, custom rules, and edge rate-limit Terraform.
- Private AI hostname allowlisting, TLS CA configuration, and private-listener
  verification.
- Authentication, usage, queue-depth, and webhook alert rules.
- Staging attack harness for tenant isolation, replay, origin binding,
  authorization, and forged-image uploads.
- Dependency audits, history-aware secret scanning, and container scanning in
  CI.
- Non-root distroless API and web runtime images with read-only filesystems,
  dropped capabilities, bounded tmpfs, and current patched OpenSSL.
- Key rotation, breach response, backup restore, customer deletion, and alert
  response procedures.
- Stripe-hosted Checkout and customer portal with raw-body signature checking,
  replay-safe event claims, live/test separation, managed secrets, monotonic
  subscription state, exact billing-period quota counters, and fail-closed paid
  access.

## Local evidence

- API production dependency audit: zero vulnerabilities.
- Web production dependency audit: zero vulnerabilities.
- API image Trivy gate: zero HIGH or CRITICAL findings.
- Web image Trivy gate: zero HIGH or CRITICAL findings.
- API and web containers returned HTTP 200 as non-root processes with
  read-only root filesystems.
- Redis concurrency rehearsal proved three different tenants can occupy three
  slots, one tenant cannot monopolize them, and a fourth tenant waits.
- Migration rehearsal backed up the six-migration baseline, applied
  `20260729180000_public_api_v1`, verified all three new tables, restored the
  baseline into a separate database, and verified that no v1-only table
  survived the rollback.
- Local evidence is stored under `runtime/security/` and is intentionally not
  committed.
- All 35 repository launch gates pass, including billing security contracts and
  the immutable Standard CatVTON release profile.
- A fresh PostgreSQL 16 disposable database applied all eight migrations;
  exact-period billing rollover, duplicate provider-event rejection, unique
  customer mapping, and immutable audit UPDATE/DELETE rejection passed.

## External launch gates

- Provision physically separate production and sandbox PostgreSQL, Redis,
  object-storage buckets, managed-secret records, and private AI endpoints.
- Apply Cloudflare Terraform with the real zone and lock the origin firewall to
  Cloudflare ingress only.
- Configure private DNS, VPN or service network, internal TLS certificates, and
  the Node-to-AI service identity.
- Apply the migration to staging and production with real pre-change backups,
  immutable evidence storage, and an operator-approved rollback window.
- Deploy Prometheus and Alertmanager rules with tested on-call destinations.
- Run the staging attack harness with two real tenant accounts and retained
  request, log, and database evidence.
- Run CI on the release commit, including dependency, secret, and exact-image
  scans.
- Commission an authorized independent penetration test and remediate every
  critical and high finding.
- Perform a timed backup restore, key rotation, breach tabletop, and customer
  deletion exercise with named operators.
- Configure separate Stripe test/live catalogs and webhook endpoints, verify the
  live catalog, and run the complete billing lifecycle rehearsal with redacted
  evidence and qualified tax/accounting review.

## Estimated pricing

Pricing checked on 2026-07-29. USD conversions below use a planning rate of
INR 85 per USD and exclude GST. Actual cloud pricing depends on region,
traffic, storage, backup retention, and support commitments.

### Recurring monthly cost

| Item | Recommended launch choice | Estimated monthly cost |
| --- | --- | ---: |
| WAF, CDN and DDoS protection | Cloudflare Business, billed annually at USD 200/month | INR 17,000 |
| Private operator access | Tailscale Premium, two users and two tagged resources | INR 3,200 |
| Managed secrets | AWS Secrets Manager, approximately 15 secrets and normal API use | INR 500-1,000 |
| Production and smaller sandbox PostgreSQL | Managed, encrypted, automated backups | INR 8,000-20,000 |
| Production and smaller sandbox Redis | Private managed Redis with authentication and TLS | INR 3,000-10,000 |
| Object storage and backup archive | Separate production/sandbox buckets and lifecycle rules | INR 1,000-5,000 |
| Metrics, logs and alert delivery | Prometheus/Grafana hosting or managed equivalent | INR 3,000-12,000 |
| Staging edge compute | Small always-on API/web staging environment | INR 5,000-15,000 |
| **Estimated recurring total** | Excludes GPU and public data transfer | **INR 40,700-83,200/month** |

The practical launch allowance should be **INR 75,000/month** for this layer.
Cloudflare Pro can reduce the bill by roughly INR 15,000/month, but Business is
the recommended public-launch choice for DrapixAI.

Official references:

- [Cloudflare plans](https://www.cloudflare.com/plans/)
- [Tailscale pricing](https://tailscale.com/pricing)
- [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)

### One-time launch cost

| Item | Estimated cost |
| --- | ---: |
| Production and sandbox provisioning, IAM, WAF, private network, TLS and alert wiring | INR 1,00,000-2,50,000 |
| Authorized manual web, API, cloud and external-network penetration test with retest | INR 2,00,000-5,00,000 |
| Backup restore, key rotation, incident tabletop and customer-deletion drill | INR 30,000-1,00,000 |
| **Estimated one-time total** | **INR 3,30,000-8,50,000** |

For budgeting, reserve **INR 5,00,000 one time** and **INR 75,000 per month**.
That produces a first-year security and edge-platform budget of approximately
**INR 14,00,000**, excluding GPU infrastructure, GST, and unusually high
bandwidth or storage usage. Obtain written quotes before purchase, especially
for the independent penetration test.

## Launch decision

Do not call DrapixAI publicly launch-ready until the external launch gates are
complete. Repository development materially reduces risk, but no application
can be described as hacker-proof and local tests cannot prove the behavior of
undeployed networks, identities, WAF rules, or operator procedures.
