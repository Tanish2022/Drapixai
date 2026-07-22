# Lower-Body A100 Results - 2026-07-22

## Decision

Lower-body generation is operational on the A100 for all seven category routes, but it is not approved for public launch yet. Keep `DRAPIXAI_ENABLE_LOWER_BODY=0` in public production and retain admin review.

## Test Environment

- GPU: NVIDIA A100 80GB PCIe
- Driver: 570.133.20
- Python: 3.12.3
- PyTorch: 2.8.0+cu128
- CatVTON source: `7818397f25613beedb3d861a34769f607cfcf3b1`
- CatVTON weights: `2969fcf85fe62f2036605716f0b56f0b81d01d79`
- Stable Diffusion inpainting: `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`
- VAE: `31f26fdeee1355a5c34592e401dd41e45d25a493`
- Inference: 768x1024, 28 steps, guidance 2.5, safety checker enabled

## Matrix Results

Synthetic workflow matrix:

- Runtime generation: 7/7 categories
- Runtime failures: 0
- Average quality score: 0.8192
- Average latency including cold first case: 14.08 seconds
- Warm average latency: 9.51 seconds
- Safety replacements: leggings and joggers on the flat synthetic mannequin

Initial public-demo-person matrix:

- Runtime generation: 5/7
- Onboarding rejections: 2/7
- Average generated quality score: 0.8203
- Warm average latency: 9.46 seconds
- Manual review found incorrect garment shape, coverage, or framing in several generated cases

The initial real-person matrix also revealed that four CatVTON demo images were cropped at the thigh or hip. The validator has been updated to reject these as `LOWER_BODY_CROPPED`, while allowing valid low-contrast full-body white outfits with `LOW_DETAIL_LOWER_BODY` warnings.

## Fixed During Testing

- RunPod matrix runner now resolves the repository import path itself.
- CatVTON patch preparation now recognizes the configured local VAE change across line-ending differences.
- Synthetic people and garments now satisfy strict onboarding without bypass.
- Safety-check replacements are tagged `SAFETY_CHECK_BLOCKED` and score zero.
- Postprocessing no longer modifies a safety replacement image.
- Matrix reports generation success separately from quality success.
- Matrix records average and warm latency and exits nonzero on strict quality failure.
- Lower-body person onboarding rejects bottom-clipped subjects and no longer rejects valid low-contrast full-body outfits solely for low edge density.
- Lower-body color correction, texture refinement, lighting, and sharpening are now restricted to the intersection of CatVTON's generation mask and the category mask.
- The original person is composited back outside the feathered lower-body region, protecting the background, face, upper garment, hands, and shoes.

## Localized Postprocessing Verification

The five available real-person outputs were reprocessed with the new localized stack before another A100 upload. Mean absolute pixel difference outside the category mask fell from `1.62-9.65` to `0.00-0.01`. Aggregate scores improved in every case:

| Category | Before | After | Outside difference after |
| --- | ---: | ---: | ---: |
| Jeans | 0.804 | 0.829 | 0.003 |
| Pants | 0.866 | 0.880 | 0.002 |
| Skirt | 0.727 | 0.757 | 0.001 |
| Leggings | 0.881 | 0.885 | 0.010 |
| Joggers | 0.826 | 0.844 | 0.001 |

This verifies background and context protection, but it does not validate model realism. Old generations with a wrong silhouette remain wrong after reprocessing and must still fail admin review. A fresh A100 run is required because only the engine captures the exact CatVTON generation mask.

## Remaining Public-Launch Gates

- Rerun the revised code and fully framed seven-category matrix on the A100.
- Replace synthetic garments with production-grade front-facing catalog images for every category.
- Achieve average quality score at least 0.90 and the configured per-result threshold.
- Obtain at least 80% admin approval with no repeated waist, crotch, leg, hem, or shoe defects.
- Run concurrency, queue, cancellation, timeout, and memory-pressure tests after single-job quality passes.
- Verify the existing upper-body matrix after the shared safety-reporting change.

## Current Release State

Internal engineering testing may continue. Public launch remains blocked by realism quality and the absence of production-grade lower-body garment fixtures, not by A100 capacity or warm inference speed.

The new `lower-real-v1` benchmark gate now requires at least 12 commercially cleared cases per category, targets 24, requires 90% automated and admin-approved pass rates, and requires two consecutive passing runs. Until those assets are populated, the model decision remains `insufficient_real_data`; CatVTON is retained only as the measured baseline.
