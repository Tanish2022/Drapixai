# Audit change log

All paths are relative to the repository. Audit baseline: `1cb769148ef51773bdaaadf0098106cea0375176`. Pre-existing lower-body work is separate and excluded from this change set.

| File created or modified | Rationale |
| --- | --- |
| `.gitignore` | Ignore the isolated `.next-compliance-audit` build output. |
| `.gitleaks.toml` | Enable default detection rules, which the prior allowlist-only config omitted. Add narrow rule-specific exceptions for reviewed exact documentation/model/config literals and the RFC TOTP vector only in its test file; no rule disabled or whole-file/commit exclusion added. |
| `.github/workflows/launch-readiness.yml` | Run scanner-policy negative controls before history scanning. Only this hunk belongs to the audit; concurrent lower-body workflow hunks are excluded. |
| `deploy/scripts/test-secret-scanner-policy.py` (new) | Demonstrate the ineffective-rule negative control, detect a synthetic token with the real policy, accept exact public examples, and still detect a credential adjacent to an allowed example. No real token or service call. |
| `package.json` | Add `test:website-privacy` for the actual consent/tracking module regression. |
| `apps/api/src/scripts/launch-readiness-tests.ts` | Execute that behavioral privacy regression in the existing launch contract test, which CI already runs after installing web dependencies. No production API behavior changed. |
| `apps/web/app/lib/privacy-preferences.ts` (new) | Versioned, bounded-life browser choice without a consent identifier; fail-closed reads/writes; analytics withdrawal and local visitor-ID removal. |
| `apps/web/app/components/PrivacyPreferences.tsx` (new) | Equal-prominence reject/accept, optional defaults off, customize/save, persistent reopening, cross-tab synchronization and status feedback. Panel uses normal document flow to avoid covering focused page content. |
| `apps/web/app/lib/analytics.ts` | Check current consent before each event or ID access; tolerate blocked storage; stop sending referrer. No preconsent event replay. |
| `apps/web/app/components/SiteAnalytics.tsx` | Track the current page on acceptance only; react to withdrawal/storage changes; omit page title. |
| `apps/web/app/providers.tsx` | Mount choices; avoid an exception when appearance storage is blocked. |
| `apps/web/app/cookies/page.tsx` | Describe the actual storage names/durations, current controls, external-media load and limits of withdrawal. No company, commercial, governing-law or certification facts invented. |
| `apps/web/app/components/SkipToContent.tsx` (new) | Keyboard bypass focuses the main heading and scrolls without animation. Uses hydrated client behavior. |
| `apps/web/app/layout.tsx` | Expose the shared bypass control before repeated content. |
| `apps/web/app/components/SupportAssistant.tsx` | Named native modal, Escape, keyboard cycling in both directions, trigger focus return and announced conversation log; omit dangling closed-dialog ARIA reference. |
| `apps/web/app/components/LegalPage.tsx` | Darken low-contrast update labels, table-of-contents label and section numbers. No contractual paragraphs changed here. |
| `apps/web/app/demo/DemoClient.tsx` | Do not mount external media before explicit load; identify hostname, omit iframe referrer, narrow permissions; improve low-contrast text. Try-on submission, consent version and generation parameters preserved. |
| `apps/web/proxy.ts` | Permit the already-supported YouTube privacy-enhanced embed hostname in CSP after explicit media load. Does not add tracking scripts or broad CSP exceptions. |
| `apps/web/app/page.tsx` | Darken measured low-contrast labels; make SDK code sample focusable for keyboard scrolling. Claims, pricing and media preserved for verification. |
| `apps/web/app/help/page.tsx` | Darken low-contrast text; give code panels keyboard access and accessible region names. |
| `apps/web/app/docs/page.tsx` | Darken low-contrast endpoint/counter/metric labels. API contract unchanged. |
| `apps/web/app/auth/register/page.tsx` | Darken step numbers only; no new legal assent or signup/business rule. |
| `scripts/test-website-privacy.cjs` (new) | Execute real TypeScript modules in an isolated browser-like window; no network/database use. Covers opt-in/out, expiry, malformed state, storage errors, failed withdrawal, cross-tab deletion and referrer minimization. |
| `scripts/audit-website-browser.cjs` (new) | Fresh anonymous loopback-only browser test and 12-route axe scan with API/external interception, keyboard/modal/video/reflow checks and local artifacts. No application dependency added. |
| `docs/compliance/2026-10-17/README.md` (new) | Entry point and evidence/approval boundaries. |
| `docs/compliance/2026-10-17/audit-report.md` (new) | Findings, requirements, evidence, severity, actions and implementation status. |
| `docs/compliance/2026-10-17/applicability-matrix.md` (new) | Conditional jurisdictions with primary sources and current/future commencement distinctions. |
| `docs/compliance/2026-10-17/data-inventory.md` (new) | Lifecycle, browser mechanisms, vendor/transfer and licence/claims inventory. |
| `docs/compliance/2026-10-17/legal-review-checklist.md` (new) | Business/counsel decisions, proposed owners and closure evidence. |
| `docs/compliance/2026-10-17/legal-drafts.md` (new) | Unpublished drafts and explicit unresolved decision fields; no new refund entitlement or restriction. |
| `docs/compliance/2026-10-17/risk-register.md` (new) | Open risks and limitations, preserving all external launch gates. |
| `docs/compliance/2026-10-17/verification-report.md` (new) | Actual results, failed build path, scanner scope and unavailable checks. |
| `docs/compliance/2026-10-17/change-log.md` (new) | This file. |

Ignored local artifacts: `runtime/compliance-tools/` contains pinned axe-core 4.14.0 solely for testing; `runtime/launch-evidence/website-compliance-2026-10-17/` contains the raw before/after browser reports, screenshots, npm audit and local scanner evidence. Browser tests used a synthetic demo-video configuration and intercepted its request; no real third-party video was fetched. No production dependency or lockfile changed. Next-generated audit-specific imports/includes in `next-env.d.ts` and `tsconfig.json` were restored after the isolated build rather than committed.

No changes were made to prices/refunds/billing, contractual obligations, model weights, inference/masks/scoring, Standard release settings, environment secrets or production infrastructure. No independent attack, production deployment or external communication was performed. A fresh npm dependency-metadata audit was run only after the user's explicit approval.
