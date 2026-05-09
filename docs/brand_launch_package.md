# DrapixAI Brand Launch Package

This is the non-GPU launch pack for introducing DrapixAI try-on to fashion brands.

## Brand-Facing Assets

- Demo video: show one real product page, upload person photo, generate result, and review the final try-on image.
- Before/after examples: include original person image, original garment image, final result, quality score, and latency.
- Integration docs: point developers to `drapixai_ai/docs/garment_api.md` and `drapixai_ai/docs/sdk_react.md`.
- Pricing confidence: communicate upper-body launch scope, standard mode, expected 10-12 second warm latency, and review-backed quality control.
- Onboarding checklist: use the checklist below before giving a brand live SDK access.
- Supported garments list: publish the current launch scope below.

## Onboarding Checklist

1. Brand account created and plan selected.
2. Production domain saved and API key domain locked.
3. Catalog products synced through `/sdk/catalog/sync`.
4. Garment-only images uploaded through `/sdk/garments`.
5. Garment-to-product mappings confirmed.
6. At least five internal try-ons reviewed in admin quality review.
7. Average warm latency checked against the 10-12 second target.
8. Any warnings reviewed before sending public traffic.
9. SDK installed on one product template first.
10. Live rollout starts with limited product coverage.

## Supported Garments

Launch-ready:
- plain shirts
- graphic or printed shirts
- t-shirts
- polos
- blouses
- clean upper-body tops
- short upper-body kurtis with tight framing

Beta:
- hoodies
- sweatshirts
- sleeveless tops
- checked or high-detail shirts
- dark garments and white garments that pass preprocessing

Not supported for public launch:
- long kurtas
- coats
- jackets
- blazers
- cardigans
- layered outerwear
- dresses
- pants
- model-worn garment photos
- lifestyle images where the garment cannot be isolated

## Quality Review Gate

Every launch candidate should be checked in the admin quality review screen:

- person input
- garment input
- result
- quality score
- latency
- warnings
- approve/reject decision

Approve only when the output preserves face, pose, body shape, garment color, sleeve style, hem behavior, and natural lighting.

## Demo Video Outline

1. Open a product page with the DrapixAI button installed.
2. Upload a clear front-facing person photo.
3. Generate one standard try-on result.
4. Show the result image beside the garment image.
5. Show admin quality review with score and latency.
6. End with the integration promise: one SDK install, confirmed product mapping, image bytes plus quality and latency metadata.

## Launch Notes

- A100/RunPod testing remains the production quality gate.
- Local work can finish SDK, admin review, documentation, onboarding, and launch assets.
- Public launch should not start until one full staging try-on succeeds through the live API, storage, Redis, and A100 AI worker.
