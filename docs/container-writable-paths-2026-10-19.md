# Non-root writable-path correction — 19 October 2026

The production and staging edge templates assigned API uploads and Next.js cache
tmpfs directories to UID/GID 1000 with mode 0700. Actual distroless application
images run as UID/GID 65532. Disposable image probes reproduced `EACCES` for both
paths. This could prevent upload/spool and image-cache writes during deployment.
No live environment was changed or claimed to be affected.

Both templates now assign those two directories to UID/GID 65532. Mode 0700,
tmpfs size limits, non-root identity, read-only root filesystems, capability
restrictions and the existing private topology remain in place. No inference
code, model, Standard profile setting or concurrency limit changed.

`scripts/verify-container-writable-paths.mjs` resolves the actual production and
staging Compose templates using Docker Compose and synthetic interpolation
values. An explicit empty interpolation file and `--no-env-resolution` prevent
reading application/operator environment files. It inspects the actual image
identity, then tests all four resolved API/web mounts in disposable networkless
containers. Each positive case verifies write/read/delete, UID/GID, private
directory mode, tmpfs filesystem identity and denial outside the writable mount.
Each corresponding negative control assigns the known-wrong UID/GID 1000 and
requires an actual `EACCES` result.

The regression failed before the fix and passed all eight cases afterwards.
The existing native-image verifier now invokes it and embeds its exact JSON and
hash into the retained edge-runtime report, binding the checks to the same API
and web image IDs used for other runtime and scan evidence.

Preparatory evidence, using the already-built `4d129c7` images as actual UID
subjects against the changed templates, is retained under
`runtime/launch-evidence/edge-writable-paths-c39812b9af7d91c9.json` (expected
failure) and `edge-writable-paths-ed465307cfc1395a.json` (eight passes). These are
not proof that the newer source commit has passed hosted CI. The staging
topology verifier and its 16 negative-control tests also passed after the fix.

Reproduce with the exact candidate image references:

```text
node scripts/verify-container-writable-paths.mjs <api-image> <web-image>
node scripts/verify-edge-container-runtime.mjs <api-image> <web-image>
```

This fixture checks Docker-resolved repository settings with real image users.
It does not start the complete application, test real shopper uploads, certify
managed storage or establish the mounts/user identities of a live deployment.
Those remain part of staging and full-customer-journey acceptance.
