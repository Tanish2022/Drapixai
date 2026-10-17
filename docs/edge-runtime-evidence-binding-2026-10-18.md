# Edge runtime evidence binding — 18 October 2026

The native container verifier now executes the immutable image IDs it inspected,
with pulling disabled, rather than reusing mutable tags for later probes. This
closes a local evidence-integrity gap; it is not a serving-application exploit or
proof of a vulnerable public deployment.

Previously, a concurrent local tag change could make the recorded ID differ from
the image actually tested. A bounded regression moved two newly created fixture
aliases immediately after each inspection, swapping their API/web destinations.
The pre-fix verifier ran the changed aliases and failed its API probe because it
had actually started the web image (`Cannot find module '@prisma/client'`). The
fixed verifier ran the original inspected IDs throughout and passed all three
native/application checks. No pre-existing tag was changed.

The reusable [real-Docker regression](../scripts/verify-edge-image-binding.cjs)
runs the actual verifier, moves only random owned aliases, checks both movements
and all five image executions, and binds the native report's digest. It invokes
the verifier from another directory to check repository path handling. Cleanup
refuses unknown images and refuses to remove an image's last tag. Source images
must already have another tag. API/web images remain local and no image is
published. The native verifier may fetch its existing digest-pinned public
PostgreSQL fixture if absent; it was already local in the recorded runs.

```powershell
node scripts/verify-edge-image-binding.cjs drapixai-api:edge-security-candidate drapixai-web:edge-security-candidate
```

The verifier also checks Git command success, validates the commit and records
its own hash. Its Dockerfile hashes are explicitly scoped to the current
verifier checkout. They are not represented as build provenance for arbitrary
input images. Candidate build manifests, source maps, revision labels and actual
image IDs remain separate required inputs for exact-release approval. Dirty
checkout entries remain visible, and CI still requires its image revision labels
to match `GITHUB_SHA`.

The system OpenSSL package probe now splits actual newlines and requires a
version field. Node's reported OpenSSL and `sharedOpenSSL` are recorded
separately, with `embeddedOpenSSL: null` for a shared build. The static baseline
honestly reports embedded 3.5.8 alongside Debian's patched shared package; these
are different artifacts and the latter does not remediate the former.

## Observed tests and limits

| Check | Result |
|---|---|
| Pre-fix real alias movement | Recorded IDs and executed tags diverged; API check failed in the wrong image |
| Fixed real alias movement | Passed; both aliases moved, all five executions used inspected SHA-256 IDs |
| Native API fixture | Sharp image encode/read, real disposable PostgreSQL query and offline email passed |
| Native web fixture | Sharp WebP encode passed |
| Production web fixture | HTML/CSP nonce match and protected-onboarding redirect passed |
| Process containment | Non-root/read-only/shell-free runs, internal disposable database network and no published host port |
| Final repeatable regression | Passed after cleanup guards; report `runtime/launch-evidence/edge-image-binding-76911ec95e9e77f07d2e/report.json` |
| Syntax checks | Both JavaScript helpers passed Node 22 syntax checks |

The local baseline images were API
`sha256:6ee7fc146928e66b198da3a9573d5fc3403740ef05e3be96e7152c5475eecb37`
and web
`sha256:50aa5fb9b089f1665b26ff6d8ee80dad78b3c98a49babf6d9d06ed694730800e`.
Their revision labels were absent and the verifier checkout was dirty. These
results establish compatibility and the image-binding regression, **not clean
release attestation or shared-OpenSSL candidate verification**. Raw before/after
reports are under `runtime/security-candidate/node-shared-openssl/`; final repeatable
fixture reports include the exact verifier/helper hashes and native report hash.

No production Dockerfile, inference dependency, Standard setting, threshold or
capacity was changed. The [OpenSSL candidate](../deploy/security/node/README.md)
still needs its own terminal build, crypto/TLS/native/application/scanner results
and qualified downstream review. Live infrastructure, GPU measurements,
independent penetration testing, legal rights and pilot approvals remain open.
