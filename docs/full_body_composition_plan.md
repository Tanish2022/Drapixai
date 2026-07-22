# DrapixAI Full-Body Composition Plan

## Status

Deferred. Do not begin full-body outfit implementation until the lower-body pipeline has passed its production-quality gates.

The current upper-body Standard pipeline must remain unchanged while lower-body quality is being proven.

## Start Condition

Full-body development may begin only after lower-body testing demonstrates:

- Production-grade assets for every supported lower-body category
- No repeated severe waist, crotch, leg, hem, ankle, or shoe defects
- No severe face, pose, upper-body, or background changes
- Average calibrated quality score of at least `0.90`
- Human/admin approval rate of at least `90%`
- Zero critical warnings on approved results
- Warm Standard latency at or below `12 seconds` for one lower-body generation
- Successful queue, timeout, cancellation, concurrency, and memory-pressure tests
- Upper-body regression matrix still passing after shared pipeline changes

Until these conditions pass, keep public lower-body and full-body features disabled.

## Objective

Combine one cached upper garment and one cached lower garment on the same full-body person image while preserving:

- Face and identity
- Original pose and body silhouette
- Hands and exposed skin
- Upper-garment color, texture, structure, sleeves, and hem
- Lower-garment color, texture, waistband, legs, and hem
- Shoes and background
- A natural waist transition between both garments

Full-length dresses and other one-piece garments are not upper-plus-lower compositions. They require a separate CatVTON `overall` pipeline.

## Architecture

```text
full-body person image
+ cached upper garment
+ cached lower garment
-> full-body validation
-> garment and layering analysis
-> upper, lower, protected, and waist-transition masks
-> lower-body generation
-> restore original context outside lower mask
-> upper-body generation with lower region protected
-> region-aware full-body composition
-> full-outfit quality scoring
-> approve, reject, or send to admin review
```

## Generation Strategy

### Quality Reference: Two-Pass Generation

1. Validate the full-body person image.
2. Generate the lower garment from the original person.
3. Restore the original face, hands, upper body, background, and shoes outside the lower mask.
4. Use the protected lower-body result as context for upper-body generation.
5. Prevent the upper mask from modifying lower-owned pixels, except for a narrow waist transition band.
6. Composite the final image using region ownership and feathered masks.
7. Apply color, texture, lighting, and detail restoration only inside the relevant garment masks.
8. Score the complete outfit and reject unsafe results.

Do not join two images with a straight horizontal waist cut.

### Future Performance Path: Single-Pass Outfit Cache

The two-pass pipeline is the quality reference but will likely require approximately two model inference times on one GPU. After it passes quality review:

1. Pre-compose the approved upper and lower assets into a normalized outfit-conditioning cache.
2. Generate once through CatVTON `overall` mode.
3. Compare the single-pass result against the two-pass reference matrix.
4. Adopt single-pass production only if garment accuracy, pose preservation, and realism remain equivalent.

The target remains `10-12 seconds`, but latency optimization must not reduce realism.

## Waist And Layer Ownership

The outfit metadata must define which garment owns the waist transition:

| Outfit style | Waist owner | Rule |
| --- | --- | --- |
| Untucked shirt or T-shirt | Upper | Upper hem is rendered over the waistband |
| Tucked shirt | Lower | Waistband stays visible and owns the transition |
| Cropped top | Lower | Upper mask ends before the waistband |
| Hoodie or sweatshirt | Upper | Upper garment owns the hip overlap |
| Long kurti | Overall pipeline | Excluded from composition V1 |
| Jacket over another top | Layered pipeline | Excluded from composition V1 |

Example internal metadata:

```json
{
  "upper_product_id": "SH-1042",
  "lower_product_id": "TR-2081",
  "layering_style": "untucked",
  "waist_owner": "upper"
}
```

## Protected Regions

Always restore these regions from the original person unless a category-specific rule explicitly allows modification:

- Face and hair
- Hands and exposed skin
- Background
- Shoes
- Body areas outside both garment masks

Only these regions may change:

- Upper garment region
- Lower garment region
- Narrow waist transition region

The transition region must use feathered alpha blending and category-aware ownership.

## Planned Modules

```text
drapixai_ai/pipeline/full_body_tryon_pipeline.py
drapixai_ai/preprocess/full_body_validator.py
drapixai_ai/preprocess/outfit_mask_builder.py
drapixai_ai/preprocess/outfit_layering.py
drapixai_ai/quality/full_body_scorer.py
```

The orchestrator will call the existing upper-body and lower-body paths. It must not duplicate or weaken their proven behavior.

## Full-Body Quality Metrics

The full-body scorer must measure:

- Face and identity preservation
- Pose and body-silhouette preservation
- Upper-garment color and texture accuracy
- Upper-garment sleeve, collar, structure, and hem accuracy
- Lower-garment color and texture accuracy
- Waistband, leg, and lower-hem accuracy
- Waist transition realism
- Hand, ankle, shoe, and background preservation
- Edge and rectangular blend artifacts
- Background color cast
- Overall photographic realism

## Critical Rejection Warnings

```text
UPPER_GARMENT_CHANGED
LOWER_GARMENT_CHANGED
WAIST_BLEND_ARTIFACT
POSE_CHANGED
BODY_SHAPE_CHANGED
FACE_CHANGED
HAND_CHANGED
LEG_ARTIFACT
SHOE_CHANGED
BACKGROUND_CHANGED
BACKGROUND_COLOR_CAST
OUTFIT_NOT_PHOTOREALISTIC
```

Any critical warning prevents the result from being shown to a shopper.

## Rollout Order

```text
lower-body quality proof
-> local full-body orchestration tests
-> A100 two-pass reference matrix
-> admin-only dashboard review
-> approved brand beta
-> single-pass optimization comparison
-> limited shopper rollout
-> public full-body release
```

## Non-Negotiables

- Upper-body Standard remains the stable public path.
- Lower-body must pass its gates before full-body development begins.
- Full-body remains independently feature-flagged and disabled by default.
- One-piece dresses are handled separately through `overall` mode.
- No quality claim is accepted from an automated score alone; human matrix review is required.
- Do not trade garment realism, pose preservation, or identity preservation for latency.
