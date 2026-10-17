# Node shared-OpenSSL candidate verification — 18 October 2026

This is downstream runtime review evidence. Production API/web Dockerfiles and
the Standard CatVTON pipeline are unchanged. No original launch gate is closed.

## Public source authentication

The official Node 22.23.3 source archive pin was independently checked against
its [signed checksum manifest](https://nodejs.org/download/release/v22.23.3/SHASUMS256.txt.asc)
using the existing verification-only GnuPG 2.4.4 executable, a dedicated local
home and the official release-key snapshot. No personal keyring was imported or
changed, and no secret or application source was sent to a signature service.

| Evidence | Result |
|---|---|
| Source archive | `node-v22.23.3.tar.xz` |
| Signed archive SHA-256 | `bd97093e1a1e9243338950c174a693a64d4e0926a9c6ce259962bc58d5e96909`, identical to the Dockerfile pin |
| Valid signing primary fingerprint | `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`, Antoine du Hamel; SHA-256/EdDSA signature dated 23 September 2026 |
| Official release-key Git revision | `481637f813e912c4aa3622d7964ab426c97b8e8d` |
| Keyring SHA-256 | `610b8d249da3d5733f5a128def2dd0294dbbf5b5713e6ca2529db8db419dee00` |
| Signed manifest SHA-256 | `e82087fe2cf383fce187b0789eb5ea50fd92f9b68afb4f4e174d65ec59acba4a` |
| Positive control | Signature valid, exactly matching signed source checksum |
| Changed signed checksum | Nonzero exit and `BADSIG` |
| Empty trusted keyring | Nonzero exit and `NO_PUBKEY` |

The fingerprint was cross-checked with the [versioned Node release-key list](https://github.com/nodejs/node/blob/v22.23.3/README.md#release-keys).
The keyring came from the official HTTPS repository at the recorded revision;
this is not an out-of-band identity attestation or independent review of key
revocation. Do not interpret the signature as downstream ABI/crypto approval.

The repeatable [offline verifier](../deploy/security/node/verify-source-signature.py)
pins that key snapshot, signer and source checksum, validates actual GPG status,
checks that the recipe still contains the reviewed source URL/pin, and runs both
negative controls. It uses bounded subprocesses, a new ignored output directory
and a dedicated verification home. The Dockerfile still enforces HTTPS plus the
pin; GPG evidence is separate, rather than silently claimed as an in-build check.
Raw metadata, status and report are retained locally under
`runtime/security-candidate/node-shared-openssl/`.

## Build and compatibility status

### Upstream harness calibration

The prepared [upstream verifier](../deploy/security/node/verify-upstream.py) runs
the official Node source archive's parallel crypto, TLS, HTTPS and HTTP/2 tests.
Its result parser passed twelve positive/adversarial controls; the existing
static runtime was rejected at the candidate review-channel boundary. These
checks do not establish a candidate runtime pass.

The test harness was then calibrated against the actual existing stock Node
22.23.3 binary. Its SHA-256 remained
`fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`.
A temporary, local driver used the pinned public source archive and the already
built binary; it configured the source test tree without compiling Node or
copying application code. Runs were offline, unprivileged, read-only, bounded to
two CPUs/two workers/2 GiB and used disposable scratch space. No host port was
published and no external target was tested.

| Stock-binary calibration | Actual results |
|---|---|
| Default expected bundled-CLI path absent | 660 planned/results, zero failures or TODOs; 644 non-skipped, 16 runtime skips |
| Existing Debian CLI exposed at expected test path | 660 planned/results, zero failures or TODOs; 656 non-skipped, four runtime skips |
| Remaining four skips | Legacy Blowfish provider; upstream OpenSSL 3 certificate-extension case; unsupported `s_client -ssl3`; absent `h2load` |
| CLI interoperability executable | Debian OpenSSL 3.5.7, SHA-256 `acc10176d038aeb7b2a77d9ec972ac2985857a7191f7aecb7c54ef0e2c7e9549` |
| Log/evidence verification | Raw stdout/stderr hashes and complete TAP plans/results checked; current parser reproduced both retained reports |

The CLI calibration is an interoperability fixture using Debian's executable;
it is not the stock binary's bundled OpenSSL 3.5.8 CLI. No Node test source or
Node binary was patched to make it pass. Skips remain unexercised and are not
reported as passing tests. Baseline reports, image IDs and raw logs are retained
under `runtime/security-candidate/node-shared-openssl/baseline-upstream-3ac38a6650da/`
and the verified summary `baseline-upstream-verified.json` in its parent.

The candidate verifier requires matching actual binary/library hashes and
source provenance in the source-build and distroless images, records the CLI and
upstream helper hashes, and rejects empty/incomplete TAP, missing wholly exercised
subsystems, TODOs, expected failures or a nonzero runner exit. It cleans up only
containers bearing its own exact random label, including when its Docker client
times out. Upstream tests run in the source-build image and cover a subset of
Node CI; final distroless core/TLS and actual application/native checks remain
separate requirements. **The shared-OpenSSL candidate has not passed these
upstream tests yet.**

The two-job source compilation remains running in the original build session at
this checkpoint. Docker clipped the verbose compiler step after its output
limit; that observation is not a terminal result. Do not start a duplicate build
merely because its output is quiet. After it reaches a terminal result, the final
recipe must also include the license notices added after the initial snapshot
and the updated provenance wording; the source compilation layer can be reused.

Runtime dynamic linking, crypto/TLS positive and negative controls, native
Sharp/Prisma behavior, full candidate application tests and fresh exact-image
scans remain unverified. The successful ordinary production CI for preparation
commit `bc21abb15e95fc00fa40fa02053c145b09151875` does not execute this candidate.
Its known Accelerate audit failure also remains open.

Qualified downstream maintenance/ABI/crypto review, live staging drills,
independent penetration testing, legal/model rights, delivered GPU acceptance,
Standard four-request quality/latency/isolation and controlled pilot approvals
remain required. See the [candidate procedure](../deploy/security/node/README.md)
and [application security assessment](security-assessment-2026-10-17.md).
