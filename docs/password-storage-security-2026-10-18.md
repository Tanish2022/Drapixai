# Password storage and credential lifecycle — 18 October 2026

New credentials use versioned scrypt hashes over the complete UTF-8 input.
Existing shorter bcrypt credentials remain verifiable and upgrade after a valid
login. This is source remediation with synthetic local tests, not deployment,
an independent penetration test or complete authentication certification.

## Findings and behavior

| Finding | Evidence and impact | Change |
|---|---|---|
| Medium: password suffix truncation | Actual bcrypt accepted an original password, a different suffix and the bare shared 72-byte prefix. The current strength validator accepted both long passwords. ASCII and multibyte reproductions are retained in `runtime/launch-evidence/password-boundary-2026-10-18/before.json`. Knowledge of that prefix is required; this is not arbitrary account takeover. | New hashes bind every accepted byte. Legacy inputs at **or above 72 UTF-8 bytes** fail authentication and require verified password recovery. An old hash cannot establish whether its original password ended at that boundary. |
| Medium: stale password proof could outlive a reset | Password comparison preceded independent key issuance. A reset between them could revoke keys before the old login created another one. Account password changes also used an unconditional user update after verification. | A conditional user update checks the captured hash, version, role, email and verification state inside key issuance's transaction. It locks the same user row as resets. Account password changes use the same condition. |
| Medium: bootstrap rotation/promotion did not revoke credentials | Source inspection found bootstrap changed the configured operator's password/role without advancing `authVersion` or revoking keys. Existing assurance/expiry requirements still limited those keys; rotation itself was incomplete. | Password or privilege changes atomically advance the version, revoke keys and consume outstanding recovery codes. A format-only upgrade preserves the version and active sessions. Configured password whitespace is preserved. |
| Diagnostic privacy hardening | A synthetic hash-bearing diagnostic passed both bcrypt and scrypt encodings through the prior formatter. No deployed log disclosure was observed. | Both encodings are masked by the shared log formatter. |

## Storage and resource controls

Affected source and regression files:

| Boundary | Implementation / verification |
|---|---|
| Full-input storage and work cap | `apps/api/src/lib/password-hash.ts`, `apps/api/src/lib/security.ts`; `scripts/test-password-security.cjs` |
| Login/reset/creation paths | `apps/api/src/routes/auth.ts`, `apps/api/src/routes/account.ts`, `apps/api/src/services/admin-bootstrap.ts` |
| Conditional credential transaction | `apps/api/src/lib/api-key-auth.ts`; `apps/api/src/scripts/password-session-database-tests.ts` |
| Browser overload handling | `apps/web/app/api/admin/session/route.ts`, `apps/web/app/api/dashboard/session/route.ts`; `scripts/test-security-boundaries.cjs` |
| Automated and packaged checks | `apps/api/src/scripts/launch-readiness-tests.ts`, `apps/api/src/scripts/p0-database-tests.ts`, `scripts/verify-edge-container-runtime.mjs`, `scripts/verify-edge-image-binding.cjs` |

Node 22 supplies asynchronous scrypt without another password library. The
version fixes `N=32768`, `r=8`, `p=3`, a 16-byte random salt and a 64-byte derived
key, with a 64 MiB KDF allocation limit. This is the 32 MiB alternative in
[OWASP's password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
See [Node's scrypt interface](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

Two password work reservations per API process bound concurrent hashing and
legacy verification; there is no unbounded password-job queue. Existing Redis
IP/identity limits remain. Reserving before OTP consumption means overload
cannot consume a valid code. HTTP 503 and `Retry-After: 1` remain retryable through
both browser session proxies, with an ordinary user-facing availability message.

The existing 128 JavaScript code-unit limit remains; complete UTF-8 bytes are
hashed. Supplementary Unicode characters use two code units. Whitespace and
Unicode normalization are preserved. Invalid types, NUL and malformed UTF-16 are
rejected. Stored parameters, version, lengths and base64url encodings are checked
before work. Legacy bcrypt verification permits only the project's bounded
4–14 cost range (production previously used 12); unsupported/imported formats
need verified recovery. Six-digit OTP and explicitly gated legacy API-key hashing
retain their separate existing mechanisms.

An unknown account uses a public synthetic current-KDF sentinel and cannot
authenticate even with that sentinel's public fixture password. No claim of
identical latency across all legacy formats or deployment conditions is made.
Capacity is per process and must be measured across actual replicas.

Signup, recovery, account password changes, Google-created accounts and operator
bootstrap share this storage boundary. An algorithm-only upgrade does not change
the credential version. Actual password changes invalidate keys and pending
recovery codes. Recovery also checks captured account identity/version before
updating; a concurrent sensitive account change wins over the old request.

## Verification and scope

| Check | Evidence |
|---|---|
| Password crypto/route suite | **21/21 passed**: real bcrypt/scrypt, independent Python-derived vector, full-length ASCII/multibyte input, whitespace/normalization, legacy boundary recovery, invalid format/cost rejection, work-cap failure/recovery, OTP preservation, all creation paths and log redaction. Route database/mail adapters are synthetic. |
| Existing boundary suite | **86/86 passed**, including retryable administrator/merchant browser overload without cookie changes, plus prior MFA, object authorization, JWT, CSRF, transport and Redis fault controls. Native transport fixtures use loopback only. |
| Real disposable PostgreSQL | Successful upgrade with unchanged version; cross-user denial; changed role/email/verification/version denial; **observed reset/issuer row-lock race**; deliberate insert failure rolling back hash replacement and prior-key revocation; bootstrap promotion/rotation, exact whitespace, unchanged-session preservation and format-only upgrade. |
| Existing database regressions | P0 CORS/retention, append-only audit triggers, billing/quota races and rollback checks passed against a newly owned loopback PostgreSQL fixture. No production record was used. |
| TypeScript | API and web checking passed. |
| Exact Standard profile | `b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762` |

Commands: `node scripts/test-password-security.cjs`; the existing API launch
readiness command runs it and the boundary suite. The guarded P0 database suite
runs `verifyPasswordSessions`; its approval/loopback/disposable-database checks
are mandatory. Local evidence is under
`runtime/launch-evidence/password-boundary-2026-10-18/`.

The native container verifier is extended to run the **compiled P0 suite in the
actual API image**, using an owned database namespace, exact migrations and
`NODE_ENV=test`. It requires the new password module and the observed-race/
rollback output; an old image cannot satisfy this new check. This supplements
production-environment native/HTML checks and is not a live configuration test.
The exact-source API/web review images at `49b4d712bd681e2ead5fa645c7b42862c75ca9d4`
have since passed these native checks, including the actual compiled database
fixtures and six-execution alias-movement regression. The shared-runtime
application-check build also passed all 86 boundary/21 password cases, MFA,
RBAC, token, public API, upload and log-privacy suites, production web build and
five-route CSP checks. These are isolated review images; production Dockerfiles
remain unchanged. Exact scans and component binding are recorded in the
[verification record](security-assessment-2026-10-18-verification.md).

## Rollout requirements and remaining risks

Drain/replace old authentication replicas coherently before new-format writes.
Earlier API builds cannot verify scrypt records: a rollback needs a build that
retains the versioned reader. No bulk password migration or production deployment
was executed here. No database schema change is required.

Verify SMTP recovery delivery and seeded legacy accounts on approved staging
before rollout. Users with an exact-boundary or longer legacy password must use
the existing secure recovery flow; the response does not reveal their stored
format. Operator configuration remains authoritative on restart, so synchronize
credential changes with the secret store. Existing idle/absolute expiry and
one-use TOTP controls remain; individual operator enrollment, recovery and live
rotation/audit drills still need evidence. Broader Google account-link lifecycle,
deployed request containment and independent multi-tenant testing remain open.

No inference code, model weights, Standard settings, concurrency limits or launch
decisions were changed. Concurrent lower-body work is excluded. The separate
shared-OpenSSL runtime remains a review candidate; successful crypto tests do not
authorize production promotion, legal/model rights, hardware/GPU measurements,
controlled pilot or any other outstanding launch gate.
