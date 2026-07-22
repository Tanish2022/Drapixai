# DrapixAI Lower-Body Quality Stack Plan

Lower-body try-on will ship as a future, feature-flagged extension of the current CatVTON production stack. The existing upper-body launch path remains the only public production path until this stack passes RunPod matrix review and admin approval.

## Product Scope

Initial lower-body scope:

- Jeans
- Pants
- Trousers
- Shorts
- Skirts
- Leggings
- Joggers

Release ladder:

- V1: CatVTON lower mode for jeans, pants, trousers, shorts, skirts, leggings, and joggers
- V1 quality: DrapixAI lower-body validator, lower masks, lower scorer, and admin review
- V1 release: internal beta only

Explicitly out of v1:

- Sitting poses
- Crossed legs
- Multi-person photos
- Shoes try-on
- Full outfits
- Sarees, salwar sets, and other complex draped garments
- Transparent or highly reflective lower garments
- Video try-on

## Production Principle

The lower-body engine is:

```txt
CatVTON lower mode + DrapixAI quality stack
```

CatVTON is the generation core. DrapixAI owns production quality through validation, preprocessing, mask safety, scoring, cache versioning, debug artifacts, admin review, and controlled rollout.

## Category Profiles

Lower-body V1 follows the same principle as upper-body: every garment type has its own processing profile rather than sharing one generic lower-body path.

- Jeans, pants, trousers: full-length two-leg masks, strict crotch/leg integrity, waistband and shoe preservation.
- Shorts: shorter thigh-length mask, stronger hem check, lighter shoe dependency.
- Skirts: wider drape mask, stronger hem alignment, crotch artifact checks relaxed because the garment structure is different.
- Leggings: tight full-leg mask, stricter coverage and leg integrity expectations.
- Joggers: relaxed full-leg mask with cuff/ankle emphasis and stronger shoe preservation.

The API carries the category into generation as an internal profile key such as `lower:shorts`; public request shape remains `garment_type=lower` plus `garment_category`.

## Release Safety

Lower-body is disabled by default:

```txt
DRAPIXAI_ENABLE_LOWER_BODY=0
```

The storefront Node API and SDK remain upper-body-only until a later public beta decision. The AI service can only accept lower-body requests when the lower-body feature flag is enabled.

Required future beta flags:

```txt
DRAPIXAI_ENABLE_LOWER_BODY=1
DRAPIXAI_LOWER_BODY_ALLOWED_CATEGORIES=jeans,pants,trousers,shorts,skirt,leggings,joggers
DRAPIXAI_LOWER_BODY_ADMIN_REVIEW_REQUIRED=1
DRAPIXAI_LOWER_BODY_PRESERVE_SHOES=1
DRAPIXAI_LOWER_BODY_RESTORE_CONTEXT=1
DRAPIXAI_LOWER_BODY_POSTPROCESS_FEATHER=5
DRAPIXAI_LOWER_BODY_POSTPROCESS_MASK_INSET=2
DRAPIXAI_LOWER_BODY_COLOR_FIX_STRENGTH=0.78
DRAPIXAI_LOWER_BODY_CACHE_VERSION=lower-v1-1024x1365
```

Lower-body postprocessing is confined to the intersection of CatVTON's generation mask and the category-specific lower mask. The original person image is restored outside that region, preserving the background, face, upper-body garment, hands, and shoes. Color transfer and texture refinement run only inside the inset, feathered garment region so they cannot recolor nearby pixels or create a hard outer halo.

## Software Requirements

Existing production stack remains the baseline:

- Next.js storefront and dashboard
- Node/Express API
- PostgreSQL and Prisma
- Redis and RQ
- FastAPI AI service
- Python GPU worker
- CatVTON model runtime
- S3, MinIO, or local image cache
- Admin review queue

AI runtime requirements:

- `torch==2.4.0`
- `torchvision==0.19.0`
- `diffusers==0.31.0`
- `transformers==4.46.3`
- `accelerate==0.31.0`
- `xformers==0.0.27.post2`
- `Pillow`
- `opencv-python-headless`
- `numpy`
- `scikit-image`
- `rembg`
- `onnxruntime`
- `pycocotools`

CatVTON requirements:

- CatVTON checkout: `drapixai_ai/third_party/CatVTON`
- Weights: `models/catvton`
- Base model: `runwayml/stable-diffusion-inpainting`
- CatVTON repo: `zhengchong/CatVTON`
- AutoMasker dependencies: DensePose and SCHP
- Lower-body cloth type: `lower`

Hardware requirements:

- A100: production-quality validation and preferred launch GPU
- A10: staging and acceptable backup
- T4: smoke tests only
- Windows/local: syntax and integration checks only

## Input Standards

Person image v1:

- Full-body standing photo
- One person
- Waist, hips, knees, ankles, and feet visible
- Front-facing or slight angle
- Minimal occlusion
- Clear lighting
- Minimum useful size: `512px` shortest side

Hard rejects:

- `LOWER_BODY_NOT_VISIBLE`
- `WAIST_NOT_VISIBLE`
- `ANKLES_NOT_VISIBLE`
- `FULL_BODY_REQUIRED`
- `PERSON_IMAGE_TOO_SMALL`
- `SITTING_POSE_UNSUPPORTED` once pose checks are added
- `MULTI_PERSON_UNSUPPORTED` once person count checks are added

Garment image v1:

- Garment-only product asset
- Clean or transparent background
- Full waistband visible
- Full hem visible
- Both pant legs visible for pants and jeans
- No person wearing the garment
- One garment per image

Hard rejects:

- `LOWER_BODY_NOT_ENABLED`
- `LOWER_GARMENT_CROPPED`
- `WAISTBAND_NOT_VISIBLE`
- `HEM_NOT_VISIBLE`
- `BOTH_LEGS_NOT_VISIBLE`
- `MODEL_WORN_GARMENT`
- `GARMENT_NOT_ISOLATED`
- `UNSUPPORTED_LOWER_CATEGORY`

## Implementation Phases

### Phase 1: Locked Scaffolding

Status: implemented.

Deliverables:

- Lower-body feature flags in settings
- Lower-body person validator scaffold
- Lower-body fallback masks
- V1 lower garment rule profiles marked as `future_lower_beta`
- AI service gate that rejects lower-body unless enabled
- Pipeline metadata that labels lower-body as beta quality profile
- Planning document

No public product behavior changes in this phase.

### Phase 2: Lower-Body Validation

Deliverables:

- Add pose/keypoint based checks for waist, hips, knees, ankles, and stance
- Add lower-body occlusion detection
- Add one-person validation
- Add category-aware garment checks for waistband, hem, and both legs
- Add unit tests for accepted and rejected cases

### Phase 3: Masking

Deliverables:

- Prefer CatVTON AutoMasker with `cloth_type="lower"`
- Store mask debug artifacts
- Tune pants, shorts, skirt, leggings, and joggers fallback masks
- Preserve shoes by default
- Protect upper body, face, hands, and background

### Phase 4: Cache And Preprocessing

Deliverables:

- Separate lower-body cache version
- Lower-body cache regeneration path
- Lower-body thumbnails
- Lower-body admin cache status
- Lower-body preprocessing metadata

### Phase 5: Quality Scoring

Status: V1 implemented.

Deliverables:

- Category-aware scoring profiles
- Lower-body score metrics:
  - face preservation
  - upper-body preservation
  - background preservation
  - waistband alignment
  - left/right leg integrity
  - knee preservation
  - ankle preservation
  - shoe preservation
  - lower-garment color similarity
  - lower-garment texture similarity
  - hem alignment
  - crotch artifact risk
  - pose preservation
  - overall realism
- Lower-body warnings:
  - `WAISTBAND_MISALIGNED`
  - `LEFT_LEG_ARTIFACT_RISK`
  - `RIGHT_LEG_ARTIFACT_RISK`
  - `KNEE_ARTIFACT_RISK`
  - `ANKLE_ARTIFACT_RISK`
  - `SHOE_CHANGED_RISK`
  - `UPPER_BODY_CHANGED_RISK`
  - `LOWER_GARMENT_COLOR_DRIFT`
  - `LOWER_GARMENT_TEXTURE_DRIFT`
  - `CROTCH_ARTIFACT_RISK`

### Phase 6: RunPod Matrix

Status: runner implemented; production matrix still requires real lower-body test assets and RunPod execution.

Deliverables:

- `deploy/runpod/run_lower_body_matrix.py`
- Jeans/pants/trousers matrix
- Quality score summary
- Common warning summary
- Manual approval list
- Before/after/mask debug export

Launch gates:

- Average quality score >= `0.90`
- Admin-approved rate >= `80%`
- No repeated severe leg distortion
- No repeated shoe corruption when preserve-shoes is enabled
- No severe face/background changes

### Phase 7: Internal Beta

Deliverables:

- Dashboard lower-body beta upload controls
- Admin review filters
- SDK types prepared but public SDK still disabled by default
- Account-level allowlist
- Beta documentation

### Phase 8: Category Expansion

Order:

1. Shorts
2. Skirts
3. Leggings
4. Joggers
5. Full outfit composition

Each category must receive its own validation, mask tuning, scoring, and matrix approval before release.

## Current Code Touchpoints

Initial scaffolding:

- `drapixai_ai/configs/settings.py`
- `drapixai_ai/services/lower_body_validator.py`
- `drapixai_ai/services/garment_rules.py`
- `drapixai_ai/services/garment_preprocessor.py`
- `drapixai_ai/preprocess/mask_builder.py`
- `drapixai_ai/engines/catvton.py`
- `drapixai_ai/pipeline/tryon_pipeline.py`
- `drapixai_ai/api/ai_server.py`

Future touchpoints:

- `drapixai_ai/quality/tryon_scorer.py`
- `drapixai_ai/preprocess/person_analyzer.py`
- `drapixai_ai/preprocess/garment_analyzer.py`
- `apps/api/src/routes/sdk.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/public/sdk.js`
- `apps/web/global.d.ts`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/admin/page.tsx`
- `deploy/runpod/run_lower_body_matrix.py`

## Non-Negotiables

- Upper-body production behavior must stay unchanged.
- Lower-body must remain feature-flagged until matrix approval.
- Public SDK must stay upper-body-only until beta release.
- Browser SDK lower-body initialization must require explicit `enableLowerBody`.
- Server-side flags are the security boundary; client flags are only a convenience gate.
- Lower-body results must be labelled with `lower_body_v1`.
- Admin review is required before any lower-body public release.

## V1 Security Gates

Lower-body V1 is designed for controlled beta and later public release. Keep these gates intact:

- `DRAPIXAI_ENABLE_LOWER_BODY=0` by default in production examples.
- Node `/sdk/tryon` rejects `garment_type=lower` unless the server flag is enabled.
- AI `/ai/tryon` and `/ai/tryon/base64` reject lower-body unless the AI service flag is enabled.
- Dashboard uploads send explicit `garment_type`; lower uploads are rejected when the flag is off.
- Lower-body garment cache uses `lower-v1-1024x1365`, separate from upper-body `v3-1024x1365`.
- Lower-body garments are stored as `pending` by default, even if general garment approval is disabled.
- Product confirmation rejects upper/lower type mismatches.
- Browser SDK requires `enableLowerBody: true` before accepting `garmentType: "lower"`.
- CORS exposes the lower-body quality profile header for review tooling.
- Matrix runner refuses to run without `DRAPIXAI_ENABLE_LOWER_BODY=1`.

## Lower-Body Matrix File Format

Create `runtime/test_assets/lower_body_matrix.json`:

```json
{
  "cases": [
    {
      "slug": "jeans_front_model_01",
      "person_path": "runtime/test_assets/persons/model_01.png",
      "garment_path": "runtime/test_assets/lower/blue_jeans.png",
      "category": "jeans",
      "notes": "front standing, shoes visible"
    }
  ]
}
```

Run on RunPod after assets are present:

```bash
DRAPIXAI_ENABLE_LOWER_BODY=1 python deploy/runpod/run_lower_body_matrix.py
```

Use `deploy/runpod/lower_body_matrix.example.json` as the manifest shape. Either copy that structure to `runtime/test_assets/lower_body_matrix.json` or point the runner at another file with `DRAPIXAI_LOWER_BODY_MATRIX_FILE`.
