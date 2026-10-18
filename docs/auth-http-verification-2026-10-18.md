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
five-group native/alias regressions passed locally. The subsequent evidence
embedding change requires its own exact-source repeat. No original launch gate
is promoted by introducing this test.
