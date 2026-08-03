# Lower-Body Real Benchmark

## Release Policy

Lower-body remains internal and admin-reviewed. Public production keeps `DRAPIXAI_ENABLE_LOWER_BODY=0`. No category graduates because of an average score; every category must independently satisfy intake, automated quality, admin approval, and repeatability gates.

## Asset Policy

Benchmark assets must be real photographs with commercial evaluation rights. Person images require confirmed consent or a model release. Garments must be owned, merchant-supplied, or commercially licensed product images. Synthetic fixtures, scraped catalog media, and unknown-rights assets are calibration-only and cannot set a release decision.

DressCode is not used for DrapixAI's company benchmark because its official terms state that the dataset is not released to private companies. Use DrapixAI-owned shoots and merchant-authorized catalog assets instead.

## Coverage

Each category requires at least 12 eligible cases before a decision and targets 24 cases for V1 confidence. Every category must contain at least two values for pose, body shape, background, color family, texture, and fit.

Execution order:

1. Jeans and pants
2. Trousers and joggers
3. Shorts
4. Skirts
5. Leggings

The canonical manifest is `runtime/test_assets/lower_body_benchmark/manifest.json`. A complete case shape is in `runtime/test_assets/lower_body_benchmark/case.example.json`.

## Region Masks

Every category has independent masks for:

- Waist
- Crotch
- Knee
- Hem
- Ankle
- Shoe

Shorts treat knees, ankles, and shoes as preservation regions. Skirts do not apply the pants crotch gate and protect ankles and shoes. Full-length categories evaluate all garment regions and preserve shoes. The runner saves each mask in the case output under `region_masks/` for manual inspection.

## Quality Gates

Automated gates remain separate:

- Overall lower-body score
- Silhouette and coverage score
- Texture preservation
- Color preservation
- Face, upper-body, and background context preservation
- Waist, crotch, knee, hem, ankle, and shoe thresholds

A case passes the release gate only when every automated metric passes and an admin marks it approved with all four review dimensions rated at least 4/5 and no severe failure. A category is consistent only when it has at least 12 eligible cases, at least 90% automated pass rate, and at least 95% admin and combined pass rates. Two complete passing runs with distinct seeds are required. Each run must have zero inference failures, zero severe visual failures, and A100 end-to-end p95 latency at or below 35 seconds.

## Commands

```bash
python -m drapixai_ai.scripts.download_fashn_vton \
  --weights-dir /workspace/drapixai/models/fashn-vton-1.5

python deploy/runpod/verify_lower_body_runtime.py \
  --weights-dir /workspace/drapixai/models/fashn-vton-1.5 \
  --output runtime/lower_body_runtime_verification.json \
  --load-model

python deploy/runpod/validate_lower_body_benchmark.py

DRAPIXAI_ENABLE_LOWER_BODY=1 \
DRAPIXAI_LOWER_BODY_ENGINE=fashn_vton \
DRAPIXAI_FASHN_ENABLE_POSTPROCESS=0 \
DRAPIXAI_LOWER_BODY_RUN_ID=fashn-v1-seed-42 \
DRAPIXAI_LOWER_BODY_BENCHMARK_SEED=42 \
DRAPIXAI_LOWER_BODY_MATRIX_FILE=runtime/test_assets/lower_body_benchmark/manifest.json \
DRAPIXAI_LOWER_BODY_MATRIX_DIR=runtime/lower_body_benchmark/fashn-v1-seed-42 \
python deploy/runpod/run_lower_body_matrix.py

python deploy/runpod/apply_lower_body_admin_reviews.py \
  --summary runtime/lower_body_benchmark/fashn-v1-seed-42/summary.json \
  --reviews runtime/lower_body_benchmark/fashn-v1-seed-42/reviews.json \
  --output runtime/lower_body_benchmark/fashn-v1-seed-42/reviewed-summary.json

# Repeat the identical manifest with run ID fashn-v1-seed-43 and seed 43,
# then apply its independent review file.
python deploy/runpod/evaluate_lower_body_release.py \
  --intake-report runtime/lower_body_benchmark_validation.json \
  --approvals runtime/lower_body_benchmark/release-approvals.json \
  --summaries \
    runtime/lower_body_benchmark/fashn-v1-seed-42/reviewed-summary.json \
    runtime/lower_body_benchmark/fashn-v1-seed-43/reviewed-summary.json \
  --output runtime/lower_body_benchmark/release-decision.json

python deploy/runpod/calibrate_lower_body_scorer.py \
  --summaries runtime/lower_body_benchmark/*/reviewed-summary.json \
  --output runtime/lower_body_benchmark/scorer-proposals.json
```

Before the two release runs, execute one same-seed A/B comparison with `DRAPIXAI_FASHN_ENABLE_POSTPROCESS=0` and `1`. Select one frozen configuration through admin review; do not mix configurations in the two release runs. Calibration writes proposals only and never changes production thresholds automatically.

## CatVTON Decision

CatVTON remains the measured baseline. The seven-case diagnostic showed materially cleaner FASHN silhouettes, especially for pants, joggers, shorts, and skirts, but those assets are not release eligible. FASHN VTON 1.5 is therefore the active candidate, not an approved public model. Fine-tuning is considered only after reviewed real cases identify a repeatable model limitation.

`evaluate_lower_body_release.py` can only emit `eligible_for_manual_public_enable`; it never changes `DRAPIXAI_ENABLE_LOWER_BODY`. Public launch remains blocked while the canonical manifest has no commercially cleared cases.

The release-approval document must include named approvers and evidence references for the FASHN code/weights, the human-parser model license, DWPose attribution, benchmark asset rights, privacy/retention, and security review. The human-parser model card identifies an NVIDIA SegFormer license, so it requires explicit legal clearance before public commercial use or redistribution.
