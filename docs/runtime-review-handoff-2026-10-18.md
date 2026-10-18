# Runtime review handoff — 18 October 2026

Status: **prepared locally; qualified independent review and production approval
remain outstanding**. This package advances the dependency-review handoff. It
does not close an original launch gate, authorize deployment, certify GPU
quality/capacity, or replace the independent deployed penetration test.

## Frozen local package

Path: `runtime/review-handoff-2026-10-18/drapixai-runtime-review-2026-10-18.zip`.
Size: **99,206,614 bytes**, with **66 inventoried files** and `manifest.json`.
SHA-256:

`9bb48f3537c27e6d982d34b5a5bc23ce0d86e77e00e0247655338bc582e3286a`

The ZIP remains ignored by Git and has not been uploaded, sent to a reviewer,
installed, or promoted. Operator configuration, shopper data, application image
exports, model checkpoints and ephemeral TLS private keys are excluded. Raw
synthetic evidence retains local test paths and public release-signer identities.

Use the verifier from the trusted project checkout, with the externally recorded
digest above:

```bash
python deploy/security/verify_review_bundle.py \
  runtime/review-handoff-2026-10-18/drapixai-runtime-review-2026-10-18.zip \
  --expected-sha256 9bb48f3537c27e6d982d34b5a5bc23ce0d86e77e00e0247655338bc582e3286a
```

Actual result: `INTEGRITY_VERIFIED_REVIEW_PENDING`, 66 files, production approval
and independent-review completion both false. The verifier reads ZIP entries
without extraction or execution. Its seven unit tests cover corruption, wrong
external digests, unsafe paths, duplicates/symlinks, resource limits and false
approval/schema claims. Passing checks establish integrity only.
All seven tests passed on Windows and in a bounded, offline Linux container.

## Contents and provenance

| Material | Exact scope |
|---|---|
| Node component image | `sha256:a669f066061d612f69d6d2e7bd69a93d180e77d5541e8b79c0e24d45843a646b`, built at `1bc8cbbb687a8e95e1f48e67d303be98c757b3d2`; public runtime components only |
| Node source/crypto evidence | Signed-source metadata, public release-key snapshot, core/TLS positive and negative controls, upstream logs/report with 656 non-skipped cases and four explicit skips |
| Application compatibility | Actual shared-runtime application/native/HTTP checks, raw API/web scans, archive/live bindings and retained hosted evidence at `8e84b203d4661ec1e7a9edd341a0a88ef981a3a7`; application images excluded |
| Checkpoint candidate | Exact passed CI artifact **12139849634**, built from `06a92126b3aa6213e318c2a7d4a0a5eadb9c6322`; artifact digest `6425cf40e3ab0cc5653cbcd0bfc43bf68d4827b2d24d833885b5920820398e9b` |
| Candidate wheel | Accelerate 1.11.0, build tag `1drapixai`, SHA-256 `df4a6437e7da0feffc99abec20ad71ef8972ddaf3ffa9d6a2e3c16b901133e2d`; no requirement pin or audit exception changed |
| Candidate source comparison | Exact upstream wheel, patch diff, candidate RECORD hashes checked; only loader/WHEEL/RECORD changed and patch metadata added; other upstream bytes and notices preserved |
| Review tools | Source snapshots from their actual commits, plus the prepared read-only bundle verifier/tests; individual bytes inventoried in the manifest |
| Inventory | Offline CycloneDX inventory and separate live Node bundled-component versions/provenance; this is not an exhaustive SBOM certification or a new vulnerability scan |
| Decision template | All reviewer, decision and signature fields unfilled; approval flags false; a reviewer must supply a separate artifact-specific decision |

These source commits intentionally differ. Their evidence must not be collapsed
into one claimed approved release. Five component-verifier inputs were also
checked byte-identical to their recorded committed source. The exported image's
OCI digest links, layer/diff hashes, Node/SSL/crypto/provenance bytes and observed
notices matched the tested component. Its configuration contains only PATH and
SSL_CERT_FILE; it contains no application tree or operator `.env`/private keys.

The component-image and evidence-triage record is
`runtime/review-handoff-2026-10-18/evidence-triage-and-component-binding.json`,
SHA-256 `d5f79b20fe676240da9f8ee746ba03f21ab147e1f7edb75e6a8023e0aee558b3`.

## Scanner and upstream observations

The active text scan of package payloads produced two generic-key matches in
`evidence/application/hosted-verified.json`. Both are the public image-reference
strings for `drapixai-api` and `drapixai-web` at the known 40-character commit
`8e84b203d4661ec1e7a9edd341a0a88ef981a3a7`. Parsed values were checked against
that public commit. They are not authentication credentials. The frozen raw
evidence is retained, the triage is recorded, and no scanner policy exception
was added. This is not described as a zero-finding scanner run.

Rechecked 18 October: [official PyPI metadata](https://pypi.org/pypi/accelerate/json)
still lists 1.15.0. The downloaded official wheel matches SHA-256
`97eacca0b73e45cb867dbf8c5d5d4dc32219544300e0c8992c7334dc2ef33cec`;
read-only inspection found the direct shard-path join in its indexed loader.
The [proposed fix](https://github.com/huggingface/accelerate/pull/4214) remains
closed without merging. No 1.15.0 loader was installed/executed, and moving
outside an [advisory](https://osv.dev/vulnerability/PYSEC-2026-3804) version range
is not accepted as proof of remediation. The isolated 1.11.0 patch remains the
review candidate; production remains unchanged.

## Required reviewer decisions

The internal REVIEW.md asks a qualified reviewer to assess advisory/backport
applicability, the shared Node build/ABI/providers/trust and bundled dependencies,
checkpoint path/type validation and model-provisioning assumptions, maintenance
ownership, rollout/rollback and notices/redistribution obligations. Observed
license files are not legal clearance. CPU loader tests do not certify the
ordered GPU software/hardware environment or Standard realism.

The decision must name the reviewer and qualifications/independence, exact bundle
and component digests, scope, findings/retest, maintenance conditions and signed
decision reference. It belongs outside this frozen package. Nobody has supplied
that decision in this session; the included template is not a sign-off.
The owner confirmed on 18 October that qualified security/runtime and legal
reviewers have **not been appointed yet**. No reviewer contact or evidence
transfer has been authorized or performed.

The latest preceding [CI run 39137760272](https://github.com/Tanish2022/Drapixai/actions/runs/39137760272)
completed application, container, secret and checkpoint-candidate checks
successfully; AI contracts still fail on Accelerate `PYSEC-2026-3804`. That
passing candidate job validates its CPU scope, not promotion. Live staging,
operator/retention/backup drills, independent deployed pentest/retest, legal/model
rights, delivered GPU acceptance, all four independent >=0.95 outputs and
latency/headroom/isolation/soak, and pilot/founder approval remain required.

The Standard profile remains unchanged at SHA-256
`b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`.
