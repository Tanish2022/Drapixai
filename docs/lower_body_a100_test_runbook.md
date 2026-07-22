# Lower-Body A100 Test Runbook

This runbook is for validating lower-body try-on on an A100 before any public release decision. Lower-body remains feature-gated and admin-review gated while this test runs.

## Scope

Categories to test:

- jeans
- pants
- trousers
- shorts
- skirt
- leggings
- joggers

Public release is not approved until all categories pass strict onboarding, GPU generation, output inspection, and admin review sampling.

## Required Pod

Preferred GPU:

- A100 80GB

Minimum software baseline:

- Python environment with DrapixAI AI dependencies installed
- CatVTON checkout available at `drapixai_ai/third_party/CatVTON`
- CatVTON weights available under `models/catvton`
- Redis/worker stack only if testing queue flow; direct matrix runner does not require the Node API

## Required Environment

For strict lower-body matrix testing:

```bash
export DRAPIXAI_ENABLE_LOWER_BODY=1
export DRAPIXAI_GARMENT_BLUR_CHECK=0
export DRAPIXAI_LOWER_BODY_ALLOWED_CATEGORIES=jeans,pants,trousers,shorts,skirt,leggings,joggers
export DRAPIXAI_LOWER_BODY_ADMIN_REVIEW_REQUIRED=1
export DRAPIXAI_LOWER_BODY_PRESERVE_SHOES=1
export DRAPIXAI_LOWER_BODY_RESTORE_CONTEXT=1
export DRAPIXAI_LOWER_BODY_POSTPROCESS_FEATHER=5
export DRAPIXAI_LOWER_BODY_POSTPROCESS_MASK_INSET=2
export DRAPIXAI_LOWER_BODY_COLOR_FIX_STRENGTH=0.78
export DRAPIXAI_LOWER_BODY_CACHE_VERSION=lower-v1-1024x1365
```

Do not set `DRAPIXAI_LOWER_BODY_MATRIX_ALLOW_BYPASS=1` for public launch QA. That flag is only for debugging bad assets.

The strict runner also defaults `DRAPIXAI_LOWER_BODY_MATRIX_FAIL_ON_QUALITY=1`. It exits nonzero when inference fails, the safety checker blocks an output, or a generated result scores below `DRAPIXAI_MIN_QUALITY_SCORE`.

For realism QA, compare each output against the original person and garment. Pixels outside the lower-body generation region must remain unchanged, and manual review must reject wrong garment silhouettes even when the automated color or texture score passes.

## Required Assets

For release-quality testing, use the commercially cleared real benchmark described in `docs/lower_body_real_benchmark.md`. Validate intake before loading the GPU:

```bash
python deploy/runpod/build_lower_body_benchmark_manifest.py
python deploy/runpod/validate_lower_body_benchmark.py
```

The older synthetic and public-demo matrices remain useful for runtime debugging, but they are not release evidence.

Create:

```txt
runtime/test_assets/lower_body_matrix.json
runtime/test_assets/lower_body/
runtime/test_assets/lower_body/garments/
```

Use `deploy/runpod/lower_body_matrix.example.json` as the manifest template. Each case needs:

- `slug`
- `person_path`
- `garment_path`
- `category`
- `notes`

Person image rules:

- Full-body standing person
- Waist, hips, knees, ankles, and shoes visible
- Single person
- Front-facing or slight pose
- Clear lighting
- No sitting, crossed legs, heavy occlusion, or cropped feet

Garment image rules:

- Garment-only product image
- Clean or transparent background
- Waistband and hem visible
- Both legs visible for jeans, pants, trousers, leggings, and joggers
- One garment per image
- No model-worn garment asset

## Preflight Commands

From repo root on the A100 pod:

```bash
nvidia-smi
python deploy/runpod/validate_lower_body_v1_scaffold.py
DRAPIXAI_ENABLE_LOWER_BODY=1 DRAPIXAI_GARMENT_BLUR_CHECK=0 python deploy/runpod/validate_lower_body_v1_scaffold.py
DRAPIXAI_ENABLE_LOWER_BODY=1 DRAPIXAI_GARMENT_BLUR_CHECK=0 python deploy/runpod/debug_lower_body_onboarding.py
```

Expected:

- Disabled scaffold rejects preprocessing with `LOWER_BODY_NOT_ENABLED`
- Enabled scaffold validates person, lower masks, and lower scorer
- Onboarding debug accepts all seven categories with distinct profile keys

## Matrix Run

Strict full run:

```bash
DRAPIXAI_ENABLE_LOWER_BODY=1 python deploy/runpod/run_lower_body_matrix.py
```

Single-case timing run:

```bash
DRAPIXAI_ENABLE_LOWER_BODY=1 DRAPIXAI_MATRIX_START=0 DRAPIXAI_MATRIX_LIMIT=1 python deploy/runpod/run_lower_body_matrix.py
```

Category slice:

```bash
DRAPIXAI_ENABLE_LOWER_BODY=1 DRAPIXAI_MATRIX_START=3 DRAPIXAI_MATRIX_LIMIT=2 python deploy/runpod/run_lower_body_matrix.py
```

Outputs:

```txt
runtime/lower_body_matrix/summary.json
runtime/lower_body_matrix/*/summary.json
runtime/lower_body_matrix/*/person.png
runtime/lower_body_matrix/*/garment_processed.png
runtime/lower_body_matrix/*/result.png
```

The top-level report separates `succeeded` generation from `quality_passed`, records `average_latency_ms` and warm latency excluding the first cold case, and exposes `launch_gate_passed`. Synthetic fixtures are workflow tests only and cannot satisfy the public-launch realism gate.

## Timing Fields

Record for every case:

- `latency_ms`
- `candidate_count`
- `quality_score`
- `candidate_scores`
- GPU model and memory from `nvidia-smi`
- inference steps and guidance scale

Timing targets for public launch planning:

- Target A100 single output: 20-60 seconds
- Investigate: 60-90 seconds
- Not launch-ready for public interactive flow: above 90 seconds average

The final target depends on candidate count, queue load, model warmup, and whether quality reranking generates multiple candidates.

## Quality Gates

Pass requirements:

- 100% strict preprocessing pass for production-grade assets
- Average quality score >= `0.90`
- No severe waist misalignment
- No repeated left/right leg distortion
- No repeated shoe corruption when preserve-shoes is enabled
- No face, upper-body, or background damage
- At least 80% admin-approved sample rate
- No category has a repeated severe failure pattern

Manual inspection checklist:

- Waistband attached naturally to body
- Hips and crotch area realistic
- Left and right legs preserved
- Knees and ankles not warped
- Shoes preserved unless intentionally outside scope
- Hem length matches category
- Garment texture is not painted flat
- Upper body, hands, face, and background remain unchanged

## Launch Decision

Public launch is blocked if any of these happen:

- Matrix uses validation bypass
- Any category is missing from the matrix
- Real A100 output images are not inspected
- Average latency is too high for the intended UX
- Quality score passes but manual review finds repeated realism defects
- Upper-body production path changes during lower-body enablement

Lower-body can move to internal beta only after strict matrix success and manual review. Public launch should remain behind `DRAPIXAI_ENABLE_LOWER_BODY=0` until product approval.
