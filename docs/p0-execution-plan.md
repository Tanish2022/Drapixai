# P0 execution plan: non-GPU first

Updated: 2026-10-16. Public scope: Standard upper-body CatVTON only.

This plan separates executable work from release approval. Local tests, source
checks and simulated failures do not certify a live deployment. The authoritative
22 gate identifiers remain in `deploy/launch-gates.json`; no gate is waived for
lack of a GPU. Keep dated, redacted evidence bound to the exact tested commit and
artifact digest under ignored `runtime/launch-evidence/`.

## Agreed 15 work packages

The owner confirmed these packages on 2026-10-16 as the execution goal. They
organize the original 22 gates and the additional four-request requirement;
they do not replace or waive those gates. No package is complete merely because
code, a checklist or a local test exists. Final closure requires evidence for the
actual deployed release and any named external approval.

| # | Work package | Completion evidence still required |
| --- | --- | --- |
| 1 | Dependency security remediation | Current resolved audits and exact API/web/AI image scans; reviewed AI remediation and GPU parity |
| 2 | Reliable CI and release evidence | Required Linux/source/service tests pass on the final clean commit; artifacts and evidence bind matching digests |
| 3 | Live CPU staging | Isolated API/web/PostgreSQL/Redis/managed S3, HTTPS and domains verified live; intake disabled until GPU certification |
| 4 | Infrastructure and operator security | Live WAF/firewall/VPN/MFA, least privilege, offboarding, isolation, GPU mTLS and listener proof |
| 5 | Live application security | Actual tenant denial, auth lifecycle, uploads, CORS, rate limits and webhook replay results |
| 6 | Privacy, retention and audit integrity | Live all-version deletion/retry/reference clearing, immutable audit chain, log privacy, backup schedules and GPU spool cleanup |
| 7 | Billing and quota correctness | Provider test flows, subscriptions/refunds, replay/idempotency, real job accounting, tax/invoice approval |
| 8 | Operational drills and monitoring | Measured live restore/rollback, revocation, operator alert delivery, dependency/GPU failures and emergency disable |
| 9 | Legal/privacy and commercial model rights | Qualified approval for exact models, assets, purposes, vendors, terms, consent, DPA and policies |
| 10 | Independent penetration test | Explicit scope authorization, independent deployed assessment, remediation and independent retest |
| 11 | Workstation and deployment readiness | Inspect delivered ordered hardware, exact runtime, thermal/RAM/storage/GPU/UPS acceptance, encrypted storage and independent backup |
| 12 | Controlled pilot | Approved participants/catalog/rights, measured outcomes, support/stop criteria and exact-release founder approval |
| 13 | Quality consistency and improvement | Rights-cleared 50-case matrix, scoring calibration, named visual reviews, single-reference parity and every concurrent output >=0.95 |
| 14 | Speed, four-request capacity and stability | Real GPU execution evidence, timing breakdown/p50/p95/p99, >=20% VRAM headroom, isolation, fairness and repeated soak |
| 15 | Complete customer journey | Mobile/desktop/accessibility, onboarding/catalog/SDK/dashboard/billing/support and actual inference retry/failure journeys |

Start packages 1-4 first, prepare external reviews alongside engineering and
prepare GPU fixtures before delivery. Include rejected/failed attempts in quality
and capacity reports. A >=0.95 score does not establish visual realism or an
acceptable success rate on its own. Hardware acceptance is recorded in
`docs/ordered-workstation.md`; all four-request acceptance requirements appear
below. Keep GPU-dependent, live-environment and external-review portions open
until their required evidence exists.

## Baseline

Current execution note (2026-10-16): the owner confirmed staging has not been
provisioned. Live deployment gates remain pending; next infrastructure work is
to prepare the deployment package and obtain the host/provider/domain/access
and spending decision. The ordered GPU workstation is not yet delivered.
API/web dependency remediation and local verification are recorded separately
in `docs/security-remediation-2026-10-16.md`; this does not close AI image or live
release gates.

At `62ea336757070539422f010b5192ed7e40ee2d80`, [CI run 35400607857](https://github.com/Tanish2022/Drapixai/actions/runs/35400607857)
passed application checks, secret scanning and API/web image scanning. Its AI
dependency audit failed on Accelerate `PYSEC-2026-3804`, suppressing subsequent
CPU checks. The disposable migration/audit-trigger gate has supporting evidence;
the clean-commit gate is recalculated for each candidate. The other 20 gates are
open. Earlier local verification passed all 46 repository checks; that does not
override the separate failing dependency audit.

## Work now, without a GPU

The September 26 hardening covers three evidence boundaries without modifying inference:
privacy inventory includes historical object versions and fails on incomplete
enumeration; GPU image evidence must match the exact current commit and both
service digests; host listener checks reject explicit public IPs as well as
wildcards. Local verification passed 17 synthetic S3 cases, 12 GPU evidence tests
and 93 listener cases. These regressions are now required in CI and the repository
gate manifest. Shell regressions require Bash/Python 3 on Linux (or a compatible
environment); missing Bash must fail the integration gate rather than silently
skip it. A disposable local S3-compatibility probe also detected a version hidden
by an ordinary delete and confirmed removal
after deletion of that specific version; it used synthetic bytes and never touched
the project's existing buckets. Actual versioned-media
cleanup, live host validation and final GPU evidence remain outstanding.

The September 27 retention change adds version-aware erasure to review cleanup
and the legacy-render purge, plus conditional database URL clearing. It requires
enabled bucket versioning: the disposable S3-compatibility provider ignored
conditional-delete headers in a real concurrent-replacement test. The managed-S3
staging provisioning initializer enables versioning and all public-access blocks,
and erasure refuses disabled/suspended buckets. Future writes then
receive distinct version IDs; a new version survives deletion of an old null
version and prevents false success. The fixture drill also checks real Object
Lock rejection, dry runs, retry, orphaned legacy versions and a valid audit chain.
Existing deployments still require a controlled versioning transition and live
retention verification; no local test closes that gate.

1. **Preserve evidence and restore CPU CI coverage.** Record the baseline CI
   evidence. Run CPU security/privacy/quality regressions before the blocking AI
   audit, including AI log redaction. Keep the same failing audit in the same
   required job; do not add an exception or change a runtime pin. Record the next
   commit's results separately from the baseline.
2. **Review AI remediation without promoting a runtime.** Review the actual
   checkpoint loader, test traversal and non-regular-file rejection, and prepare
   a reviewed fixed dependency candidate when available. Building and scanning
   candidate images needs compute/storage but no GPU. The current startup
   validator is a mitigation, not dependency remediation. See
   `ai-runtime-security.md`; final candidate approval still needs GPU parity.
3. **Prepare and deploy isolated CPU staging once host access is available.**
   Obtain host/domain, access method, DNS/WAF routing and operator identities.
   Use distinct database, Redis, storage and secret identities, digest-pinned
   API/web images and test-mode billing credentials. Keep
   `DRAPIXAI_TRYON_INTAKE_ENABLED=0` in the Compose input environment while no GPU
   is present. Do not weaken production AI mTLS requirements to make health or
   inference appear ready. Review required certificate mounts and startup/readiness
   behavior before deploying the existing edge topology.
4. **Verify live CPU application controls.** Use dedicated synthetic tenants to
   test cross-tenant denial, credentials and session lifecycle, webhook replay,
   billing/quota behavior, CORS/upload rejection, audit integrity, retention retry
   and URL clearing, and log/observability privacy. Seed synthetic ownership
   fixtures where a test needs an existing result; do not claim they prove image
   generation. Capture both positive and negative checks.
5. **Run CPU operational drills.** Verify listeners, firewall/VPN/MFA and
   offboarding, secrets rotation/revocation, alert delivery, database/object
   recovery with deletion-tombstone replay, and Redis/database/API outages.
   Measure restoration and application readiness against agreed recovery goals.
   Leave GPU/quality alerts, worker loss and OOM portions pending.
6. **Prepare external review.** Assemble legal/privacy/model-license materials,
   authorized independent pentest scope, test accounts and remediation tracker,
   and pilot exit criteria. Qualified reviewers and independent testers supply
   their own conclusions. Do not contact anyone, book services or incur costs
   without authorization. A CPU-only edge pentest does not certify the later GPU
   deployment or satisfy the entire independent test gate.

The local configuration has been located (`.env`, `apps/api/.env`,
`apps/web/.env.local`, `runtime/local-stack.env`). These are local endpoints;
they are not live staging credentials. Do not copy local secrets into staging.
No live staging host/domain/access or populated staging configuration has been
verified. Tasks 3-5 depend on those inputs. The existing
`deploy/staging/certify-release.sh` remains full certification and requires GPU
and governed security evidence; use individual CPU checks for partial evidence
until those prerequisites exist, rather than manufacturing placeholder passes.

## Work when a GPU is available

1. Deploy the exact reviewed/scanned AI image on the approved target GPU with
   immutable local model artifacts, private networking, mTLS, read-only model
   mounts and transient shopper-image storage. Verify image digests, actual
   listeners, certificate rejection/acceptance and runtime readiness.
2. Compare direct and SDK Standard output using identical approved inputs and
   settings. Preserve one candidate, 22 steps, guidance 2.5, 768x1024 inference,
   the approved mask/scoring/postprocessing, quality at least 0.95, no warnings,
   and the approved 12-second warm end-to-end limit. Do not lower requirements
   to accommodate a security upgrade.
3. Run the rights-cleared 50-case matrix with manual realism review; then run
   three simultaneous tenants and measure quality, latency, VRAM headroom,
   fairness and absence of cross-tenant data leakage.
4. Exercise queue saturation, GPU OOM, worker restart/loss, image-spool cleanup,
   dependency outages and emergency intake disable. Complete GPU alerts,
   independent test coverage and remediation retest. Run the controlled pilot,
   assemble all 22 exact-commit gate records, and obtain the founder go-live
   decision only after legal and security approvals.

## Gate-by-gate completion conditions

### Four simultaneous Standard requests: additional acceptance requirement

Added 2026-10-16 at the owner's request. The required target is four simultaneous
try-on requests, with each output independently meeting the approved Standard
quality floor. This extends concurrency acceptance; it does not replace any of
the original 22 P0 gates or constitute passing evidence for four-request mode.

- For every test group, all four outputs must have finite, independently computed
  scores >=0.95 and no warnings. A missing/failed output or any score below 0.95
  fails that group; an average >=0.95 cannot compensate for a failing output.
- Compare each output with its own single-request Standard reference using the
  same person, garment, seed and approved configuration. Require named visual
  review of garment color/texture/print, collar/sleeve/hem, anatomy, face and
  background. Equal quality means meeting these requirements; images and scores
  need not be numerically or pixel-identical. A score is not a measured percentage
  of realism.
- Submit all four together through the real SDK/public path, with four distinct
  tenant identities and distinguishable fixtures. Prove correct result ownership,
  all 12 cross-tenant access denials, no image/metadata mix-ups and spool cleanup.
- Record submission, queue and execution times, per-output end-to-end latency,
  actual worker batch size/index and fallback events. Four accepted or queued
  requests do not prove a four-item GPU batch. Label sequential/fallback runs
  accurately and do not use them to certify four-item execution.
- Preserve the approved Standard settings and warm p95 end-to-end target <=12
  seconds. Report every request's latency and repeated-run p50/p95/p99, peak
  reserved VRAM with >=20% headroom, failures and accepted-result rate. Do not
  hide rejected/failed attempts or lower thresholds to make capacity pass.
- Prepare mixed-garment, repeated runs and a 100-group soak (400 requests).
  Every accepted output requires the same score and warning checks. Retain all
  failure counts and require no CUDA OOM, worker restart, lost/duplicate results,
  cross-tenant disclosure or transient-file leak in the certification soak.
- The current code hard-caps `gpu_batch_max` at three. Prepare fixtures, test
  assertions and reporting before delivery; implement and validate isolated
  four-request candidate support on the ordered RTX PRO 6000 after delivery.
  Keep the existing three-request evidence and tests, and require independent
  review of the expanded capacity before enabling four-request mode for users.

Status: **PENDING GPU implementation and certification**. No four-output quality,
latency or concurrency result has been established by this plan.

| Gate | Work without GPU | What still prevents closure |
| --- | --- | --- |
| `clean-release-commit` | Record clean candidate SHA | Recheck after every edit/commit |
| `disposable-db-migration` | Run real disposable migrations and immutable-trigger checks | Attach passing evidence for final SHA |
| `container-image-scan` | Build/scan API, web and AI images; remediate findings | Open AI advisory; exact final image scans and GPU approval of changed runtime |
| `two-tenant-staging` | Live CPU security harness with synthetic fixtures | Deployed staging and reviewed live report |
| `audit-chain-staging` | Verify staging hash chain and append-only database privileges | Live environment evidence |
| `retention-staging` | Verify deletion/retry/reference clearing in API/storage | Live evidence including AI caches/spool once deployed |
| `private-services` | Verify edge/data listeners and external firewall exposure | GPU/private endpoint verification also required |
| `backup-restore` | Restore real database and objects; test tombstones and application recovery | Live recovery drill and measured recovery goals |
| `secret-rotation` | Rotate staging secrets and rehearse revoked-key rejection | Actual release secret set, including later AI credentials |
| `alerts` | Deliver security/API/data alerts to configured operator | GPU/queue/quality alerts and actual delivery evidence |
| `sdk-quality-parity` | Prepare identical-input fixtures and settings | GPU direct/SDK output and latency evidence |
| `three-tenant-gpu` | Prepare token-free manifest and tenants | Real simultaneous GPU execution and isolation/VRAM measurements |
| `quality-matrix` | Validate tooling, image rights and case coverage | GPU matrix plus manual realism review |
| `authorized-pentest` | Scope and run authorized independent CPU/edge assessment | Whole deployed scope, remediation and independent retest |
| `edge-operator-access` | Verify TLS/WAF/firewall/VPN/MFA and offboarding | Live host/provider/operator evidence |
| `environment-isolation` | Separate and verify CPU resources and secrets | Distinct AI endpoints/resources also required |
| `auth-lifecycle` | Exercise registration through revocation/offboarding | Live credentials, email and session evidence |
| `log-privacy` | Check deployed API/web/storage and observability exports | Deployed AI/worker logs also required |
| `billing-security` | Verify provider test-mode flows, replay, quotas/refunds | Actual release configuration and approved tax/refund settings |
| `failure-containment` | Rehearse data/API outages and intake shutdown | GPU OOM, worker loss, queue/fairness tests under real inference |
| `legal-privacy-approval` | Prepare policies, consent, model rights and processor inventory | Qualified legal approval of actual launch scope |
| `controlled-pilot-approval` | Define pilot participants, rights, metrics and stop criteria | Real pilot outcomes and exact-commit founder approval |

Local completion of the first work package is not completion of all non-GPU
tasks. Public launch remains NO-GO until the full release record passes.
