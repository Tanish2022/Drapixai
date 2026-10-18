# Security assessment verification — 18 October 2026

The [assessment](security-assessment-2026-10-17.md) covers all fifteen requested
areas, architecture, findings, affected files and practical limitations. The
[password follow-up](password-storage-security-2026-10-18.md) records three
additional medium-severity weaknesses and diagnostic privacy hardening. This is
source remediation and bounded local verification, not an independent penetration
test, complete ASVS verification or permission to launch.

The subsequent [HTTP integration record](auth-http-verification-2026-10-18.md)
covers exact revision `8e84b203d4661ec1e7a9edd341a0a88ef981a3a7`: actual compiled
routes, real services, five native/six HTTP groups, complete retained CI evidence
and fresh exact-image scans. The earlier records below keep their original
revision and four-group scope.

## Exact tested source

Implementation revision: `8f2747ee0ab29ee38fb176f95ec306ca1b592b39`.
Review test-stage corrections: `e821d31cc47925f5d0f1788fac42fcf40cf05a8e` and
`49b4d712bd681e2ead5fa645c7b42862c75ca9d4`. The application images and checks below
use the last exact commit, materialized from authenticated raw Git objects.
Concurrent lower-body work and ignored configuration are excluded.

| Verification | Actual result |
|---|---|
| Host API/web TypeScript | Passed |
| Host launch regression | 86/86 boundary cases and 21/21 password crypto/route cases passed |
| Host disposable PostgreSQL | Password upgrade, changed identity/version denial, physically observed reset/issuer lock race, intentional insert rollback, bootstrap rotation/promotion and format-only preservation passed; existing audit, quota/billing and retention regressions passed |
| Shared-runtime application-check build | Passed the same 86/21 cases, MFA, RBAC, storefront tokens, public API, image upload and log privacy; production web build and five-route CSP checks passed |
| Actual API/web review images | Four native check groups passed from a clean exact-commit verifier checkout; actual compiled P0 password/MFA/retention suite ran in the API image |
| Mutable-alias negative regression | Passed: both owned aliases moved after inspection, all six executions retained the inspected immutable image IDs |
| Fresh exact-image scans | API and web each exited 0 with zero High/Critical findings, using the existing pinned Trivy scanner and unchanged VEX policy; raw reports and archive hashes retained |
| Offline evidence/archive verification | Passed over 547 source files, report hashes, OCI index/manifest/config/layer digests, final overlaid Node/OpenSSL bytes and exact Standard profile |
| Live image/component binding | Passed on both immutable review images: actual binary/library hashes and provenance matched the archives/component; expected shared libraries were loaded by non-root Node 22.23.3 / ABI 127 |
| Source/materializer policy | Nine test methods passed, including raw Git-byte preservation, dedicated test-context inventory and twelve TAP acceptance/rejection cases |
| Secret scanning | Active Gitleaks policy: staged password patch (~60.38 KB) and full history through 217 commits (~41.60 MB), zero unallowlisted findings; no new exceptions |

The first application-check attempt failed because Git was absent. The second
failed because production's Docker ignore intentionally removes docs and
`.gitignore`, which the launch suite reads. The test-only stage now installs Git,
creates an inventory index before dependencies, and uses its own recorded ignore
file over the exact committed-source context. Neither failed attempt counts as a
pass. No production ignore rules or source tests were bypassed.

## Review image identities

| Role | Immutable image ID |
|---|---|
| API | `sha256:d2dcd402a5b874a71fa870812d4588c32da270de8848662a76b5c5f1c6aec32c` |
| Web | `sha256:ef7b5f177c874b0f15cee7f5e161b5cb200a7b8866ce963d352d5b80a78ff20e` |
| Application-check stage | `sha256:4684e7b64d26ce670766566a769596d2a025749b505e537e61ebfefeb486ebdb` |

Both API/web application revision labels identify `49b4d712bd681e2ead5fa645c7b42862c75ca9d4`.
Both actual runtimes report Node 22.23.3 / ABI 127, shared OpenSSL 3.5.7 from Debian
`3.5.7-1~deb13u3`, non-root and read-only execution. The separate
[component record](node-shared-openssl-review-2026-10-18.md) records signed source,
five core/TLS groups, two negative controls and 656 non-skipped upstream tests
with four explicit skips. These are review artifacts, not production promotion.

Raw local evidence is under `runtime/security-candidate/node-shared-openssl/`:
`edge-49b4d71/build-inputs.json`, `application-checks-49b4d71.txt`,
`verify-8f2747e-checkout/runtime/launch-evidence/edge-runtime-b55e115ad7db.json`
and `edge-image-binding-cf3f34f6ffe4992b0ffc/report.json` beneath that checkout's
evidence directory. Reports bind verifier and migration bytes, image IDs,
credential fixture output and actual clean checkout state.

The clean Windows verifier checkout contains CRLF conversions of some committed
text files. The raw build context remains byte-identical to Git blobs. Offline
verification checked every checkout difference was UTF-8 line-ending conversion
only and retained both raw and checkout hashes. Migration and verifier hashes in
native reports refer to the actually executed checkout bytes, not falsely to
raw Git bytes.

## Scan and evidence integrity

The unchanged Bash scan script initially rejected local evidence paths because
Windows Python and MSYS resolved them differently. That attempt produced no scan
result. A local PowerShell driver then used native Docker paths, the same pinned
Trivy image/options/cache/database sources and unchanged reviewed VEX. It exported
by immutable image ID and retained raw API/web JSON and archives. The vulnerability
database refreshed from the official configured mirror. This is a local Windows
driver, not a claim that the Bash evidence path passed on Windows.

| Evidence | SHA-256 |
|---|---|
| API raw Trivy report | `b80a9e490409fcc1a3e7c2728c6ce668d41e527810ba5d321a07cfe53b109e17` |
| Web raw Trivy report | `a4cdec15c16fce371de0424c8cbe5e28ed8bff51c034c7b8abc5f5e3e35008a6` |
| Scan summary | `7cd251d7c0ec831f2b7cf325a4680c931290f55d49a4f0a93d02abfe0c511396` |
| Offline consolidated record | `574dcf0267967ab2597e68cc2ddb00d072a2fe280fa4362e8b5e96fa82d0bd20` |
| Live image/component binding | `d5383b90aa80321e0ca064a52003b2a3b067be1237213d8ba7ec0c45784b904b` |

Raw scan artifacts are in `scan-49b4d71/`. The consolidated record is
`application-review-49b4d71-offline-verified.json`. Its archive check verifies OCI
digest links, compressed layer hashes and uncompressed config diff IDs, then
checks the final overlaid regular files without extracting or executing them.
Both archived Node binaries match the tested component SHA-256
`49d27fc7c4e0fced85925dae5ce26a9700917dd1c4199ef39dffca27771acdd5`;
both SSL/crypto libraries match its retained exact hashes. This supplements the
already completed native container tests; it is not a fresh runtime execution.

The first extra live Docker binding command was **not executed** because
automatic approval review was unavailable due to the account usage limit. After
the reported reset time passed, a normal approved retry found Docker Desktop
stopped. The installed engine was started in the background and the bounded
check then **passed for both immutable image IDs**. It compared actual running
binary/library hashes, loaded-library mappings and provenance to the verified
archives. The final record is `application-review-49b4d71-live-binding.json`.
Neither earlier failed attempt is counted as a pass; no approval bypass occurred.

## Hosted CI at the tested commit

[Run 39075293162](https://github.com/Tanish2022/Drapixai/actions/runs/39075293162)
at `49b4d712bd681e2ead5fa645c7b42862c75ca9d4` completed: **application,
container-scan, secret-scan and checkpoint-candidate success; AI contracts
failure**. The application log confirms 86/86 boundary and 21/21 password cases,
the observed PostgreSQL reset/issuer race, existing accounting/retention tests,
production builds/CSP and four final npm audits with zero vulnerabilities. The
container log confirms the expanded compiled API database fixture and both
production API/web High/Critical scans passed. These hosted images use the
unchanged stock-runtime Dockerfiles; they do not certify the shared candidate.

AI contracts still report `accelerate 1.11.0 / PYSEC-2026-3804`, one known
vulnerability and four existing ignored advisories. The isolated patched
checkpoint-candidate pass is not approval to promote that candidate. The earlier
`8f2747e` run's application job was cancelled by the subsequent push; only the
completed exact-commit run above is used for current hosted application evidence.

## Operational and rollout limits

No production deployment, real customer-data test or external attack occurred.
Legacy bcrypt inputs at or above 72 UTF-8 bytes require verified recovery; drain
old authentication replicas and retain the new reader in any rollback. Confirm
SMTP delivery and account/session behavior on approved staging before rollout.

Live staging/TLS/proxy trust/IAM/encryption and secret/backup/retention drills,
individual operator recovery, independent multi-tenant penetration testing and
retest remain open. The Accelerate advisory, qualified downstream runtime review,
commercial CatVTON rights, legal/privacy approvals, delivered GPU acceptance,
four independent Standard quality/latency/VRAM/isolation measurements and real
merchant pilot/founder approval remain launch blockers.

Standard profile SHA-256 remains
`b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`.
No inference dependency, model weight, Standard quality threshold, worker capacity
or original 22 launch-gate decision was changed by these security fixes.
