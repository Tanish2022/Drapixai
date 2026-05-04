# DrapixAI Deployment Guide

This repo is now prepared for a split deployment:

- Edge host: `web + api + nginx`
- GPU host: `Runpod A100 Pod` running the AI API and worker
- Managed services: `Postgres`, `Redis`, `S3`, `SMTP`, `Google OAuth`

The files added for this are:

- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `drapixai_ai/docker/Dockerfile`
- `deploy/docker-compose.edge.yml`
- `deploy/docker-compose.ai.yml`
- `deploy/env/*.production.example`
- `deploy/nginx/drapixai.conf`
- `deploy/runpod/*.sh`
- `deploy/scripts/*.sh`

For the final execution checklist and production/staging gate, use:

- `deploy/production-readiness.md`

## 1. Service Checklist

### Domain and DNS

- Buy or use your domain, for example `drapixai.com`
- Create:
- `drapixai.com` -> web host public IP
- `www.drapixai.com` -> web host public IP or redirect
- `api.drapixai.com` -> API host public IP
- Keep the Runpod AI Pod off the public internet except for controlled testing

### Postgres

- Recommended: managed Postgres
- Create a production database named `drapixai`
- Put the real connection string in `deploy/env/api.production.env` as `DATABASE_URL`
- Before first public launch, run `npx prisma db push` from `apps/api`

### Redis

- Recommended for public launch: managed Redis reachable by both API and AI
- For staging only, the edge compose file includes a local Redis container
- For Runpod-only AI bring-up, `deploy/runpod/start-all.sh` can start a local `redis-server`
- Put the real Redis URL in:
- `deploy/env/api.production.env`
- `deploy/env/ai.production.env`

### S3 / Object Storage

- Recommended: AWS S3
- Create one bucket for uploads, outputs, and thumbnails
- Set:
- `S3_BUCKET`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- Only use `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=1` for MinIO or another S3-compatible service

### SMTP

- Recommended: Resend SMTP or another managed transactional provider
- Set:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Google OAuth

- Create a Google Cloud OAuth web client
- Authorized origins:
- `https://drapixai.com`
- Authorized redirect URI:
- `https://drapixai.com/api/auth/callback/google`
- Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=1` only after the Google credentials are configured
- Put the real credentials in `deploy/env/web.production.env`

## 2. Edge Host Setup

Use any normal Linux VM for the public web and API layer. This does not need a GPU.

Optional Windows helper before editing anything manually:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\init-production-env.ps1
```

1. Copy:
- `deploy/env/api.production.example` -> `deploy/env/api.production.env`
- `deploy/env/web.production.example` -> `deploy/env/web.production.env`
2. Replace every placeholder with real values.
3. Validate the env files after sourcing them:

```bash
set -a
source deploy/env/api.production.env
source deploy/env/web.production.env
set +a
bash deploy/scripts/validate-env.sh api
bash deploy/scripts/validate-env.sh web
```
4. Review and edit `deploy/nginx/drapixai.conf`:
- server names
- certificate paths
5. Build and start:

```bash
docker compose -f deploy/docker-compose.edge.yml build
docker compose -f deploy/docker-compose.edge.yml up -d
```

6. Verify:

```bash
WEB_URL=https://drapixai.com API_URL=https://api.drapixai.com bash deploy/scripts/healthcheck.sh
```

## 3. RunPod Linux GPU Setup

RunPod Ubuntu is the source of truth for DrapixAI CatVTON quality. Windows/local runs are only syntax and basic integration checks.

Final AI runtime:

- OS: `Ubuntu 22.04`
- Base image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- Python: `3.11`
- CUDA: `12.4.1`
- GPU target: `A100` preferred, `A10` acceptable, `T4` only for low-cost testing
- Python packages: pinned in `drapixai_ai/requirements.txt`
- System packages: installed by `drapixai_ai/docker/Dockerfile` and `deploy/runpod/bootstrap.sh`

Recommended Pod settings:

- `On-Demand`
- `A100 PCIe 80GB`
- `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- `SSH terminal access`
- `Encrypt volume`
- `Container Disk 30 GB`
- `Volume Disk 150 GB`

### Option A: Fastest path tomorrow

Use the official Runpod PyTorch template, copy this repo into `/workspace/drapixai`, then run:

```bash
cd /workspace/drapixai
bash deploy/runpod/bootstrap.sh /workspace/drapixai
cp deploy/env/ai.production.example deploy/env/ai.production.env
```

The bootstrap step now also:

- prepares the CatVTON dependency checkout on the Pod
- reapplies DrapixAI's OpenPose compatibility patch
- downloads the required `human parsing` and `body_pose_model` checkpoints if they are missing
- prepares Hugging Face, Torch, and U2NET cache directories inside the workspace runtime path

Fill `deploy/env/ai.production.env`, then:

```bash
set -a
source deploy/env/ai.production.env
set +a
bash deploy/scripts/validate-env.sh ai
bash deploy/runpod/preflight.sh
bash deploy/runpod/start-all.sh
```

This starts:

- local Redis on the Pod if `DRAPIXAI_REDIS_URL` points to localhost
- AI API on port `8080`
- GPU worker in the foreground
- model preload on the A100 path so the first real try-on is not also the first model load

### Option B: Custom image

Build from `drapixai_ai/docker/Dockerfile` and use that as the Pod image if you want the AI Pod fully containerized from the start.

## 4. GPU Models and Runtime

- Put the CatVTON model files in:
- `/workspace/drapixai/models/catvton`
- The third-party CatVTON checkout is prepared by:
- `python -m drapixai_ai.scripts.prepare_catvton`
- CatVTON weights are downloaded by:
- `python -m drapixai_ai.scripts.download_catvton`
- The AI defaults are now tuned for `DRAPIXAI_GPU_PRESET=runpod-a100`
- A100 presets now default to model preloading and explicit CUDA OpenPose usage
- The API now exposes `/ready`, and the web exposes `/api/health`
- The API S3 client no longer forces MinIO-style path access unless explicitly configured

## 5. Smoke Tests

### Health only

```bash
WEB_URL=https://drapixai.com \
API_URL=https://api.drapixai.com \
AI_URL=http://RUNPOD_POD_IP:8080 \
bash deploy/scripts/healthcheck.sh
```

### Register + validate + optional try-on

```bash
API_URL=https://api.drapixai.com \
DOMAIN=staging.drapixai.com \
bash deploy/scripts/smoke-test.sh
```

With real images:

```bash
API_URL=https://api.drapixai.com \
DOMAIN=staging.drapixai.com \
PERSON_IMAGE=/path/to/person.png \
CLOTH_IMAGE=/path/to/cloth.png \
bash deploy/scripts/smoke-test.sh
```

## 6. Tomorrow Execution Order

1. Create the Runpod Pod.
2. SSH in and run `nvidia-smi`.
3. Copy the repo into `/workspace/drapixai`.
4. Run `bash deploy/runpod/bootstrap.sh /workspace/drapixai`.
5. Fill `deploy/env/ai.production.env`.
6. Run `bash deploy/runpod/preflight.sh`.
7. Start the AI stack with `bash deploy/runpod/start-all.sh`.
8. Bring up the edge host with `deploy/docker-compose.edge.yml`.
9. Point the API to the Runpod AI URL with `DRAPIXAI_AI_URL`.
10. Run `deploy/scripts/healthcheck.sh`.
11. Run `deploy/scripts/smoke-test.sh`.
12. Only declare public readiness after one real `/sdk/tryon` request returns an image successfully.
