# Merchant onboarding simplification — 16 October 2026

The new `/onboarding` entry point gives brands one current task across three stages: add one product, complete a private preview, then verify and install on their store. Password signup and ordinary sign-in default to this flow; explicit safe return paths, including Shopify installation handoffs, remain intact.

## Changes

- Signup asks for brand name, email and password. The optional phone field remains in account settings. Email verification has its own screen with code autofill, resend and a way to correct account details. Terms acceptance and server verification remain required.
- A merchant can enter one product and upload its garment photo without preparing a CSV. This uses the existing authenticated catalog, upload and explicit mapping-confirmation endpoints. Upper-body launch categories are the only choices in this starter flow.
- Preparation, manual confirmation, completed previews for a prepared product, store ownership, recorded result approval, warning-free examples and quota determine the next action. Browser storage cannot mark setup complete. This is setup guidance, not a public-launch certificate or proof that a storefront widget is installed.
- Progress is loaded from the account. Failed loading has a retry action; known garment rejection codes explain how to fix the photo. Preparation failure does not erase saved catalog details.
- Technical setup and bulk management remain accessible through the full workspace. Direct links resolve after authenticated panels load.
- Settings now uses the session endpoint's `{ ok: true }` response instead of expecting a browser-visible API key. Permanent credentials remain in the existing server session/proxy flow.
- The new route has the same signed-session protection, CSP and no-index headers as the other private workspace routes.

## Verification and limits

- Node 22 onboarding state tests cover pending/rejected photos, missing caches, missing mappings, lower-body exclusion, unrelated/failed/missing previews, ownership, result review, allowance and safe error messages. These checks run in CI.
- TypeScript and the production web build pass; existing launch-readiness contract tests pass.
- Browser checks use the production frontend with an isolated loopback mock API and synthetic accounts/images. They cover authentication redirect, product save, explicit photo confirmation, progress after reload, preview and installation stages, unavailable-service recovery, Settings access and mobile rendering. These fixtures are not real preparation, approval or quality evidence.
- Real email delivery, live staging, merchant usability sessions, actual garment preparation, GPU try-on quality and storefront installation still need integration evidence. This work does not close those launch gates.
- No inference model, Standard quality setting, realism threshold, concurrency limit or backend approval rule was changed.
