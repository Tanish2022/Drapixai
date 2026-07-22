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

A case passes the release gate only when every automated metric passes and an admin marks it approved. A category is consistent only when it has at least 12 eligible cases and at least 90% automated and admin-approved pass rates. Two consecutive complete passing runs are required.

## Commands

```bash
python deploy/runpod/validate_lower_body_benchmark.py

DRAPIXAI_ENABLE_LOWER_BODY=1 \
DRAPIXAI_LOWER_BODY_MATRIX_FILE=runtime/test_assets/lower_body_benchmark/manifest.json \
DRAPIXAI_LOWER_BODY_MATRIX_DIR=runtime/lower_body_benchmark/catvton-run-01 \
python deploy/runpod/run_lower_body_matrix.py

DRAPIXAI_LOWER_BODY_BENCHMARK_SUMMARIES="runtime/lower_body_benchmark/catvton-run-01/summary.json:runtime/lower_body_benchmark/catvton-run-02/summary.json" \
python deploy/runpod/evaluate_lower_body_model_decision.py
```

Use the platform path separator for the summary list (`:` on Linux, `;` on Windows).

## CatVTON Decision

CatVTON remains the baseline until the real benchmark is complete. If two sufficient runs show repeated silhouette failures, add a stronger bottoms-capable engine and run the identical manifest. FASHN VTON v1.5 is the first candidate because its official implementation supports bottoms and uses an Apache-2.0 code license. Fine-tuning is considered after side-by-side testing identifies whether the gap is model capacity, training distribution, masking, or texture conditioning.

No stronger model is promoted until it passes the same per-category gates and admin review.
