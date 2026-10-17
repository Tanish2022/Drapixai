# CI verification reliability — 17 October 2026

Work packages: reliable CI/exact-release evidence, privacy/retention and operational verification. No production deployment, inference configuration, quality threshold or public-launch gate is approved here.

## Evidence that changed the next action

[Run 39045580881](https://github.com/Tanish2022/Drapixai/actions/runs/39045580881) tested security commit `e881c9cda225cf936b813f99c14faee8dc32e7d8`. Its 29 behavioral security cases passed, as did secret scanning and the checkpoint candidate job. The application job subsequently failed in the disposable versioned-retention drill; both production container scans failed without reports. The independent AI dependency audit still failed on Accelerate 1.11.0 / `PYSEC-2026-3804`.

The failed edge artifact (ID `12105880970`) was downloaded and its bytes verified against the hosted SHA-256 `fbca94c999dd1468e5464ebc9f5e693b6ed5da4e0e5927928840e84d704203a8`. Its embedded scanner errors identify `public.ecr.aws` returning `TOOMANYREQUESTS: Data limit exceeded`. A failed scan with no report is not evidence of zero vulnerabilities. The retention log identifies the separate database error: `database "drapixai_retention_test" does not exist`.

## Remediation

| Failure | Change | Verification |
|---|---|---|
| `pg_isready` accepted PostgreSQL's temporary initialization server before the configured database existed. | `scripts/verify-versioned-retention.mjs` now requires an authenticated TCP `SELECT current_database()` returning the expected database before storage health, migrations or fixtures proceed. The initialization server's Unix socket is insufficient. | Real disposable PostgreSQL/S3 drill passed all nine checks locally. It exercised version pagination, hidden historical media, Object Lock denial, legacy purge CLI, reference preservation/retry and a valid PostgreSQL audit chain. |
| ECR-only database retrieval made both Trivy scans depend on one registry's quota. | `deploy/scripts/scan-container-images.sh` supplies an ordered official mirror/upstream/ECR database list, retaining the explicit operator override. The scanner image digest, bounded timeout, vulnerability policy, VEX, read-only mounts and capability restrictions remain unchanged. | Actual shell boundary fixtures verify default and explicit registry arguments and transient recovery. A real scan using the fallback must also succeed in exact-head CI; fixtures alone cannot establish registry availability or image safety. |
| A scanner command could exit nonzero but leave parseable JSON. After all retries the old wrapper parsed that JSON and could incorrectly declare success. | The wrapper now requires a successful scanner command **and** a nonempty valid report before applying the existing HIGH/CRITICAL gate. Nonzero commands with partial JSON return verification failure (20). Empty files no longer receive a report digest that resembles valid evidence. | The new regression fails against the actual `e881c9c` script: it observed exit 0/PASS after three simulated exit-37 commands. The fixed script rejects the same scenario. This demonstrates a possible gate failure; it does not establish that previous successful real scans used partial output. |
| Blank trailing stderr lines hid the registry failure from the job summary. | Failure summaries include the last nonempty diagnostic lines and the underlying command exit code. Existing failure evidence retains the scanner error. | Partial-report fixture includes trailing blank lines; the summary still names the synthetic quota error and exit 37. |

Trivy documents its [database locations and ordered fallback](https://trivy.dev/docs/dev/configuration/db/). This change does not skip database updates, permit stale/offline success, disable vulnerability detection or suppress a finding.

## Verification and limits

- `deploy/scripts/test-container-scanner.py`: **10/10 cases passed**. Executes the real shell script with synthetic Docker/Git adapters; covers valid reports, HIGH finding rejection, nonzero command with valid JSON, empty/malformed/missing-results reports, transient recovery, explicit repository override, revision mismatch and dirty checkout rejection.
- The actual old committed script was used as a negative control for the partial-report case; it failed the new assertion as expected. The fixed implementation passed.
- On Windows these shell cases ran in an existing Linux image with no network, no Docker socket, read-only source/policy mounts and a bounded disposable temporary filesystem. The adapters cannot contact a real daemon. Linux CI runs the same suite from the existing launch-readiness test, with no new production dependency or shared workflow edits.
- `scripts/verify-versioned-retention.mjs`: **9 real disposable-container checks passed**. Local report: `runtime/launch-evidence/versioned-retention-4d7783bab1b1/report.json`; database/storage image IDs and source hashes are recorded. It records a dirty worktree and is candidate evidence, not clean exact-release certification. Both test containers were cleaned up by the harness.
- API launch-readiness passed, including all 29 application security cases and browser privacy checks. On Windows the separate Linux invocation supplies the shell coverage.
- No Standard CatVTON model/pipeline settings, original 22 release-evidence decisions, dependencies or lockfiles changed. The protected Standard profile hash remains `b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`. Unrelated lower-body development remains outside this patch.

Hosted CI must verify the new commit before exact-release evidence can be claimed. Even a passing application/container scan does not close the Accelerate advisory, embedded Node/OpenSSL review, live staging, independent penetration testing, real privacy/operational drills, model rights/legal approval, delivered-workstation acceptance, four-request Standard quality/isolation or controlled pilot gates.

## Hosted verification for the CI reliability patch

[Run 39046413696](https://github.com/Tanish2022/Drapixai/actions/runs/39046413696) completed for clean commit `013b1199e0d3854369b26d8641b96068c47bbb4e`. Application, secret-scan, container-scan and checkpoint candidate jobs passed; AI contracts still failed on Accelerate 1.11.0 / `PYSEC-2026-3804` (one known finding, four existing exceptions). The application log confirms the 29 security cases, ten scanner cases, all nine real retention checks and successful builds/CSP/production/development dependency audits. The retention report has `dirtyCheckout: false`; every recorded source hash matches that commit.

Downloaded edge artifact `12105532980` has verified SHA-256 `3abf5c449daf2b3ff4e038f8aed88c8a394968cf06775b4711ce3f0f18eb669f`. Its API image is `sha256:35d10fc22b36871d42de574acca0976a2347bf7ebf7e65111f2138e390a47968`, and web image is `sha256:8a5fd544032382edfc2b75465a6a82474a7f1cbd476a2150c95effab6059841b`. Both raw reports match their recorded hashes and image IDs, their revision labels match the commit, and the reviewed VEX digest matches committed source. Both report zero HIGH/CRITICAL findings and scanner exit 0. The native compatibility report passes with zero dirty entries and matching images/Dockerfiles. It still records Node's embedded OpenSSL 3.5.8 separately from the Debian library; that review is not closed by a green scan.

Local verification manifest and downloaded bytes are under `runtime/launch-evidence/ci-reliability-2026-10-17/`. This is exact-commit repository/native-container evidence, not live staging, complete release approval or evidence for later commits. All original 22 gates remain required.
