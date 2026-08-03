# Standard CatVTON RC1

## Scope

This release candidate freezes DrapixAI's proven upper-body path. It does not
promote lower-body, full-body, Enhanced, Ultra, refinement, or multi-candidate
generation into the public launch contract.

The immutable, secret-free runtime profile is:

`deploy/release/standard-catvton-rc1.env`

Verify it before every staging or production deployment:

```bash
python deploy/scripts/verify-standard-release-profile.py
```

## Locked contract

- CatVTON upper-body engine only.
- Standard quality only.
- One generated candidate.
- 22 inference steps and guidance scale 2.5.
- 768 x 1024 CatVTON generation.
- Approved v3 garment cache at 1024 x 1365.
- Final PNG output at 1024 x 1365.
- Minimum reported quality score 0.95.
- Warm single-request target of 12 seconds.
- No optional refinement or secondary upscale model.
- Single-request execution remains the rollback path while three-user batching is tested.

## Baseline

`docs/releases/standard-catvton-rc1-baseline.json` records the latest preserved
direct-versus-SDK evidence. It intentionally records the remaining sleeve warning
rather than hiding it. This baseline is suitable for rollback comparison, but it
does not replace fresh staging certification.

## Git and rollback

The RC tag must point to a clean commit containing this profile and baseline. The
pre-RC source commit is `859d3b4dfd8fcf0019e7e26b1a4ef78992bbaac1`.

Rollback procedure:

1. Disable adaptive batching.
2. Drain the try-on queue without accepting new work.
3. Deploy the tagged RC source and this exact profile.
4. Restore the pinned model revisions without downloading unreviewed `latest` assets.
5. Run the profile verifier and one warm SDK smoke test.
6. Reopen traffic only after candidate count, quality mode, score, warnings, and latency are checked.

No database rollback is implied by an AI runtime rollback. Database migrations
must use their separately tested backup-and-restore procedure.
