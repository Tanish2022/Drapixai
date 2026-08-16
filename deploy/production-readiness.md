# DrapixAI Production Readiness

This file is the execution guide for the remaining launch work after local code/build prep.

The hard public-launch security decision is defined in `docs/security-release-gate.md`. Generate release evidence with `npm run launch:report`; do not infer launch readiness from this guide alone.

## 1. Current Local State

- Local Postgres is reachable on `localhost:5433` when `DRAPIXAI_POSTGRES_PORT=5433`
- Local Redis is reachable on `localhost:6379`
- Local MinIO is reachable on `localhost:9000`
- Prisma schema is valid, and the initial migration has been deployed successfully to an isolated clean database
- Web and API builds pass
- Python compile validation for `drapixai_ai` passes
- Local Windows output is not a CatVTON quality gate.

## 1A. Linux GPU Source Of Truth

DrapixAI public quality and reliability are validated on the same Linux GPU runtime that serves shoppers. The primary launch target is the on-premises RTX PRO 6000 Blackwell Workstation Edition with 96 GB VRAM. RunPod A100 remains a useful reference and rollback benchmark, but it is not the production source of truth.

- Host OS: Ubuntu Linux with the NVIDIA driver and Docker NVIDIA runtime verified.
- GPU preset: rtx-pro-6000-blackwell.
- AI runtime: dependencies compile in the digest-pinned `pytorch/pytorch:2.11.0-cuda12.8-cudnn9-devel` builder configured by `DRAPIXAI_AI_BUILD_IMAGE`; the final artifact uses the matching digest-pinned `pytorch/pytorch:2.11.0-cuda12.8-cudnn9-runtime` image configured by `DRAPIXAI_AI_RUNTIME_IMAGE`. Its CUDA 12.8/PyTorch 2.11 build is Blackwell-capable and uses Python 3.12. The older RunPod Python 3.11/CUDA 12.4 stack is reference-only and must not run production Compose.
- Host driver: NVIDIA 570 or newer; workstation preflight rejects an older driver before AI services start.
- Runtime: Blackwell-native Linux image and the audited security-candidate Python stack, promoted only after direct, SDK, quality, latency, and three-tenant tests.
- Mode: Standard-only CatVTON, one candidate, 22 steps, 2.5 guidance scale.
- Caches and model locks are immutable for a release; shopper images remain transient under /dev/shm.

Do not approve public quality from Windows/local smoke images or from a different GPU class. The rights-cleared matrix, direct/SDK parity, and three-tenant test must run on the exact RTX workstation image and release commit that will serve traffic.

## 1B. Immutable Release Artifact Promotion

Production hosts must never rebuild DrapixAI source during a rollout. Build and scan the API, web, and Standard CatVTON runtime from the exact tagged release commit, then deploy only their registry digests. This preserves the approved Standard quality configuration while making rollback and forensic review deterministic.

1. On an isolated trusted builder with registry login, check out the exact release commit with a clean worktree.
2. Set `DRAPIXAI_RELEASE_REGISTRY` to the private registry namespace and `DRAPIXAI_EXPECTED_GIT_REF` to that 40-character commit, then run:

```bash
DRAPIXAI_RELEASE_REGISTRY=registry.example/drapixai \
DRAPIXAI_EXPECTED_GIT_REF=<release-commit> \
bash deploy/scripts/publish-release-images.sh deploy/env/ai.production.env
```

The script builds linux/amd64 artifacts, scans each saved image for HIGH/CRITICAL vulnerabilities, pushes only passing images, resolves their registry digests, and writes a private `runtime/release-images/<release-commit>.env` record. Its registry credentials remain in Docker's credential helper, never in source or env templates.

3. Copy the three generated digest references into the ignored production env files. Keep `DRAPIXAI_WEB_RELEASE_IMAGE` identical in both `api.production.env` and `web.production.env`; the API env provides both edge Compose image inputs before any service env file is loaded.
4. On the matching clean edge and GPU checkouts, validate the env files, then start only prebuilt artifacts:

```bash
DRAPIXAI_EXPECTED_GIT_REF=<release-commit> \
bash deploy/scripts/start-production-release.sh edge deploy/env

DRAPIXAI_EXPECTED_GIT_REF=<release-commit> \
bash deploy/scripts/start-production-release.sh ai deploy/env
```

The start script runs `docker compose pull` and `up -d --no-build`; it refuses mutable tags, an unexpected commit, or a dirty checkout. The production AI manifest contains no lower-body service or source build path; lower-body work remains confined to its internal test tooling until separately certified.
## 2. Production Env Checklist

Use these three files as the source of truth:

- `deploy/env/api.production.env`
- `deploy/env/web.production.env`
- `deploy/env/ai.production.env`

### Database migration gate

For a fresh database, deploy schema changes with:

```bash
npm --prefix apps/api run prisma:migrate:deploy
```

For an existing database previously managed with `prisma db push`, take a verified backup first. Confirm that its schema matches `apps/api/prisma/schema.prisma`, then baseline the initial migration without executing its table-creation SQL:

```bash
cd apps/api
npx prisma migrate resolve --applied 20260713150000_initial_launch_schema
```

Do not run the initial migration directly against populated tables. Future releases must add a new migration and use `prisma migrate deploy`; `prisma db push` remains a local prototyping command only.

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
- `DRAPIXAI_AI_PRIVATE_NETWORK=1`
- `DRAPIXAI_AI_MTLS_ENABLED=1`
- `DRAPIXAI_AI_MTLS_CERT_FILE` and `DRAPIXAI_AI_MTLS_KEY_FILE`
- `NODE_EXTRA_CA_CERTS`
- `DRAPIXAI_CORS_ORIGINS`
- `DRAPIXAI_ADMIN_TOKEN`
- `DRAPIXAI_ADMIN_PASSWORD`

Required for storage:

- `S3_BUCKET`
- `AWS_REGION`
- `DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY=1`
- `DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION=aws:kms`
- `DRAPIXAI_S3_KMS_KEY_ID`

The live API must not receive `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`. Grant its runtime identity only the required Secrets Manager, S3, and KMS permissions. Custom S3/MinIO endpoints and static credentials are staging-only.

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

- `DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell`
- `DRAPIXAI_ENV=production`
- `DRAPIXAI_DEVICE=cuda`
- `DRAPIXAI_CUDA_DEVICE=0`
- `DRAPIXAI_REDIS_URL`
- `DRAPIXAI_MODEL_DIR=/workspace/drapixai/models/catvton`
- `DRAPIXAI_TRYON_ENGINE=catvton`
- `DRAPIXAI_GARMENT_CACHE_DIR=/workspace/drapixai/runtime/garments`
- `DRAPIXAI_MIN_QUALITY_SCORE=0.95`
- `DRAPIXAI_ADMIN_TOKEN`
- `DRAPIXAI_AI_SERVICE_TOKEN`
- `DRAPIXAI_AI_PRIVATE_NETWORK=1`
- `DRAPIXAI_AI_MTLS_ENABLED=1`
- `DRAPIXAI_AI_MTLS_CERT_FILE` and `DRAPIXAI_AI_MTLS_KEY_FILE`
- `NODE_EXTRA_CA_CERTS`

Required only when `DRAPIXAI_GARMENT_CACHE_BACKEND=s3`:

- `DRAPIXAI_S3_BUCKET`
- `DRAPIXAI_S3_REGION`
- `DRAPIXAI_S3_ACCESS_KEY_ID`
- `DRAPIXAI_S3_SECRET_ACCESS_KEY`

Recommended defaults match the RTX PRO 6000 Standard path:

- `DRAPIXAI_ENABLE_XFORMERS=0` for the pinned Blackwell runtime. Do not enable it until the exact workstation image passes the direct, SDK, latency, and quality certification suite.
- `DRAPIXAI_ENABLE_TF32=1`
- `DRAPIXAI_ENABLE_VAE_TILING=1`
- `DRAPIXAI_ENABLE_CPU_OFFLOAD=0`
- `DRAPIXAI_OPENPOSE_DEVICE=cuda`
- `DRAPIXAI_PRELOAD_MODEL=1`

## 2A. Security Gates

These are hard launch gates, not recommendations:

- `DRAPIXAI_CORS_ORIGINS` must list exact production origins. Never use `*` in production.
- The API and AI services must both enforce a minimum publishable quality score of `0.95`; latency above 12 seconds is a performance-review condition, not permission to use a lower-quality generation path.
- `JWT_SECRET`, `NEXTAUTH_SECRET`, `ADMIN_SESSION_SECRET`, `DASHBOARD_SESSION_SECRET`, `DRAPIXAI_ADMIN_TOKEN`, and `DRAPIXAI_AI_SERVICE_TOKEN` must be long random secrets.
- GPU-host setup scripts must generate admin/API/database/object-storage secrets at setup time and must not write fixed credentials into generated env files.
- `npm --prefix apps/api run test:launch` must pass before release; it includes tracked env-file, generated-artifact, source-secret, and operator-log redaction checks so provider tokens and credential-bearing service URLs cannot be committed or printed accidentally.
- The full resolved graph in `drapixai_ai/requirements.security-candidate.txt` must pass `pip-audit` with only the four documented deployment-inapplicable exceptions in `docs/ai-runtime-security.md`. A top-level-only `--no-deps` audit is not a launch gate.
- `DRAPIXAI_AUTH_SYNC_TOKEN` must be the same long random secret on the web and API services so Google login sync is server-to-server only.
- The same `DRAPIXAI_AI_SERVICE_TOKEN` must be configured on the API and AI service.
- Run `bash deploy/scripts/validate-production-env-set.sh` after editing production env files to verify shared secrets match across API, web, and AI.
- The AI service must run with `DRAPIXAI_ENV=production` on the GPU host so missing service/admin tokens fail startup.
- CatVTON output safety must remain enabled with `DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK=0`; GPU preflight verifies its safety checker, feature extractor, and replacement image before startup.
- API and Shopify catalog image writes must fail closed when object storage is unavailable. Keep `DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK=0` in production so temporary node disks never become an accidental data store.
- Public upload paths only accept `jpg`, `jpeg`, `png`, and `webp` images.
- `/ready` must not expose detailed internal errors in production unless `DRAPIXAI_EXPOSE_READY_DETAILS=1` is intentionally set for staging.
- The storefront SDK must use confirmed `productId` or a ready cache key; public production traffic should not rely on arbitrary shopper-provided garment uploads.
- SDK try-on and render routes must block expired trials and explicitly inactive subscription states before queuing generation, not only after monthly quota is exhausted.
- Storefront domain verification must use HTTPS in production. The `DRAPIXAI_ALLOW_INSECURE_STORE_VERIFICATION=1` HTTP fallback is only for local development and must not be set on production API services.
- Production SDK keys must never auto-bind to the first caller-supplied domain. Keep `DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND=0`; configure and verify the storefront domain through the protected dashboard before installing the SDK. Public SDK validation derives the domain from the request origin and ignores caller-provided domain payloads.
- Production SDK requests must also require a completed storefront ownership check (`storeVerifiedAt`). Saving a domain is not sufficient; the brand must publish the dashboard-provided verification meta tag and complete verification before shopper traffic is accepted.
- New API keys use high-entropy `dpx_` values with indexed SHA-256 digest lookup. Keep `DRAPIXAI_ALLOW_LEGACY_API_KEYS=0` in production so random invalid requests cannot trigger sequential bcrypt checks across historical keys. Before rollout, rotate every pre-launch 32-character API key through the dashboard and update its storefront installation.
- Keep `DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER=0`. The supported public flow is binary `POST /sdk/tryon`; the historical `/sdk/render` queue has no production consumer and fails closed with `410 Gone`.
- Account store setup, storefront verification, and catalog feed sync errors must return stable failure codes/reasons rather than raw upstream exception text.
- Admin dashboard traffic must go through the same-origin Next admin proxy. Do not expose admin API keys to browser JSON responses or `localStorage`.
- Brand dashboard API keys may be displayed for SDK installation, but must not be persisted in browser `localStorage`; the encrypted httpOnly dashboard session, sealed with `DASHBOARD_SESSION_SECRET`, is the source of truth. Brand dashboard management calls must go through the same-origin Next dashboard proxy, which forwards the key plus `DRAPIXAI_DASHBOARD_PROXY_TOKEN` only server-side. Backend account, analytics, catalog, garment, and mapping management routes must reject direct storefront-key calls that do not include the proxy token. Dashboard session validation must also forward the same private proxy token when checking an existing key. Google OAuth may keep the issued API key in the server-side NextAuth JWT only; browser-visible NextAuth sessions must not expose it.
- The public SDK must sanitize configurable CSS values and logo URLs before injecting generated markup into a brand storefront, and external SDK assets must resolve to HTTPS outside localhost development.
- The web app must ship production security headers from `next.config.js`, including CSP, frame protection, no-sniff, referrer policy, and permissions policy. Browser `connect-src` must be limited to the web/API origins unless explicit extra HTTPS origins are listed in `DRAPIXAI_WEB_CSP_CONNECT_SRC`.
- Cookie-backed admin and dashboard routes must reject cross-origin session and proxy mutations using the configured web origin.
- Session routes that create, clear, or reveal dashboard credentials must return explicit no-store JSON responses so browser/proxy caches do not retain API keys, and admin/dashboard session cookies must be httpOnly, production-secure, and SameSite Strict.
- Public privacy copy and SDK consent text must match the launch policy: shopper person photos and generated previews are transient-only, are excluded from logs and training, and are not persisted in the database or object storage. Interrupted AI jobs have a 15-minute failsafe spool cleanup. Brand garment assets stay while the brand account uses DrapixAI; metadata-only security, billing, consent, quality, and audit records may be retained under the published policy.
- Operators must run `npm --prefix apps/api run tryon:purge-review-retention -- --dry-run` to find legacy shopper review images and `npm --prefix apps/api run tryon:purge-review-retention -- --confirm` to delete them immediately under the zero-day retention policy.
- Before the first staging or production certification, run `npm --prefix apps/api run privacy:purge-legacy-media` to inspect historical disabled `/sdk/render` media, then run `npm --prefix apps/api run privacy:purge-legacy-media -- --confirm` after approval. This clears legacy `Render` URLs and `session/` or `outputs/` storage objects before the no-retention verifier runs.
- After one consented staging try-on, run `npm --prefix apps/api run privacy:verify-shopper-media`. The command must report zero database image references, zero shopper-media objects, and at least one immutable consent and non-retention event before Gate 3 may pass.

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
| `DRAPIXAI_AI_URL` | `https://ai.<private-domain>` over VPN/mTLS | `deploy/env/api.production.env` |
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

## 6. RTX PRO 6000 Production Runtime

The on-premises RTX PRO 6000 Blackwell workstation is the primary production GPU. It runs the AI API and CUDA worker behind private TLS, reachable only from the API host over the company VPN or site-to-site private network. Public traffic never reaches the workstation directly.

- GPU: RTX PRO 6000 Blackwell Workstation Edition, 96 GB VRAM.
- OS: supported Ubuntu Linux with a validated NVIDIA driver and Docker NVIDIA Container Toolkit.
- GPU preset: rtx-pro-6000-blackwell.
- AI runtime: dependencies compile in the digest-pinned `pytorch/pytorch:2.11.0-cuda12.8-cudnn9-devel` builder configured by `DRAPIXAI_AI_BUILD_IMAGE`; the final artifact uses the matching digest-pinned `pytorch/pytorch:2.11.0-cuda12.8-cudnn9-runtime` image configured by `DRAPIXAI_AI_RUNTIME_IMAGE`. Its CUDA 12.8/PyTorch 2.11 build is Blackwell-capable and uses Python 3.12. The older RunPod Python 3.11/CUDA 12.4 stack is reference-only and must not run production Compose.
- Host driver: NVIDIA 570 or newer; workstation preflight rejects an older driver before AI services start.
- Runtime storage: immutable models and a persistent garment cache; transient shopper image spool in /dev/shm only.
- Queue: private Redis credentials and network segment distinct from public API and database services.
- Worker: preload CatVTON before opening traffic; begin with adaptive batching disabled, then enable three-user batching only after its acceptance test passes.

Before starting the AI Compose project on the workstation, set the exact release
commit and a reviewed, digest-pinned CUDA probe image, then run:

```bash
export DRAPIXAI_EXPECTED_GIT_REF=replace-with-40-character-release-commit
export DRAPIXAI_NVIDIA_CUDA_PROBE_IMAGE=registry.example.com/cuda-probe@sha256:replace-with-64-hex-digest
bash deploy/workstation/preflight.sh deploy/env/ai.production.env
```
### Assumptions that still need live confirmation

- the audited Blackwell-native runtime passes its dependency audit and xFormers CUDA kernel check on this exact driver;
- the enabled CatVTON safety checker stays inside the 12-second warm SDK target without changing accepted-result realism;
- direct and SDK requests return equivalent, warning-free Standard outputs;
- the three-tenant batch leaves at least 20% VRAM headroom and has no cross-tenant result mix-up;
- private TLS, workstation firewall, VPN routing, and fail-closed AI service authentication work together on the deployed hosts.

### Reference RunPod use

RunPod A100 can still be used for a temporary benchmark or incident rollback comparison. It must use a separately recorded release evidence set and must not silently replace or override the RTX production baseline.

## 7. Reference RunPod Day 1 Command Sequence

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

## 10. Staging Verification

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

## 11. Release Decision

### Deploy only if all are true

- web build passes
- API build passes
- `prisma migrate deploy` passes on a clean verification database
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

## 12. Remaining Launch Evidence

- configure `DRAPIXAI_AI_URL` as the verified private VPN/mTLS GPU endpoint, then record failed and successful client-certificate handshakes
- promote the primary RTX PRO 6000 Blackwell runtime only after direct/SDK parity, output-safety, quality, latency, and three-tenant validation on that exact release image
- pass the rights-cleared 50-case upper-body matrix with one candidate, score at least `0.95`, no warnings, and recorded latency
- deploy migrations to the production PostgreSQL database and prove API/Redis/AI readiness through the public HTTPS edge
- confirm production object-storage write/read/delete behavior with local fallback disabled
- confirm one real SMTP delivery and its `EmailLog` audit row
- complete real Google OAuth verification only if Google login remains enabled at launch
- supply Shopify Partner credentials, complete a development-store Theme App Extension test, and satisfy Shopify review requirements before advertising one-click Shopify installation
- run one successful public SDK try-on from a verified storefront domain and record redacted headers, latency, and quality decision; retain an image only with documented internal consent and delete it after approval
