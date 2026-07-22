# Lower-Body A100 Diagnostic - 2026-07-22

## Scope

- Internal diagnostic only; no public-release approval.
- Seven garment categories: jeans, pants, trousers, joggers, shorts, skirt, and leggings.
- Real full-body model photos from the CatVTON demo set.
- Generated photographic flat-lay garments. These are useful for defect discovery but are not eligible release-benchmark evidence.
- Engines: DrapixAI CatVTON lower mode at 28 steps and FASHN VTON v1.5 at 50 steps.
- GPU: NVIDIA A100 80 GB PCIe.

## Automated Results

| Engine | Cases rendered | Mean DrapixAI score | Automated release passes |
| --- | ---: | ---: | ---: |
| CatVTON lower mode | 7/7 | 0.8282 | 0/7 |
| FASHN VTON v1.5 | 7/7 | 0.8155 | 0/7 |

The scores are not sufficient for model selection by themselves. The current anatomy metrics compare fixed regions with the original person and therefore penalize legitimate silhouette changes at the waist and hem. They also under-represent severe layered-garment artifacts in some CatVTON outputs. Thresholds must not be lowered to force a pass; the scorer needs calibration against reviewed real examples.

## Visual Review

| Category | CatVTON finding | FASHN finding | Current decision |
| --- | --- | --- | --- |
| Jeans | Plausible basic silhouette, but denim detail is soft and edges are blurred. | Cleaner leg shape and hem; denim remains softer than the product input. | FASHN candidate; texture work remains. |
| Pants | Original jeans waistband and pockets remain above the generated pants. | Coherent high-waist tailored pants with clean legs and shoes. | FASHN clearly preferred. |
| Trousers | Smooth, low-detail legs with weak garment construction. | Coherent navy trousers with crease and clean ankle termination. | FASHN clearly preferred. |
| Joggers | Severe transparent/missing section through one leg. | Coherent jogger silhouette, knee seam, cuffs, and preserved shoes. | CatVTON rejected; FASHN preferred. |
| Shorts | Jeans continue below the shorts as knee-high artifacts. | Coherent denim shorts with exposed legs and preserved shoes. | CatVTON rejected; FASHN preferred. |
| Skirt | Original jeans remain visible above and below a blurred black overlay. | Coherent A-line skirt with clean waist and hem. | CatVTON rejected; FASHN preferred. |
| Leggings | Coherent output, but surface texture and seams are mostly lost. | Coherent fitted leggings on a walking pose with clean ankle boundaries. | FASHN preferred; both need real-data detail checks. |

## Timing

- CatVTON warm cases: approximately 8-9 seconds each after a roughly 59-61 second cold start.
- FASHN 50-step diffusion: approximately 12 seconds on the A100.
- FASHN official single-case process: approximately 55-100 seconds end to end because every command reloads the model, pose detector, and parser.
- A persistent FASHN worker is required before latency can be compared fairly with the persistent CatVTON pipeline.

## Decision

1. Keep `DRAPIXAI_ENABLE_LOWER_BODY=0` for public traffic.
2. Keep CatVTON as the measured lower-body baseline and fallback only.
3. Integrate FASHN v1.5 behind a separate internal lower-body engine flag; do not change the upper-body engine path.
4. Rework waist, hem, coverage, and category silhouette scoring using admin-reviewed real examples before changing thresholds.
5. Run at least 12 commercially cleared cases per category, two seeds per case, followed by admin review.
6. Do not approve a category until its automated and admin pass rate meets the existing category gate across both runs.

## Artifacts

- CatVTON outputs: `runtime/runpod_lower_body_all_category_catvton_a100` and `runtime/runpod_lower_body_all_category_catvton_tail_a100`
- FASHN outputs: `runtime/runpod_lower_body_all_category_fashn_a100`
- FASHN scoring report: `runtime/runpod_lower_body_all_category_fashn_a100/drapixai_score_summary.json`
- Diagnostic manifest: `runtime/test_assets/lower_body_all_category_photographic_diagnostic_matrix.json`
