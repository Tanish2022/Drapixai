# DrapixAI Production Readiness

This file is the execution guide for the remaining launch work after local code/build prep.

## 1. Current Local State

- Local Postgres is reachable on `localhost:5432`
- Local Redis is reachable on `localhost:6379`
- Local MinIO is reachable on `localhost:9000`
- Prisma schema has been pushed successfully to the clean local `drapixai` database
- Web and API builds pass
- Python compile validation for `drapixai_ai` passes
- Local Windows output is not a CatVTON quality gate.

## 1A. RunPod Source Of Truth

DrapixAI CatVTON quality is validated on RunPod Linux Ubuntu GPU.

- OS: `Ubuntu 22.04`
- Base image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- Python: `3.11`
- CUDA: `12.4.1`
- GPU target: `A100` preferred, `A10` acceptable, `T4` only for low-cost testing
- Pinned Python stack: `drapixai_ai/requirements.txt`
- Required system packages: `curl`, `ffmpeg`, `git`, `libgl1`, `libglib2.0-0`, `libgomp1`, `libsm6`, `libxext6`, `libxrender1`, `redis-server`

Do not approve production quality from Windows/local smoke images. Production quality gates must run on the RunPod stack above with AutoMasker, normal resolution, normal inference steps, and the expanded matrix.

## 2. Production Env Checklist

Use these three files as the source of truth:

- `deploy/env/api.production.env`
- `deploy/env/web.production.env`
- `deploy/env/ai.production.env`

On Windows, you can create those files with generated secrets first:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\init-production-env.ps1
```

Before starting anything, source the relevant env file and validate it:

```bash
set -a
source deploy/env/api.production.env
set +a
bash deploy/scripts/validate-env.sh api
```

```bash
set -a
source deploy/env/web.production.env
set +a
bash deploy/scripts/validate-env.sh web
```

```bash
set -a
source deploy/env/ai.production.env
set +a
bash deploy/scripts/validate-env.sh ai
```

### Secret generation

Use long random secrets for auth and admin tokens.

PowerShell:

```powershell
-join ((48..57) + (65..90) + (97..122) + 45 + 95 | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Linux:

```bash
openssl rand -base64 48
```

### API envs

Required:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `DRAPIXAI_AI_URL`
- `DRAPIXAI_CORS_ORIGINS`
- `DRAPIXAI_ADMIN_TOKEN`
- `DRAPIXAI_ADMIN_PASSWORD`

Required for storage:

- `S3_BUCKET`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Only for S3-compatible custom endpoints:

- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE=1`

Required for email:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Web envs

Required:

- `NEXT_PUBLIC_WEB_BASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `DRAPIXAI_API_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `ADMIN_SESSION_SECRET`

Required only if Google login is enabled:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=1`

Optional for the marketing/demo experience:

- `NEXT_PUBLIC_DEMO_VIDEO_URL`

### AI envs

Required:

- `DRAPIXAI_GPU_PRESET=runpod-a100`
- `DRAPIXAI_DEVICE=cuda`
- `DRAPIXAI_CUDA_DEVICE=0`
- `DRAPIXAI_REDIS_URL`
- `DRAPIXAI_MODEL_DIR=/workspace/drapixai/models/catvton`
- `DRAPIXAI_TRYON_ENGINE=catvton`
- `DRAPIXAI_GARMENT_CACHE_DIR=/workspace/drapixai/runtime/garments`
- `DRAPIXAI_ADMIN_TOKEN`
- `DRAPIXAI_S3_BUCKET`
- `DRAPIXAI_S3_REGION`
- `DRAPIXAI_S3_ACCESS_KEY_ID`
- `DRAPIXAI_S3_SECRET_ACCESS_KEY`

Recommended defaults already match the A100 path:

- `DRAPIXAI_ENABLE_XFORMERS=1`
- `DRAPIXAI_ENABLE_TF32=1`
- `DRAPIXAI_ENABLE_VAE_TILING=1`
- `DRAPIXAI_ENABLE_CPU_OFFLOAD=0`
- `DRAPIXAI_OPENPOSE_DEVICE=cuda`
- `DRAPIXAI_PRELOAD_MODEL=1`

## 3. Domain, DNS, And Reverse Proxy

Replace `<your-domain>` with your real domain.

### Recommended public layout

- Web: `https://<your-domain>`
- API: `https://api.<your-domain>`

### DNS records

- `A` record for `<your-domain>` -> public IP of the edge host
- `A` record for `api.<your-domain>` -> public IP of the edge host
- Optional `CNAME` or redirect for `www.<your-domain>` -> `<your-domain>`

### Concrete value worksheet

Fill these with your real values before launch:

| Variable | Example format | Where it belongs |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@db-host:5432/drapixai` | `deploy/env/api.production.env` |
| `REDIS_URL` | `redis://default:pass@redis-host:6379` | `deploy/env/api.production.env` |
| `DRAPIXAI_REDIS_URL` | `redis://default:pass@redis-host:6379/0` | `deploy/env/ai.production.env` |
| `NEXT_PUBLIC_WEB_BASE_URL` | `https://<your-domain>` | `deploy/env/web.production.env` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.<your-domain>` | `deploy/env/web.production.env` |
| `DRAPIXAI_AI_URL` | `http://<runpod-ip>:8080` during staging | `deploy/env/api.production.env` |
| `SMTP_FROM` | `no-reply@<your-domain>` | `deploy/env/api.production.env` |
| `GOOGLE_CLIENT_ID` | Google OAuth web client id | `deploy/env/web.production.env` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret | `deploy/env/web.production.env` |

### Reverse proxy values

Current nginx template file:

- `deploy/nginx/drapixai.conf`

Important values to customize:

- `server_name <your-domain> www.<your-domain> api.<your-domain>;`
- certificate paths under `/etc/letsencrypt/live/<your-domain>/`

Current API proxy behavior is already suitable for AI-backed routes:

- `proxy_read_timeout 360s`
- `proxy_send_timeout 360s`
- request body size `20m`

## 4. SMTP Setup

Recommended provider:

- Resend SMTP

Values you will fill:

- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=465` or `587`
- `SMTP_USER=resend`
- `SMTP_PASS=<resend-api-key>`
- `SMTP_FROM=no-reply@<your-domain>`

Minimum verification before launch:

1. Domain verified with SMTP provider
2. One real test email sent from the API
3. Email logs checked in the app/database
4. SPF and DKIM records added for the sending domain

## 5. Google OAuth Setup

Required only if you want Google login at launch.

Create a Google Cloud web OAuth client and set:

- Authorized JavaScript origin:
  - `https://<your-domain>`
- Authorized redirect URI:
  - `https://<your-domain>/api/auth/callback/google`

Minimum verification before launch:

1. Google consent screen configured
2. Domain added correctly
3. One real login completed against production or staging URLs
4. OAuth redirect URI matches the deployed domain exactly

## 6. A100 Runtime Assumptions

These are the current recommended assumptions for Runpod A100:

- Provider: Runpod Pod
- GPU: `A100 PCIe 80GB`
- OS base: Runpod PyTorch `2.4.0`
- Linux only
- AI process runs directly on the Pod
- Redis can be local on the Pod for first staging, but managed Redis is better for production
- Hugging Face, Torch, and U2NET caches live under `/workspace/drapixai/runtime/cache`
- the worker preloads the model on startup so first-request latency is not inflated by cold boot

### Assumptions that still need live confirmation

- one complete `/sdk/tryon` request returns an image successfully
- model path is valid and complete on Runpod
- worker remains stable under actual diffusion workload
- garment preprocessing succeeds on the live Linux GPU path

### What is already favorable for A100

- AI preset `runpod-a100` is present
- timeouts are increased for the stronger GPU path
- local Windows-only workarounds do not block Linux deployment
- deployment scripts target `/workspace/drapixai`

## 7. Runpod Day 1 Command Sequence

After the Pod is created and SSH works:

```bash
nvidia-smi
python --version
docker --version
df -h
ls -la /workspace
```

Copy the repo into `/workspace/drapixai`, then:

```bash
cd /workspace/drapixai
bash deploy/runpod/bootstrap.sh /workspace/drapixai
cp deploy/env/ai.production.example deploy/env/ai.production.env
```

Edit `deploy/env/ai.production.env`, then:

```bash
set -a
source deploy/env/ai.production.env
set +a
bash deploy/scripts/validate-env.sh ai
bash deploy/runpod/preflight.sh
bash deploy/runpod/start-all.sh
```

Verify AI:

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/ready
```

Expected result:

- `/health` returns `{"status":"ok"}`
- `/ready` returns `{"status":"ready","model_ready":true}`

## 8. Staging Checklist

Before calling anything launch-ready, complete this list:

1. Edge host env files filled with real values
2. Runpod AI env file filled with real values
3. Postgres reachable from API
4. Redis reachable from API and AI
5. S3 bucket writes confirmed
6. SMTP test email confirmed
7. Google OAuth callback confirmed, if enabled
8. API `/ready` returns `ready`
9. AI `/ready` returns `ready`
10. One real `/sdk/validate` call succeeds
11. One real `/sdk/garments` call succeeds
12. One real `/sdk/tryon` call returns a real image
13. Env validation passes for `api`, `web`, and `ai`

## 9. Deploy / No-Deploy Gate

### Deploy only if all are true

- web build passes
- API build passes
- local schema sync passes
- staging env files are complete
- edge host is reachable over HTTPS
- API is reachable over HTTPS
- AI is reachable from API
- one full try-on succeeds
- logs show no recurrent worker crash

### Do not deploy yet if any are true

- AI still returns `500` on real try-on
- OAuth credentials are missing but login is exposed publicly
- SMTP is configured incorrectly and signup emails fail
- storage writes fail or generated images cannot be retrieved
- Redis is unstable or worker queue stalls

## 10. Remaining Blockers After Today

- live Runpod A100 validation
- real SMTP verification
- real Google OAuth verification, if enabled
- one successful end-to-end public try-on result on Linux GPU
