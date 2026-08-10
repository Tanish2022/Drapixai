# Three-user GPU batching

## Launch decision

DrapixAI's first concurrency target is three simultaneous Standard try-ons on one
RTX PRO 6000 Blackwell Workstation Edition. Batch four is intentionally blocked
until a separate quality, latency, stability, and memory review approves it.

The existing API and SDK contract does not change. Each shopper still creates an
ordinary RQ job and receives an independent result. The CUDA worker holds the first
job for at most 150 milliseconds, collects up to two compatible jobs, and sends one
true tensor batch to the single warm CatVTON model.

## Workstation configuration

```dotenv
DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell
DRAPIXAI_ADAPTIVE_BATCHING=1
DRAPIXAI_GPU_BATCH_MAX=3
DRAPIXAI_BATCH_WAIT_MS=150
DRAPIXAI_BATCH_OOM_FALLBACK=1
DRAPIXAI_BATCH_VRAM_HEADROOM_RATIO=0.20
DRAPIXAI_CANDIDATE_COUNT=1
```

`DRAPIXAI_GPU_BATCH_MAX` is hard-capped at three in the current release. Changing
the environment variable to four will not bypass that launch guard.

Use a Blackwell-native Linux runtime. Do not copy the proven A100 CUDA 12.4
environment directly to this workstation. The workstation runtime must use an
approved CUDA 12.8-or-newer PyTorch build and must pass DrapixAI's direct, SDK,
quality, dependency, and soak gates before it replaces any proven environment.

## Isolation and fallback

- The model is loaded once in one CUDA process.
- Images remain transient-file references in Redis jobs; image bytes are not added
  to Redis.
- Requests with different inference steps or guidance settings are not combined.
- Decode failures affect only the invalid request.
- A batch CUDA out-of-memory error clears the CUDA cache and retries each request
  through the unchanged Standard single-image path.
- Candidate count remains one.
- Per-result metadata records batch size, batch index, generation latency, peak
  allocated VRAM, peak reserved VRAM, total VRAM, and remaining headroom.
- Setting `DRAPIXAI_ADAPTIVE_BATCHING=0` immediately restores the previous
  one-job-at-a-time worker behavior.

## Three-user acceptance test

Prepare three front-facing people and three approved v3 garment-cache keys in a
copy of:

```text
deploy/examples/three-user-benchmark-manifest.json
```

Run the AI API and worker with adaptive batching enabled, then execute:

```bash
python deploy/scripts/benchmark-three-user-tryon.py \
  --manifest runtime/three-user-manifest.json \
  --endpoint http://127.0.0.1:8000/ai/tryon \
  --service-token "$DRAPIXAI_AI_SERVICE_TOKEN" \
  --output-dir runtime/three-user-benchmark
```

The command sends all three requests concurrently through the public AI route,
saves every PNG, and writes `summary.json`.

After that private GPU batch passes, run the real multi-tenant public path with
three different 15-minute `/v1` access tokens and three tenant-owned products:

```bash
python deploy/scripts/benchmark-three-tenant-public-api.py \
  --manifest deploy/examples/three-tenant-public-api-manifest.json \
  --base-url https://api.staging.drapixai.com/v1 \
  --output-dir runtime/three-tenant-public-api
```

Tokens are read from the three environment-variable names in the manifest and
must never be written into the file. By default the benchmark writes only its redacted
summary and does not retain result PNGs. Add `--retain-output-images` only for a
consented internal visual review, then delete those PNGs after approval. The test
submits all three requests together, checks quality, latency, warnings, privacy
headers, and unique result IDs, then proves that each tenant can read its own
metadata while all six cross-tenant lookups return 404.

## Approval gates

The three-user mode remains non-production until all conditions pass:

1. Every response reports `worker_batch_size=3`.
2. Every response reports `candidate_count=1`.
3. Every quality score is at least `0.95`.
4. No response contains warnings.
5. p95 end-to-end latency is at most 12 seconds after model warm-up.
6. Peak reserved VRAM leaves at least 20% headroom.
7. Colour, texture, print/logo, pose, face, sleeve, collar, hem, and background
   match the approved single-request Standard reference.
8. A mixed-garment 100-batch soak test finishes without CUDA OOM, worker restart,
   missing result, cross-user result mix-up, or transient-file leak.

Batch four may be planned only after three-user mode passes these gates on the
physical RTX PRO 6000 workstation.
