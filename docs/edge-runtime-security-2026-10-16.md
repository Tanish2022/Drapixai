# Edge runtime security remediation — 16 October 2026

Scope: API/web container security and release evidence (work packages 1–2),
plus build-context privacy. No AI image, inference configuration or public
launch gate is approved by this document.

## Confirmed failure

[CI run 38824701465](https://github.com/Tanish2022/Drapixai/actions/runs/38824701465)
tested commit `5ac16ee56000fa29156cd0e9eea26ae27e0e1009`. Application checks and
secret scanning passed. The AI candidate audit failed on Accelerate 1.11.0 /
`PYSEC-2026-3804`. The container job failed on `CVE-2026-84782` in the API's
Debian 12 `libssl3` 3.0.22-1~deb12u1. That job stopped before scanning the web
image; it did not establish a passing web scan.

The [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-84782)
identifies that Debian 12 package as vulnerable and Debian 13's
3.5.7-1~deb13u3 as fixed. The
[OpenSSL advisory](https://openssl-library.org/news/secadv/20260929.txt)
describes an out-of-bounds read in DTLS handshake retransmission. We do not
add an exception or infer safety merely because ordinary HTTPS uses TLS.

## Remediation

- Move API/web builders, security-library source and non-root distroless runtimes
  together to Debian 13, retaining Node 22. Every base is pinned to an inspected
  official registry digest. Native modules are built for the target distribution.
- Install the Debian security `libssl3t64` package and fail the build below
  3.5.7-1~deb13u3. Copy its libraries, providers and matching package metadata.
- Retain the existing scanner, severity policy and reviewed VEX file. No new
  vulnerability suppression or ignore-unfixed flag is introduced.
- CI labels both images with the tested commit, exercises the actual native
  runtime, scans API and web independently, and uploads raw scan reports plus
  their hashed evidence records. A failed native test or either scan still fails
  the job; collecting other evidence does not override that failure.
- Exclude generated output, screenshots and alternate Next build directories
  from Docker contexts. Synthetic probes check that source/public assets remain
  available while private runtime files stay out.

## Verification boundary

[CI run 38916503402](https://github.com/Tanish2022/Drapixai/actions/runs/38916503402)
tested clean commit `11a57a70893392b19dd2da79938616eb4da59610`. Application,
secret-scan and container-scan jobs passed. The AI audit remained blocking.
The retained artifact `edge-security-evidence-11a57a70893392b19dd2da79938616eb4da59610`
(artifact ID 12052179645) has SHA-256
`826b068ebe9ee73e26f9312928d56881c956e511d7da35780c87d26092f01f9a`.
Downloaded artifact bytes and the raw reports' recorded hashes were verified.
API image `sha256:f40b35a21198229408b4e75f51ca16429812138f3e6d1c1e3c36190ef0047328`
and web image `sha256:6caf7664c36c881416fae902031ed627e6fc07fc6d07140e8e773bcd135a1e73`
each have matching revision labels and zero HIGH/CRITICAL findings. The native
runtime report records a clean tested checkout. This is evidence for that
specific commit; later source changes require their own CI and artifact binding.

Local candidate scans reported zero HIGH/CRITICAL OS or library findings for
both images using the pinned scanner and unchanged policy. Native checks passed
with UID 65532 and Debian `libssl3t64` 3.5.7-1~deb13u3. These candidate builds
precede the final commit and do not establish a clean exact-release result.

**Separate embedded-library review remains open.** The inspected Node runtime is
22.23.3 and reports embedded OpenSSL 3.5.8. Replacing Debian's shared libraries
does not replace that embedded copy. The official
[Node release notes](https://nodejs.org/en/blog/release/v22.23.3) confirm the
embedded version; the OpenSSL advisory lists the 3.5.9 fix. The image scanner's
zero findings do not prove whether Node's build includes or can reach affected
DTLS code. Retain vendor/build and native-addon reachability review as an open
security requirement; do not infer whole-runtime remediation from a library
overlay or silently expand VEX. Runtime reports record both library versions.

The local native-container drill uses a disposable internal network and
PostgreSQL container, synthetic credentials, no published host ports, read-only
edge roots and non-root execution. It checks Sharp decoding/encoding, a real
Prisma database query, offline Nodemailer composition, production signup HTML,
matching CSP nonces and protected onboarding redirects. It verifies cleanup and
records image IDs, source commit, dirty-entry count and Dockerfile hashes.
It does not certify TLS database connectivity, API bootstrap against deployed
services, email delivery, storefront integration, staging isolation or GPU work.

Raw local scan and runtime outputs are retained under ignored `runtime/` paths.
They are candidate evidence, not a clean exact-release result. The committed
release must pass Linux CI with retained commit/digest-bound scan evidence before
that result can be used for launch decisions. AI remediation and its GPU parity
gate remain open regardless of the edge-image result.
