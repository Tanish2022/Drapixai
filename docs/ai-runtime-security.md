# DrapixAI AI Runtime Security Gate

## Current production rule

DrapixAI must load CatVTON, Stable Diffusion inpainting, and the VAE from local directories prepared from immutable Hugging Face revisions. Public requests may provide only person and garment images; they must never provide model IDs, checkpoint paths, custom pipelines, or serialized model files.

Pinned model revisions:

- `zhengchong/CatVTON@2969fcf85fe62f2036605716f0b56f0b81d01d79`
- `runwayml/stable-diffusion-inpainting@8a4288a76071f7280aedbdb3253bdb9e9d5d84bb`
- `stabilityai/sd-vae-ft-mse@31f26fdeee1355a5c34592e401dd41e45d25a493`

`python -m drapixai_ai.scripts.download_catvton` downloads those revisions and writes `models/model-lock.json`. RunPod preflight rejects missing or mismatched locks.

## Patched public-input libraries

The production requirements move public upload, image decode, and outbound HTTP handling to:

- `python-multipart==0.0.32`
- `Pillow==12.3.0`
- `requests==2.34.2`
- `rembg==2.0.69`

DrapixAI imports rembg as a library only. It does not install or expose the rembg HTTP server, URL-fetch endpoint, CORS middleware, or user-controlled `model_path`. The fixes for `PYSEC-2026-2274` and `GHSA-55v6-g8pm-pw4c` require rembg releases that also force NumPy 2.3+, which conflicts with the quality-proven NumPy/SciPy stack. Those two server-only advisories are therefore accepted as non-reachable until the full NumPy 2 migration passes the A100 quality gate.

PyTorch 2.12.1 requires `setuptools<82`, while `PYSEC-2026-3447` is fixed only in Setuptools 83. The advisory concerns Unicode-normalization bypasses while packaging source distributions on macOS. DrapixAI production runs on Ubuntu Linux, installs a prebuilt PyTorch wheel, does not build or publish source distributions at runtime, and never accepts package-manifest input from users. CI therefore suppresses that ID as deployment-inapplicable.

`GHSA-rrmf-rvhw-rf47` affects `torch.jit.script` in Torch through 2.12.1 and requires a local, low-privilege attacker. DrapixAI does not invoke `torch.jit.script`, does not accept Python or TorchScript from users, and runs only immutable locally prepared model artifacts. Torch 2.13 contains the fix, but the stable xFormers 0.0.35 build is tied to the quality-candidate Torch stack. CI temporarily suppresses this ID as non-reachable until a Torch 2.13-compatible xFormers release passes the A100 quality and latency gate. These four named IDs are the complete exception list; all other direct and transitive packages must pass the resolved dependency audit.

## Core runtime migration gate

The currently proven CatVTON runtime uses Torch 2.4, TorchVision 0.19, xFormers 0.0.27, Transformers 4.46, and Diffusers 0.31. Several later advisories concern loading attacker-controlled checkpoints, custom model repositories, conversion utilities, or training paths that DrapixAI does not expose. Immutable local model loading reduces that exposure, but it does not make the old runtime a permanent security baseline.

`drapixai_ai/requirements.security-candidate.txt` defines the isolated upgrade candidate. Its Linux/Python 3.11 dependency set uses PyTorch 2.12.1's official CUDA 12.6 build, FastAPI 0.139, Uvicorn 0.40, and a resolved Starlette 1.3.1 runtime. Its complete resolved dependency graph has no known reachable advisories as of July 22, 2026, subject to the four documented exceptions above. It must not replace the proven runtime until an A100 validation run proves all of these:

Prepare it with `bash deploy/runpod/prepare-security-candidate.sh`. That command performs the same full dependency audit in an isolated audit environment, writes only under `runtime/security-candidate`, validates a real xFormers CUDA kernel, and leaves the production `.venv` unchanged.

1. CatVTON loads without remote model fallback.
2. The fixed launch pair matches or exceeds the current SDK visual result.
3. Quality score remains at least `0.95` with no warnings.
4. Standard candidate count remains `1`.
5. Warm SDK end-to-end latency remains at most `12 seconds`.
6. Color, print/logo, sleeve, hem, pose, face, and body preservation pass manual review.
7. The strict 50-case matrix passes before the candidate becomes the production image.

Until this gate passes, public launch remains blocked rather than silently trading realism for a dependency upgrade.
