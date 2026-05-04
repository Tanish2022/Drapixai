# CatVTON migration execution gates

This file tracks the strict migration plan after the initial code wiring.

## Step 12: Expanded Test Matrix

The current baseline has 6 cases. Before switching production default, expand to 30-50 real garment-only cases covering:

- plain t-shirt
- graphic t-shirt
- checked shirt
- hoodie
- sleeveless top
- blouse
- short kurti
- dark garment
- white garment
- printed garment
- different skin tones
- different body types
- different poses

Each case must include:

- person source
- garment source
- processed garment image
- result image
- engine
- quality score
- candidate count
- warnings
- manual review notes

## Step 13: Benchmark CatVTON

Run the expanded matrix:

```bash
DRAPIXAI_TRYON_ENGINE=catvton python deploy/runpod/smoke_matrix.py
```

Compare:

- realism
- body preservation
- face preservation
- garment preservation
- failure rate
- latency
- VRAM usage

## Step 14: CatVTON Default

CatVTON is the only active engine:

```bash
DRAPIXAI_TRYON_ENGINE=catvton
DRAPIXAI_MODEL_DIR=models/catvton
```

## Step 15: Feedback Learning

Implemented schema targets:

- `TryOnResult`
- `TryOnFeedback`

The storefront SDK stores generated result metadata and accepts feedback through `/sdk/tryon-feedback`.

## Step 16: Dashboard Quality Review

Implemented API targets:

- `GET /admin/tryon-results`
- `POST /admin/tryon-results/:id/approve`
- `POST /admin/tryon-results/:id/reject`

UI review screens should show input person, garment, result, score, engine, feedback, approve, and reject.

## Step 17: Legacy Engine Removal

Legacy engine removal scope:

- remove legacy third-party checkout
- remove legacy preparation script
- remove legacy model env defaults
- remove legacy deploy docs
- remove legacy imports

## Step 18: Production Rollout

Rollout order:

1. local test
2. RunPod single smoke test
3. RunPod full matrix
4. staging API
5. internal dashboard preview
6. limited customer test
7. production default
