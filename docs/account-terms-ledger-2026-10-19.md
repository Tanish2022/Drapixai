# Account terms implementation and local evidence — 19 October 2026

This is a local implementation and verification record, not legal approval,
deployment evidence or closure of any public-launch gate.

## Confirmed gap and implementation boundary

Initial inspection found that password registration sent no acceptance evidence
to the backend. Google synchronization could create an account and issue
credentials without recording terms acceptance. A browser checkbox alone could
not close either gap.

The archive, database ledger and transactional helper are now connected to
password registration, existing-account login, the protected Google identity
sync, browser acceptance and service credential resolution. No historical
acceptances are backfilled. Actual provider login, live deployment and qualified
approval remain unverified.

Password registration validates an explicit current revision before consuming
the OTP, then inserts the account and assent in one transaction. Existing and
Google accounts without current assent receive a 15-minute `terms:accept`
credential. `/auth/terms` requires a verified account and the dashboard proxy;
operator sessions must retain MFA. Acceptance atomically promotes the same
credential and records assent, so the OAuth JWT cannot later overwrite the
cookie with a replaced credential. Normal authenticated retries preserve the
original record. Promotion rechecks credential activity, expiry and scope;
revocation or a competing credential change can reject a concurrent attempt.

Dashboard pages check current backend state, and direct keys, preview tokens,
public API JWTs and both storefront token types independently enforce it. The
exception for operator identity verification is restricted to `GET /admin/verify`
and retains configured-operator, role and MFA checks; operational admin routes
have no terms exception. Logout accepts pending credentials so they can be
revoked. Recovery and public privacy/contact information remain available.

The browser endpoint enforces same-origin requests, forwards at most 2 KiB and
returns no credential. A pinned version/hash accompanies an unchecked checkbox;
stale wording or failed saves never result in navigation as if acceptance had
succeeded. Optional analytics and photo permissions remain separate choices.

## Retained version and data minimization

`apps/api/src/legal/terms-2026-10-19.json` retains the existing revised terms,
including the owner-confirmed business identity. `/terms` and the new
`/terms/2026-10-19` page render this same source. Unknown archive versions return
not found. The content is revisioned drafting material pending qualified review;
the date does not establish legal approval or a signed customer contract.

The helper pins SHA-256 of canonical `JSON.stringify` content:
`5a7e225d6a4608492105f4431f973460b9cbcd9506034af3a73501f63b34a24f`.
Silent source edits fail helper initialization. Future terms changes need a new
retained version and a reviewed acceptance/update rollout.

The ledger contains only account ID, document version/hash, server-selected flow
and database-generated acceptance time. It does not collect extra IP/device
details, and it does not combine contract assent with analytics or shopper-photo
consent. Input requires the literal boolean `true` and the exact version/hash;
client-supplied account IDs, timestamps, flow or device fields are rejected.

## Database protections and transaction behavior

The additive migration creates `TermsDocument` and `AccountTermsAcceptance`.
Document hashes are checked against retained content in PostgreSQL. A composite
foreign key binds every acceptance to the retained version/hash. Unique
account/version records preserve the first acceptance, including its original
time and flow, when a request is retried. PostgreSQL sets acceptance time even
if an insert attempts to supply a different value.

UPDATE, DELETE and TRUNCATE are rejected by triggers. Normal account deletion
cannot silently cascade through the ledger. These are application-role
protections, not proof against a database owner that can disable triggers.
Production privilege separation and audit/backup controls still need live proof.

An approved retention/erasure process for contractual records is still required.
This implementation must not be interpreted as permission for indefinite
retention, nor should account-deletion UX promise erasure that these foreign keys
will block. Qualified review must settle retention and restricted purge or
anonymization procedures before rollout.

## Verification

- Generated Prisma Client and API/web TypeScript checks passed locally.
- Strict input and pinned archive integrity checks passed.
- Disposable PostgreSQL SQL drill passed 16 checks: no fabricated backfill,
  database timestamps, duplicate/version/hash/flow rejection, content integrity,
  missing metadata, row mutation/truncation denial and restricted account deletion.
- Seven tests exercised the actual Prisma helpers against a new, empty disposable
  PostgreSQL: isolation between two accounts, failed-choice no-write behavior,
  archive mismatch rejection, transaction rollback, exact retained text/hash and
  idempotent retries under the immutable triggers.
- The SQL drill uses no host network or ports. The actual ORM drill temporarily
  publishes one localhost-only port. Both use random synthetic credentials,
  operate only on their own labelled container, save redacted evidence and remove
  that container. No Neon access, SMTP sending or operator database was used.
- One earlier SQL drill failed because its fixture encountered a duplicate
  acceptance before the intended foreign-key check. A second account isolates
  that negative control. The failed evidence is retained, not counted as a pass.
- The production web build passed with `--webpack` in an ignored review output.
  Browser rendering, archived-route behavior and final-source verification are
  recorded with the local evidence. Hosted CI has not been run for this patch.
- Browser testing found that the legal-page skip-link target existed only after
  its click handler ran. The shared legal-page main now has a stable ID and focus
  target in rendered HTML. Final browser checks exercise keyboard activation.
- Both public terms routes passed exact archive-text comparison, keyboard
  activation, 320px overflow checks and automated WCAG A/AA plus best-practice
  checks with zero violations/incomplete findings and no page exceptions. Desktop
  and mobile screenshots were inspected. Unknown versions now return HTTP 404
  before streaming starts, with no-index and no-store headers.
- The launch regression suite passed with normal local socket permissions:
  86 security-boundary cases, 21 password-security cases and 15 HTTP fixture-env
  controls. Its sandbox attempt failed native loopback fixtures with access
  denial; the approved rerun passed without changing those controls.

Local evidence is under ignored `runtime/launch-evidence/account-terms-*.json`.
The CI workflow and repository check manifest now require the validator and both
database drills. These source checks do not replace the original 22 deployment
and external-review gates.

## Enforcement verification after the foundation

- API TypeScript and the production Next.js review build passed. The launch
  regression suite passed with 95 security-boundary cases, 21 real-crypto
  password cases and 15 HTTP fixture-environment controls. Additional token and
  public API contract tests passed. This is local evidence, not hosted CI.
- Sixteen immutable-ledger SQL checks and seven actual Prisma transaction checks
  passed again against the current source and all migrations. Their reports are
  `runtime/launch-evidence/account-terms-7b3e5c046d092484.json` and
  `runtime/launch-evidence/account-terms-450d697e1a2b3fe7.json`.
- Nine production-mode HTTP checks passed with real Express routers, PostgreSQL
  and Redis. They include missing/declined/stale assent before OTP consumption,
  rejected foreign account fields, no inferred Google acceptance, restricted
  sessions, retry, password recovery, tenant isolation and logout. The protected
  provider-sync boundary is tested; this is not an actual Google-provider login.
- The integrated browser drill passed ten combined HTTP/database/browser checks:
  `runtime/launch-evidence/account-terms-02c8f89b29dfd9f3.json`. Headless Chrome
  used the production Next build, real BFF, production-mode auth/account/terms
  routers and disposable databases. Keyboard acceptance saved the exact hash in
  PostgreSQL, then accessed only that account through its HTTP-only cookie.
  A simulated 503 left real assent absent and allowed a successful retry.
- Desktop and 320px screenshots were visually inspected. A floating cookie
  preference button overlapped mobile form text; it now occupies normal flow on
  narrow screens. The final browser check verifies no overlap or overflow.
  Automated WCAG A/AA and best-practice checks returned no violations or
  incomplete findings, and no page exceptions occurred. These checks do not
  establish complete accessibility of the whole application.
- Browser details, source hashes, build ID and screenshots are in
  `runtime/launch-evidence/account-terms-integrated-browser-b39bda3b1ff3316c/`.
  The owned Next process stopped and the labelled fixture containers were
  removed. No operator database, Neon, SMTP, external browser traffic or GPU was
  used. The fixture mounts only the relevant real routers, not the full server.
- CI and the repository manifest now require the real HTTP drill as well as the
  validator, SQL and ORM drills. The original 22 release-evidence IDs and the
  Standard profile are retained. The legacy storefront lifecycle smoke now
  requires an empty disposable database and explicitly accepts terms over HTTP;
  that full-server smoke has not been rerun for this patch.
- A local Gitleaks 8.30.1 scan of all 90 modified/nonignored untracked source
  files returned zero findings. The first snapshot run flagged the published RFC
  TOTP seed because absolute scan paths failed the existing exact-file allowlist,
  and a fixed synthetic signing string in a new test. Running the scanner from
  the snapshot root restored the existing narrow RFC allowlist; the new signing
  fixture now generates an ephemeral key. No scanner rule or exclusion was
  weakened. Failed scan reports are retained. This checks the changed source
  snapshot only, not release images or current hosted Git history.

Reproduce the browser drill after a review build with matching
`NEXT_PUBLIC_WEB_BASE_URL=http://127.0.0.1:3117` and `NEXT_DIST_DIR` under
`.next-review/`. Run `node scripts/verify-account-terms-database.mjs --browser`
with a local Playwright module, browser executable and optional axe script
configured through `DRAPIXAI_PLAYWRIGHT_MODULE`, `DRAPIXAI_BROWSER_EXECUTABLE`
and `DRAPIXAI_AXE_SCRIPT`. It creates its own databases; never supply real data.

## Remaining review and rollout

1. Obtain qualified wording, privacy, retention and rollout approval. Immutable
   records need an approved contractual-record retention and erasure process;
   ordinary user deletion must not be advertised as deleting these records.
2. Run the actual Google-provider and operator browser journeys on isolated
   HTTPS staging, including parallel acceptance/revocation and provider failure.
   The local merchant journey and adapter tests do not substitute for those.
3. Build and scan final Linux release images, run hosted CI on the clean final
   commit and bind deployed results to exact artifacts. Re-run the full customer
   journey and storefront lifecycle smoke against that candidate.
4. Coordinate the additive migration and existing-account acceptance rollout:
   existing service credentials deliberately fail closed until current acceptance
   is recorded. No migration has been applied to Neon or an operator database.

No inference code, model, Standard parameters, score threshold or concurrency
limit is changed by this work.
