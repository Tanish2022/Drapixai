# Accelerate checkpoint patch review candidate

This directory prepares an isolated remediation candidate for `PYSEC-2026-3804`.
It neither installs into the application nor changes any production or security
candidate requirements, Dockerfile, audit exception or Standard setting.
The existing dependency audit must continue to report the upstream finding.

The exact official Accelerate 1.11.0 wheel is hash pinned in `build_candidate.py`.
The builder works offline and refuses any other wheel or loader bytes. It only
replaces the shard-list construction inside `load_checkpoint_in_model` and adds
`shard_guard.py`; `load_checkpoint_and_dispatch` reaches that same loader. The
wheel keeps upstream version 1.11.0 and adds build tag `1drapixai`, preserving the
upstream Apache license and all other package code. It is not an upstream fix.

The guard requires the existing DrapixAI materialized, read-only local-model
layout. It rejects absolute/escaping paths, Windows path forms, symlinks/reparse
points, directories, FIFOs, sockets and missing shard files before any shard is
loaded. It validates the whole map before returning the unchanged sorted shard
list. Legitimate materialized nested and dot-prefixed shard paths remain valid.
Hub-cache symlink layouts are deliberately unsupported under this deployment
policy. No tensor operations, checkpoint contents or model configuration change.

## Verification

The `ai-checkpoint-candidate` Linux CI job downloads the hash-pinned official
wheel, builds the candidate twice to verify reproducibility, checks all wheel
RECORD hashes, and proves unmodified package bytes remain identical. AST checks
prove that the loader API and tensor-loading code are unchanged apart from the
intended shard-list call. Linux regressions use real symlinks, a FIFO and a socket.

In a disposable CPU Python environment, `validate_loader.py` invokes both real
Accelerate entry points with tiny synthetic tensors. The unsafe negative control
must successfully load an outside synthetic checkpoint, proving the vulnerable
path was reached. The patched run must reject those same relative and absolute
paths, reject non-regular shards on Linux, and preserve exact tensor values and
outputs for valid plain, nested and dot-prefixed paths. Each run has an external
60-second CI timeout so a blocking-file regression fails the job.

Build a candidate only under ignored `runtime/security-candidate/`, using the
exact upstream wheel named below:

```bash
python deploy/security/accelerate/test_candidate.py \
  --wheel runtime/security-candidate/accelerate/accelerate-1.11.0-py3-none-any.whl
python deploy/security/accelerate/build_candidate.py \
  --wheel runtime/security-candidate/accelerate/accelerate-1.11.0-py3-none-any.whl \
  --output-dir runtime/security-candidate/accelerate/review
```

The workflow shows the CPU environment setup and installation sequence. Never
run its `--force-reinstall` command in the application's environment. Build
records include the source commit/dirty count, original wheel/loader hashes,
guard/builder hashes, patched-loader hash and candidate-wheel hash. Dirty local
builds are preparatory evidence. CI retains a clean-commit candidate artifact;
artifact availability alone does not prove the test job passed.

Local Windows verification on 2026-10-16 used existing Torch 2.10.0+cpu in a
separate virtual environment: both real entry points reproduced traversal before
the patch, then rejected it with the patch; valid tensor/output comparisons
passed. Windows skipped Linux-only cases. This is narrower than the production
Python 3.12 / Torch 2.11 / CUDA 12.8 RTX runtime. Linux CI uses Torch 2.12.1+cpu
and must supply its own results, including FIFO and symlink rejection.

## Remaining approval and limits

The output is explicitly `REVIEW_CANDIDATE_NOT_APPROVED`. Independent security
review, exact AI image integration/build/scan, and Standard direct/SDK GPU and
visual parity, the 50-case matrix, and three/four-request certification remain
required. No exception, runtime promotion or launch approval follows from these
CPU tests. Retain this patch's provenance if reviewers later approve integration.

The patch addresses indexed shard names. Existing deployment validation still
checks all three model roots and index structure/size. Neither check authenticates
weight contents or protects against a privileged concurrent writer replacing
files after validation. Keep model mounts read-only and provisioning restricted.
Direct non-index checkpoint loading, training utilities and other Accelerate
APIs are outside this patch's claim; they need their own applicable review.

Upstream sources checked 2026-10-16:

- [Official PyPI wheel metadata](https://pypi.org/pypi/accelerate/1.11.0/json)
- [Advisory](https://osv.dev/vulnerability/PYSEC-2026-3804)
- [Upstream path-only proposal, closed without merge](https://github.com/huggingface/accelerate/pull/4138)
- [Follow-up path and non-regular-file proposal, closed without merge](https://github.com/huggingface/accelerate/pull/4214)

The guard here is a DrapixAI candidate implementation, not a claim of upstream
acceptance. The unmerged proposals and an advisory's version range do not prove
that upgrading to 1.15.0 remediates the loader.
