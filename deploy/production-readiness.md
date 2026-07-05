# DrapixAI Production Readiness

This file is the execution guide for the remaining launch work after local code/build prep.

## 1. Current Local State

- Local Postgres is reachable on `localhost:5433` when `DRAPIXAI_POSTGRES_PORT=5433`
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
bash deploy/scripts/validate-production-env-set.sh
# Windows equivalent:
powershell -ExecutionPolicy Bypass -File deploy\scripts\validate-production-env-set.ps1
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
- `DRAPIXAI_AUTH_SYNC_TOKEN`
- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`
- `DRAPIXAI_AI_URL`
- `DRAPIXAI_AI_SERVICE_TOKEN`
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
- `DASHBOARD_SESSION_SECRET`
- `DRAPIXAI_AUTH_SYNC_TOKEN`
- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`

Required only if Google login is enabled:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=1`

Optional for the marketing/demo experience:

- `NEXT_PUBLIC_DEMO_VIDEO_URL`

### AI envs

Required:

- `DRAPIXAI_GPU_PRESET=runpod-a100`
- `DRAPIXAI_ENV=production`
- `DRAPIXAI_DEVICE=cuda`
- `DRAPIXAI_CUDA_DEVICE=0`
- `DRAPIXAI_REDIS_URL`
- `DRAPIXAI_MODEL_DIR=/workspace/drapixai/models/catvton`
- `DRAPIXAI_TRYON_ENGINE=catvton`
- `DRAPIXAI_GARMENT_CACHE_DIR=/workspace/drapixai/runtime/garments`
- `DRAPIXAI_ADMIN_TOKEN`
- `DRAPIXAI_AI_SERVICE_TOKEN`

Required only when `DRAPIXAI_GARMENT_CACHE_BACKEND=s3`:

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

## 2A. Security Gates

These are hard launch gates, not recommendations:

- `DRAPIXAI_CORS_ORIGINS` must list exact production origins. Never use `*` in production.
- `JWT_SECRET`, `NEXTAUTH_SECRET`, `ADMIN_SESSION_SECRET`, `DASHBOARD_SESSION_SECRET`, `DRAPIXAI_ADMIN_TOKEN`, and `DRAPIXAI_AI_SERVICE_TOKEN` must be long random secrets.
- RunPod setup scripts must generate admin/API/database/object-storage secrets at setup time and must not write fixed credentials into generated env files.
- `npm --prefix apps/api run test:launch` must pass before release; it includes tracked env-file, generated-artifact, source-secret, and operator-log redaction checks so provider tokens and credential-bearing service URLs cannot be committed or printed accidentally.
- `DRAPIXAI_AUTH_SYNC_TOKEN` must be the same long random secret on the web and API services so Google login sync is server-to-server only.
- The same `DRAPIXAI_AI_SERVICE_TOKEN` must be configured on the API and AI service.
- Run `bash deploy/scripts/validate-production-env-set.sh` after editing production env files to verify shared secrets match across API, web, and AI.
- The AI service must run with `DRAPIXAI_ENV=production` on RunPod so missing service/admin tokens fail startup.
- Public upload paths only accept `jpg`, `jpeg`, `png`, and `webp` images.
- `/ready` must not expose detailed internal errors in production unless `DRAPIXAI_EXPOSE_READY_DETAILS=1` is intentionally set for staging.
- The storefront SDK must use confirmed `productId` or a ready cache key; public production traffic should not rely on arbitrary shopper-provided garment uploads.
- SDK try-on and render routes must block expired trials and explicitly inactive subscription states before queuing generation, not only after monthly quota is exhausted.
- Storefront domain verification must use HTTPS in production. The `DRAPIXAI_ALLOW_INSECURE_STORE_VERIFICATION=1` HTTP fallback is only for local development and must not be set on production API services.
- Account store setup, storefront verification, and catalog feed sync errors must return stable failure codes/reasons rather than raw upstream exception text.
- Admin dashboard traffic must go through the same-origin Next admin proxy. Do not expose admin API keys to browser JSON responses or `localStorage`.
- Brand dashboard API keys may be displayed for SDK installation, but must not be persisted in browser `localStorage`; the encrypted httpOnly dashboard session, sealed with `DASHBOARD_SESSION_SECRET`, is the source of truth. Brand dashboard management calls must go through the same-origin Next dashboard proxy, which forwards the key plus `DRAPIXAI_DASHBOARD_PROXY_TOKEN` only server-side. Backend account, analytics, catalog, garment, and mapping management routes must reject direct storefront-key calls that do not include the proxy token. Dashboard session validation must also forward the same private proxy token when checking an existing key. Google OAuth may keep the issued API key in the server-side NextAuth JWT only; browser-visible NextAuth sessions must not expose it.
- The public SDK must sanitize configurable CSS values and logo URLs before injecting generated markup into a brand storefront, and external SDK assets must resolve to HTTPS outside localhost development.
- The web app must ship production security headers from `next.config.js`, including CSP, frame protection, no-sniff, referrer policy, and permissions policy. Browser `connect-src` must be limited to the web/API origins unless explicit extra HTTPS origins are listed in `DRAPIXAI_WEB_CSP_CONNECT_SRC`.
- Cookie-backed admin and dashboard routes must reject cross-origin session and proxy mutations using the configured web origin.
- Session routes that create, clear, or reveal dashboard credentials must return explicit no-store JSON responses so browser/proxy caches do not retain API keys, and admin/dashboard session cookies must be httpOnly, production-secure, and SameSite Strict.
- Public privacy copy and SDK consent text must match the launch retention policy: shopper person photos and generated try-on preview images may be retained for up to 30 days for quality review, fraud prevention, abuse investigation, and support; garment assets stay while the brand account uses DrapixAI; security, billing, and audit logs may be retained for up to 12 months.
- Operators must run `npm --prefix apps/api run tryon:purge-review-retention -- --dry-run` to preview expired shopper review images and `npm --prefix apps/api run tryon:purge-review-retention -- --confirm` to enforce the 30-day review-image retention policy.

Minimum security verification before launch:

```bash
set -a && source deploy/env/api.production.env && set +a
bash deploy/scripts/validate-env.sh api

set -a && source deploy/env/web.production.env && set +a
bash deploy/scripts/validate-env.sh web

set -a && source deploy/env/ai.production.env && set +a
bash deploy/scripts/validate-env.sh ai
bash deploy/scripts/validate-production-env-set.sh
# Windows equivalent:
powershell -ExecutionPolicy Bypass -File deploy\scripts\validate-production-env-set.ps1
```

Then verify:

- unauthenticated `/sdk/tryon` returns `401`
- wrong-origin `/sdk/validate` returns `403`
- missing AI service token on `/ai/tryon/base64` returns `401`
- public demo rejects non-image uploads before reaching the AI worker
- admin routes reject non-admin API keys

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
2. SPF and DKIM records added for the sending domain
3. A real DrapixAI account exists for the test recipient email
4. One real test email sent from the API and confirmed in `EmailLog`:

```bash
npm --prefix apps/api run email:send-test -- --to=admin@yourbrand.com
```

The command fails if SMTP env vars are missing, the recipient is not an existing DrapixAI user, sending fails, or the `EmailLog` row is not written with `status="sent"`.

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

## 8. Local Stack Startup

Use the idempotent local starter when you need the full Windows dev stack:

```powershell
npm run start:local
```

This starts or reuses:

- Docker infra: Postgres, Redis, MinIO
- API on `http://localhost:8000`
- Web on `http://localhost:3000`
- AI API on `http://localhost:8080`

The starter checks whether ports are already listening before launching a service, writes separate stdout/stderr logs under `runtime/logs`, and runs `deploy/scripts/local-preflight.ps1` after startup.

Then prove the local stack through the API. When image inputs are provided, `prove-live-stack.sh` can read `DRAPIXAI_DASHBOARD_PROXY_TOKEN` from `DRAPIXAI_API_ENV_FILE`, `apps/api/.env`, or `deploy/env/api.production.env` before it delegates to the SDK smoke flow:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/prove-live-stack.ps1 -ApiUrl http://localhost:8000
```

## 9. Local SDK Smoke

Use this on Windows/local to prove the storefront onboarding path without treating local CPU generation as a quality gate:

```powershell
$env:API_URL='http://localhost:8000'
$env:DASHBOARD_PROXY_TOKEN=$env:DRAPIXAI_DASHBOARD_PROXY_TOKEN
$env:PERSON_IMAGE='runtime/catalog_assets/cases/01_shirt/person.png'
$env:CLOTH_IMAGE='runtime/catalog_assets/cases/01_shirt/garment.png'
$env:DRAPIXAI_SMOKE_SKIP_TRYON='1'
powershell -ExecutionPolicy Bypass -File deploy/scripts/smoke-test.ps1
```

This proves:

- signup and API key creation
- SDK key validation from the local storefront origin
- garment upload and preprocessing/cache creation
- catalog sync
- confirmed garment-to-product mapping

It intentionally skips final `/sdk/tryon`. Full image generation, quality score, warnings, and latency must still be proven on RunPod A100 with `DRAPIXAI_SMOKE_SKIP_TRYON` unset.

## 10. Staging Checklist

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

## 10. Deploy / No-Deploy Gate

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
