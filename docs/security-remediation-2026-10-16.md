# API and web dependency remediation, 2026-10-16

Scope: work packages 1, 2 and limited browser checks for package 15. This is
repository/local verification, not live staging, AI image, penetration-test or
public-launch approval.

## Changes

- API: Nodemailer 10.1.1, Multer 2.4.0 and Sharp 0.35.5; resolved proxy-addr
  2.0.8. These replace versions flagged by the fresh npm audit.
- API development: replace Nodemon with Node 22's native watch mode using
  `node --watch --require ts-node/register src/bootstrap.ts`. Remove the
  now-unused brace-expansion override and vulnerable watcher dependency graph.
- Web: Next.js 16.3.8 and Sharp override 0.35.5. Replace Tailwind 3's affected
  glob/parser dependencies with Tailwind and @tailwindcss/postcss 4.3.3; update
  source scanning, legacy utilities and the CSS cascade. Retain existing custom
  theme configuration and blur/radius/shadow/ring compatibility values. Preserve
  a visible focus outline above utility styles.
- CI and repository gate manifest now audit development/build dependencies for
  both API and web, in addition to production dependencies. High/critical
  findings remain blocking; no advisory is suppressed by this change.

## Verification performed

- Full resolved API and web npm audits (`--include=dev --json`): each reported
  zero known vulnerabilities on the verification run. This is a dated advisory
  database result and must be repeated for the release.
- API TypeScript build, upload security regressions, transactional email-template
  regressions and launch contracts passed.
- Fresh isolated `npm ci --ignore-scripts` installs passed for both final
  manifests/lockfiles without modifying the active application installations.
- Offline Nodemailer MIME/envelope composition passed for text/HTML alternatives,
  reply-to and suppression headers; no SMTP connection or email was sent.
- Production Next.js Webpack build and TypeScript check passed for all 28 pages.
- Actual production HTML CSP checks passed on home, privacy, pricing, login and
  administrator access: fresh matching nonces, caller-override rejection and
  no-store HTML.
- Browser smoke checks: desktop homepage at the normal 1280px viewport; mobile
  homepage, login and pricing at 390px. Those mobile pages had no horizontal
  document overflow. The login focus-outline regression found during review
  was fixed and its visible solid outline rechecked in the rebuilt website.
- Isolated native-watch fixture: initial TypeScript execution produced value 1;
  modifying an imported TypeScript module restarted it and produced value 2.
  The fixture invoked no application bootstrap, database or email service.
- Immutable Standard profile verifier passed its 24 expected values. No AI
  inference source, requirements, model revisions or release settings changed.

## Remaining work

Required Linux CI and exact built-container scans still need results for the
committed release. The open AI dependency finding and GPU certification remain
separate blockers. Browser smoke coverage does not establish authenticated
customer-journey, accessibility, Safari/Firefox or integration certification.
Tailwind 4's documented browser baseline is Safari 16.4+, Chrome 111+ and Firefox
128+; verify the intended customer browser matrix before launch. Actual SMTP
delivery and onboarding must be tested on isolated staging.

## Upstream references

- [Next.js RCE advisory and patched versions](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
- [Nodemailer release history](https://github.com/nodemailer/nodemailer/releases)
- [Tailwind migration, compatibility and browser requirements](https://tailwindcss.com/docs/upgrade-guide)
