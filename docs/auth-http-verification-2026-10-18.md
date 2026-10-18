# Authentication HTTP verification — 18 October 2026

This extends [credential verification](password-storage-security-2026-10-18.md)
beyond synthetic route adapters and direct database calls. The new fixture mounts
the actual compiled authentication/account routers on a minimal Express host,
uses real PostgreSQL and Redis, and issues real loopback HTTP requests. It does
not start the full production server or claim live staging, external SMTP,
Google/MFA-provider, inference quality or independent penetration-test coverage.

## Containment and evidence

`scripts/verify-auth-http-runtime.mjs` creates only its own randomly labelled
containers. PostgreSQL starts with networking disabled; Redis and API share only
that container's loopback namespace. No bridge to external infrastructure or
published host port exists. The fixture uses a new test-named database and Redis
DB 15; both must be empty before fixtures are created. Only explicit synthetic
environment values enter the API container; SMTP and configured operator
identity/authenticator are forbidden. Source addresses in `127.0.0.0/8` represent
separate fixture clients through real TCP, without trusting forwarded headers.
Requests are sequential; these clients are not evidence of simultaneous
try-on capacity, fairness, GPU memory headroom or shopper latency.

Signup/recovery OTPs are seeded with the real verification-code helper. The
routes perform actual bcrypt OTP verification and one-time consumption, but this
does not prove mailbox ownership or delivery. Mail transport remains disabled.

The wrapper resolves the API to an immutable ID and requires its revision label
to match the verifier's exact commit. It uses pinned PostgreSQL/Redis service
references and records actual image IDs, compiled fixture SHA-256, source/migration
hashes, output hash and cleanup outcome. Containers are resource bounded. A
failed Docker-client observation does not authorize a duplicate run; final
cleanup removes only containers with this invocation's exact random label.

The native edge verifier runs this fixture against its already inspected API
image ID. The alias-movement regression also verifies that nested image binding.
The parent embeds the exact nested JSON bytes and hash, so the existing CI
artifact upload retains the complete HTTP evidence rather than an orphan link.
Historical four-group reports retain their original scope; the expanded verifier
requires five groups, including six HTTP check groups in the nested report.

Run from a clean checkout matching the API image's exact revision label:

```bash
node scripts/verify-auth-http-runtime.mjs drapixai-api:EXACT_RELEASE_COMMIT
```

The existing native edge verification command invokes it automatically. The
wrapper accepts an image reference, never an operator database, Redis URL or
external target. Do not relabel an old image to satisfy the revision check.

## Required checks

1. Real HTTP signup/login binds the full input and rejects altered long suffixes
   and the shared 72-byte prefix; responses remain private.
2. Dashboard proxy denial and own-profile success; supplied user/role/email/hash/
   plan fields cannot change ownership or elevate privileges.
3. Account password change revokes the prior key and pending recovery codes;
   the new multibyte input works and the old input fails.
4. A short legacy credential upgrades without advancing its version; ambiguous
   bcrypt boundary inputs cannot authenticate or migrate.
5. Verified recovery consumes its OTP once, revokes old sessions, accepts the new
   complete input and leaves the other tenant unchanged.
6. Repeated invalid login reaches the actual Redis-backed identity limit with
   `Retry-After`; rate counters have real positive expirations.

The guard suite rejects missing approvals, remote/non-test databases, unsafe
database options, remote/default-DB Redis, SMTP/operator configuration, weak proxy
configuration and non-production router mode before connecting to services.
The existing launch suite runs this pure guard test; packaged HTTP execution is
required by the native container verifier.

## Status

At implementation revision `3f0dcc640303fc29c18e9e2a7a527620b69764ef`, API
TypeScript, one positive/fourteen negative guard controls, the full launch suite
(86 boundary and 21 password cases), all six packaged HTTP groups and the expanded
five-group native/alias regressions passed locally. Its hosted application,
container, secret and checkpoint-candidate jobs also passed in
[run 39136660135](https://github.com/Tanish2022/Drapixai/actions/runs/39136660135);
AI contracts remained blocked by the known Accelerate advisory.

The final retained-evidence implementation is
`8e84b203d4661ec1e7a9edd341a0a88ef981a3a7`. Its exact-source shared-runtime
application-check build passed 86 boundary/21 password cases and the guard
controls, MFA/RBAC/token/public-API/upload/log-privacy suites, production web build
and CSP checks. Both matching review images passed all five native groups, the
six HTTP groups, the alias-movement and nested-digest regression, fresh unchanged
High/Critical scans (zero findings each), offline source/archive verification
and live Node/library binding. This does not promote the shared runtime.

| Review image | Immutable ID |
|---|---|
| API | `sha256:3f894453e14c2774e69286247204ecd12bf43b70a02d9436c384c6f2d090155a` |
| Web | `sha256:1fd2defa37184eb16558e90630f4f5eff83b3f112a04b963ddbee0a0b9498fd5` |

Local evidence under `runtime/security-candidate/node-shared-openssl/`:

| Record | SHA-256 |
|---|---|
| Offline source/archive verification | `c9676e767f58eb2292ea633bf97c4609788206504ef2108e605322314eff2e97` |
| Live component binding | `50d667571f9ce13d51b39631d533c867215bab72376fc785f5ac2880fa4a1b9c` |
| Five-group native report | `09126f4c9bbcef1f22a5b7c8e0878bbcb6333bd4b6ebd32f37644c80fb8d1170` |
| Alias/nested evidence regression | `33bed385fe3ecf23cff4ee8814e1f8179d3c925b51a2b228fc1f5131888e4ae3` |
| Raw API Trivy report | `efed2b60b70c4f4e7ffc43973a3cdf35eaceb4c03ac84ca11630763f8be1b006` |
| Raw web Trivy report | `9df3d3ee0ab020c21ac3bdafc3ece2b93a4e5d61d99719f555546cc9c2fdcfc1` |

The offline record verifies all 552 committed-source inputs, allowed Windows
checkout line-ending conversions, retained nested bytes, raw scan/OCI layer
hashes and the actual compiled HTTP fixture against the recorded running-image
fixture hash. Live probes matched both images to the tested Node/OpenSSL
component. Filenames are `application-review-8e84b20-offline-verified.json`,
`application-review-8e84b20-live-binding.json`, `scan-8e84b20/` and the isolated
checkout's `runtime/launch-evidence/edge-runtime-b053e25103d4.json` and
`edge-image-binding-999fb638ed9f614bf541/report.json`.

## Retained hosted evidence

[Run 39137130464](https://github.com/Tanish2022/Drapixai/actions/runs/39137130464)
completed its application, container, secret and checkpoint-candidate jobs
successfully. AI contracts failed on `accelerate 1.11.0 / PYSEC-2026-3804`.
The application log confirms the new guard controls, all 86/21 security cases,
existing database/retention/restore checks and four final npm audits with zero
vulnerabilities. This is not an all-green run or public-launch clearance.

The downloaded container artifact **12140267368** has SHA-256
`ba73a08ff04a0e014206319b4f08cdc93fc2c7255506425a19a228ab3ebbc3a1`,
matching GitHub's recorded digest. It contains the complete embedded six-group
HTTP JSON, its exact hash and compiled fixture digest, all five parent groups,
and both raw passing production API/web scan reports. Offline verification
matched raw source/verifier/migration hashes, clean checkout state, exact image
IDs/revisions, VEX and raw report hashes. The compiled fixture hash also matches
the local review image. These CI images use the unchanged stock runtime;
they truthfully report embedded OpenSSL 3.5.8, so green scans do not close the
separate downstream runtime review.

The retained artifact is `edge-security-evidence-8e84b20.zip`. Its checked summary
is `hosted-auth-http-8e84b20-verified.json`, SHA-256
`4b8974b32b410df465aa8f16f33da9c6a953e5a9c64de0f253f8da7daccf9896`.
No original launch gate is promoted. Live staging, independent review/retest,
real SMTP/operator recovery, GPU quality/parity/four-request acceptance,
legal/model rights and pilot/founder approval remain open. The Standard profile
SHA-256 is unchanged:
`b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`.
