# Staging secret-file ownership correction — 19 October 2026

This is a verified deployment-readiness gap, not a claim of a credential leak or
an affected live deployment. No real credential, operator file or account was
read or changed by the test.

`generate-staging-secrets.py` creates mode-0600 files owned by its caller. The
actual API image runs as UID/GID 65532, and its production mounted-secret loader
requires a private regular file. On a Linux deployment, an operator-owned file
is not necessarily readable by the service. Initial inspection found that the
staging instructions did not establish API JSON and client TLS file ownership.

The actual compiled production-mode loader was tested with complete synthetic
secret objects inside disposable, networkless tmpfs containers:

| File metadata | Result after dropping to UID/GID 65532 |
| --- | --- |
| UID/GID 1000, mode 0600 | Rejected with actual `EACCES` |
| UID/GID 65532, mode 0400 | Loaded all 16 required synthetic entries |

The final fixture report is
`runtime/launch-evidence/mounted-secret-owner-0afacb50d1d7cc1f.json`.
An earlier fixture failed during setup because it attempted chmod after changing
ownership without the corresponding capability; the corrected setup changes mode
before ownership, then drops privilege. Its failed report is retained separately.

This proves the file-access requirement, not working provider credentials,
certificate validity, TLS handshake, whole-server startup or live staging.

## Implemented local remediation

`deploy/staging/prepare-secret-permissions.py` now provides the Linux-root
installation and check-only procedure. It opens the directory and all four
known files without following terminal symlinks, uses non-blocking opens to
reject FIFOs without hanging, and rejects multiple hardlinks, foreign filesystem
targets, unexpected ownership and writable shared directories. It validates
every file before changing metadata, works through file descriptors and checks
path/inode identity again. Credential contents are not read or rewritten by the
installer. Database/bootstrap and Redis files are outside its allowlist.

The four files become UID/GID 65532, mode 0400; the directory becomes root-owned
0700. An ordinary interrupted metadata operation leaves the original directory
owner until file changes complete, permitting a safe retry. Credential rotation
still requires its separate approved process.

The dedicated Docker drill passed 13 controls with the actual production API
loader: wrong-owner rejection, check-only behavior, private reads and preserved
bytes, repeat installation, unchanged separate credentials, other-user denial,
interrupted-install retry, missing-file/symlink/hardlink/FIFO/shared-directory
rejection, terminal directory-symlink rejection and unprivileged-call denial.
The final metadata fixture is embedded in the native-image evidence by
`scripts/verify-edge-container-runtime.mjs`. These use only synthetic credentials
in an owned volume, removed after the drill.

New MFA seeds are now 20 random bytes encoded as canonical uppercase Base32.
An independent-format regression first failed on the former hexadecimal output.
The new generated seed's Python HMAC/TOTP value matches the real production
verifier, and a deliberately invalid value is rejected. Existing secret files
remain unchanged unless explicit replacement is requested. Private generator
writes now use a mode-0600 temporary inode and atomic replacement; a linked-target
regression verifies unrelated file contents are preserved.

## Remaining live installation and acceptance

Apply and verify the procedure on the actual Linux host after actual isolated
provider values and TLS credentials have been provisioned. Check the resolved
mounts, real TLS handshake, complete-server startup and actual operator MFA
enrollment/replay behavior. No real credential was rotated or installed by these
tests. The fixture certificates are synthetic bytes, not valid TLS material.

Infrastructure/operator-security and full-server staging gates remain open.
