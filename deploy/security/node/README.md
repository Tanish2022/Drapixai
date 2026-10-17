# Node 22 shared-OpenSSL review candidate

**Not a production runtime or a completed security remediation.** This prepares a
downstream Node 22.23.3 build that uses Debian's security-patched OpenSSL libraries
instead of the stock Node binary's embedded OpenSSL 3.5.8. Production API/web
Dockerfiles, Node engine bounds, AI requirements, VEX and all launch gates remain
unchanged. Do not deploy or relabel this candidate as an approved release.

The exact source archive is pinned to SHA-256
`bd97093e1a1e9243338950c174a693a64d4e0926a9c6ce259962bc58d5e96909`.
Its checksum was checked against the [official Node release record](https://nodejs.org/en/blog/release/v22.23.3)
and official checksum endpoint. The Dockerfile authenticates the download using
HTTPS and that reviewed pin. A separate offline GPG verification now proves that
the official signed checksum matches this pin; it is not an in-build GPG step.
See the [18 October evidence and limitations](../../../docs/node-shared-openssl-review-2026-10-18.md).

## Why this candidate exists

The existing local edge candidate reports Node 22.23.3, OpenSSL 3.5.8 and
`node_shared_openssl: false`. Merely overlaying Debian's library does not replace
that embedded copy. The [OpenSSL advisory](https://openssl-library.org/news/secadv/20260929.txt)
and [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-84782)
describe the outstanding DTLS issue; Debian identifies `3.5.7-1~deb13u3` as its
fixed Trixie package. [DSA-6531-1](https://www.debian.org/security/2026/dsa-6531)
documents the security update. A lower upstream version string plus a Debian
backport must be evaluated using the package/build evidence, not treated as an
unpatched generic upstream release or disguised as OpenSSL 3.5.9.

The current published Node 24.22.0 LTS also reports embedded 3.5.8 in the
[release index](https://nodejs.org/dist/index.json), so a major-version bump is not
proof of a fix. This candidate retains Node 22 and reported module ABI 127.
Matching that number alone does not prove compatibility. Node's
[downstream build guidance](https://github.com/nodejs/node/blob/v22.23.3/BUILDING.md#building-to-use-shared-dependencies-at-runtime)
requires compatible shared dependencies and testing; this is a non-default
distribution whose maintenance and update responsibilities need review.

An offline inspection found the stock Node TLS API refuses the DTLS method names.
That narrow observation is not a complete native-addon/reachability review, an
OpenSSL advisory exemption or justification to expand VEX. Other issues in the
upstream advisory require their own applicability review; for example Debian
marks [CVE-2026-84783](https://security-tracker.debian.org/tracker/CVE-2026-84783)
not affected, rather than requiring a blanket waiver for the entire advisory.

## Build and verify, without a GPU

Before a candidate build, obtain the public
[signed manifest](https://nodejs.org/download/release/v22.23.3/SHASUMS256.txt.asc)
and [reviewed official keyring snapshot](https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/gpg/pubring.kbx)
into an ignored local directory. With an existing trusted `gpgv` executable, run:

```powershell
python deploy/security/node/verify-source-signature.py --gpgv PATH_TO_GPGV --manifest PATH_TO_SHASUMS256.txt.asc --keyring PATH_TO_pubring.kbx --keyring-revision 481637f813e912c4aa3622d7964ab426c97b8e8d --output-dir runtime/security-candidate/node-source-signature-review
```

The output directory must be new. This verifier pins the reviewed keyring bytes,
revision, release signer, source version and checksum; it checks the GPG status
and SHA-256-or-stronger signature digest and rejects tampered signed content and
an untrusted key in real negative controls. It does not download keys, install
software, edit personal keyrings or attest independent key identity/revocation
review. Keys came from the official HTTPS repository and the fingerprint was
cross-checked with the versioned Node README. Future source/key changes require
review; a historical signature alone does not approve a future runtime.

Run from the repository root with local Docker, Node 22, Python 3 and test-only
Python `cryptography` already available. No script installs host packages or
changes a trust store. Compilation uses two jobs; allow enough local RAM and
disk. The build context contains only these public build helpers, not project
secrets, models or customer data.

```powershell
docker build --target runtime -f deploy/security/node/Dockerfile.shared-openssl -t drapixai-node22-shared:review-candidate deploy/security/node
python deploy/security/node/test-candidate.py -v
node deploy/security/node/verify-runtime.mjs drapixai-node22-shared:review-candidate drapixai-api:edge-security-candidate
```

The last argument must be an existing local stock Node 22.23.3 edge image; the
verifier records its immutable image ID and uses it only for compatibility
comparison. It does not infer that image is the current release. The candidate
must have its review-channel label. Docker runs use immutable local IDs,
network isolation, non-root/read-only execution, dropped capabilities and
bounded resources. The probe requires dynamic SSL/crypto mappings, ELF/build
provenance and matching file hashes, unchanged bundled trust roots/ICU, core
cryptographic behavior, valid mutually authenticated TLS 1.2/1.3 and rejection
of bad identity, CA, hostname, expiry and TLS 1.1. Negative controls reject the
stock static runtime even with supplied metadata, and reject an altered digest.

`record-build.py` checks the actual ELF dependencies and absence of selected
defined OpenSSL symbols, and records the binary/library hashes, configuration
and effective Debian package. The source is built without hand-applied Node or
cryptography patches. The runtime includes Node and OpenSSL notices. These
checks are evidence for a review, not an assertion of full ABI, cryptographic,
licensing, FIPS or security certification.

## Build the application candidate from exact committed bytes

Choose the actual reviewed 40-character application release commit and a **new**
directory below `runtime/security-candidate/`:

```powershell
python deploy/security/node/prepare-edge-candidate.py --release-commit RELEASE_COMMIT_SHA --output-dir runtime/security-candidate/node-edge-review
docker build --target application-checks -f runtime/security-candidate/node-edge-review/Dockerfile.application-checks.candidate -t drapixai-node22-shared:application-checks runtime/security-candidate/node-edge-review/context
docker build -f runtime/security-candidate/node-edge-review/Dockerfile.api.candidate -t drapixai-api:node-shared-review runtime/security-candidate/node-edge-review/context
docker build -f runtime/security-candidate/node-edge-review/Dockerfile.web.candidate -t drapixai-web:node-shared-review runtime/security-candidate/node-edge-review/context
```

The materializer reads raw Git objects and validates their object identities and
written hashes, then records a source map and archive digest. It does not use
`git archive`, which was observed converting LF blobs to CRLF on this Windows
checkout. The protected profile must retain its exact committed bytes. Candidate
helper overlays and generated Dockerfiles have separate hashes. Case-colliding
paths, links/submodules, output escapes/overwrites, mutable refs and unreviewed
production Dockerfile bytes/shapes are refused. No working-tree or untracked
application changes are copied. Production files are not rewritten.

The generated Dockerfiles reuse the source-build layers. Both their build and
runtime processes use the shared-OpenSSL binary and matching libraries. The
application-check stage runs the existing compiler, launch/security, MFA,
authorization, token, upload and log checks, plus web build and runtime CSP.
Then exercise the actual API/web candidate images:

```powershell
node scripts/verify-edge-container-runtime.mjs drapixai-api:node-shared-review drapixai-web:node-shared-review
```

The native verifier inspects and executes immutable local image IDs, records its
own source hash and distinguishes shared from embedded OpenSSL. Its checkout
Dockerfile hashes do not attest candidate image inputs: retain this materializer's
generated Dockerfiles/source manifest and actual image revision labels separately.
An optional real-Docker [alias-movement regression](../../../docs/edge-runtime-evidence-binding-2026-10-18.md)
checks that changing only owned test tags cannot change the images it executes.

Use the existing scanner unchanged on each exact image, retain raw reports,
and bind source/input hashes, image IDs and labels. These are separate from the
ordinary release CI, which still builds the unchanged production Dockerfiles.
No added recurring CI build or paid resource is provisioned by this candidate.

## Required review and promotion evidence

Runtime compilation, core/TLS smoke tests, full application/native compatibility,
fresh scans and qualified downstream ABI/crypto/maintenance review must all be
recorded before integration is considered. Initial preparation/policy tests or a
successful source build alone do not meet that bar. Test failures and missing
results must remain visible. The build is not claimed hermetic or byte-for-byte
reproducible; public source/base digests and effective package/output hashes are
retained, and Debian security packages can change between builds.

Keep the existing production path until a concrete reviewed integration is
verified. Do not use a scanner exception or an unsupported Node jump to hide the
embedded-library question. Real TLS/proxy/secret rotation, independent deployed
penetration testing and operational drills remain required. AI remediation,
delivered hardware, GPU quality/parity/four-request isolation/speed/soak, model
rights, legal approval and controlled pilot/founder approval remain open. This
candidate neither changes Standard CatVTON nor closes any original P0 gate.
