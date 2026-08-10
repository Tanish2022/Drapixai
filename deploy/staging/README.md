# Isolated staging deployment

This topology keeps staging PostgreSQL, Redis, object storage, and GPU services
off the public internet. It is intentionally separate from every production
database, Redis database, bucket, secret record, queue, volume, and AI endpoint.

## Public path

Only the chosen HTTPS WAF or secure tunnel is public. It forwards the staging web
origin to `127.0.0.1:13000` and the staging API origin to `127.0.0.1:18000`.
Do not open either origin port in the host firewall. Configure the WAF with upload
limits, bot controls, rate limits, TLS 1.2 or newer, and origin authentication.

## GPU path

The AI API remains at `127.0.0.1:18080` on the GPU workstation. A private reverse
proxy exposes it only on the Tailscale or WireGuard address with an internal TLS
certificate. Permit API-host-to-GPU TCP 443 and administrator VPN SSH; deny public
GPU ingress and GPU access to the edge PostgreSQL, Redis, and MinIO services.
The shopper-image spool is placed under `/dev/shm`, never the persistent model or
runtime volume. Disable swap or use encrypted swap, and enable full-disk encryption
for every host so crash dumps and operating-system artifacts cannot persist photos
in plaintext.

## First deployment

1. Copy the examples without committing the resulting files:

   ```bash
   cp deploy/env/api.staging.example deploy/env/api.staging.env
   cp deploy/env/web.staging.example deploy/env/web.staging.env
   cp deploy/env/ai.staging.example deploy/env/ai.staging.env
   ```

2. Generate staging-only mounted secrets:

   ```bash
   python deploy/scripts/generate-staging-secrets.py
   ```

3. Install the private CA certificate at
   `/run/secrets/drapixai-internal-ca.pem` in the API container. Configure the GPU
   reverse proxy with a certificate for `drapixai-ai.staging.internal`.

4. Put the generated AI Redis password and service token on the GPU host through
   the VPN. Replace the matching placeholders in `ai.staging.env` locally.

5. Verify source topology and environment separation:

   ```bash
   python deploy/scripts/verify-staging-topology.py
   node deploy/scripts/verify-environment-isolation.mjs \
     deploy/env/api.staging.env deploy/env/api.production.env
   ```

6. Start the edge and GPU projects with different Compose project names:

   ```bash
   docker compose --env-file deploy/staging/.images.env \
     -f deploy/staging/docker-compose.edge.yml up -d --build
   docker compose --env-file deploy/staging/.images.env \
     -f deploy/staging/docker-compose.ai.yml up -d --build
   ```

7. Run `deploy/scripts/verify-private-listeners.sh` on both hosts and confirm the
   router or cloud firewall rules separately.

8. Apply the Prisma migration with backup evidence, then run the complete staging
   smoke and security suites. Never point staging at production to save setup time.

## Live security-boundary certification

Run the live attack harness only against staging and only with a dedicated staging
tenant, products, result, server key, and public API access token. It refuses the
production hostname. It never creates a try-on result or uploads a real shopper
photo.

Before running it, temporarily set `DRAPIXAI_API_KEY_RATE_LIMIT=20` in the staging
API environment and restart the staging API. This makes the bounded rate-limit
check complete in 21 lightweight `GET /v1/usage` requests. Restore the normal
staging value after saving the evidence. The public API access token needs both
`api:usage` and `api:webhooks` scopes.

Create a restricted local environment file through the staging secret store, not in
the repository and not in shell history. It must provide the variables listed in
`docs/security-release-gate.md`, plus `DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A`,
`DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH` (set to `/v1/usage`),
`DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS` (set to `21`), and
`DRAPIXAI_SECURITY_TEST_ENVIRONMENT` (set to `staging`). Then run:

```bash
set -a; . /run/secrets/drapixai-live-security-test.env; set +a
npm --prefix apps/api run test:security:live | tee runtime/launch-evidence/live-security-boundary.json
```

The saved JSON must report every check and a `429` rate-limit response. It covers
cross-tenant access, expired and cross-origin credential replay, forged-image
uploads, admin authorization, webhook SSRF, hostile CORS preflight, unauthenticated
cross-origin feedback, and API-key-level limiting. Capture the resulting audit-log
rows and WAF events with the evidence; do not put credentials or shopper media in
the evidence file.

## Repeatable staging certification

After saving the restricted environment file and a token-free three-tenant manifest,
run the guarded certification runner from the exact clean release checkout:

```bash
bash deploy/staging/certify-release.sh /run/secrets/drapixai-staging-certification.env
```

It refuses non-staging URLs, a dirty checkout, a commit mismatch, output outside
`runtime/launch-evidence`, and a live-security URL that differs from the staging
origin. It collects the local topology, listener, live security, audit-chain,
shopper-media privacy, and three-tenant API reports. It retains no output images;
run the private-listener check separately on the GPU host and attach that redacted
output to the same release record.

## Promotion rule

Passing this source check does not mean staging is deployed. Gate 2 closes only
when the live host evidence proves distinct identities, private listeners, HTTPS
WAF routing, VPN/mTLS GPU communication, backup restoration, and successful health
checks. Store that evidence under the ignored `runtime/launch-evidence` directory.
