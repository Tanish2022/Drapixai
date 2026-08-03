# DrapixAI Public API v1

The public REST API and storefront SDK use the same Standard CatVTON try-on handler. API versioning changes the integration contract, not the generation model, preprocessing, garment cache, or quality gate.

## Security boundary

- Permanent server keys stay on the brand backend.
- `POST /v1/tokens` exchanges a server key for a 15-minute access token.
- Access tokens contain explicit scopes and at most 50 product IDs.
- Every try-on product must already have a confirmed, DrapixAI-Ready garment mapping.
- Live and sandbox are separate deployments with separate PostgreSQL, Redis, object storage, secrets, and keys.
- `DRAPIXAI_API_ENVIRONMENT` must be explicitly set to `live` or `sandbox` in production.
- Production never accepts a sandbox access token.
- Try-on creation requires a 16-128 character `Idempotency-Key`.
- Idempotency records are tenant-scoped and retained for 24 hours.
- Shopper consent and the current privacy-policy version are required on every try-on.
- Person photos and generated previews are transient-only, excluded from logs, and never used for model training.
- Results and metadata are always queried with the authenticated tenant ID.
- Webhook endpoints require HTTPS, reject local/private literal addresses, and are revalidated with DNS pinning during delivery.
- Webhooks use AES-256-GCM encrypted secrets and HMAC-SHA256 signatures.

## Authentication

Exchange the server key:

```bash
curl -X POST https://api.drapixai.com/v1/tokens \
  -H "Authorization: Bearer $DRAPIXAI_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["api:tryon"],"product_ids":["SH-1042"]}'
```

The server key requires `api:token:issue`. Requested scopes must also exist on that key. Supported access-token scopes are:

- `api:tryon`
- `api:usage`
- `api:webhooks`

## Standard try-on

```bash
curl -X POST https://api.drapixai.com/v1/tryons \
  -H "Authorization: Bearer $DRAPIXAI_ACCESS_TOKEN" \
  -H "Idempotency-Key: 1f564712-2b77-4a1f-9953-93374977bb16" \
  -F "person_image=@person.jpg" \
  -F "productId=SH-1042" \
  -F "garment_type=upper" \
  -F "quality=standard" \
  -F "shopper_consent=true" \
  -F "privacy_policy_version=2026-08-04" \
  --output result.png
```

Successful responses contain PNG bytes and the same `x-drapixai-*` quality and latency headers returned to the storefront SDK. `x-drapixai-media-retention: transient-only` and `x-drapixai-training-use: none` make the privacy contract machine-readable. Auto-rejected results return HTTP 422 and are not suitable for shopper display.

## API usage pricing

The storefront SDK and REST API share one monthly account quota. All public plans use the same Standard generation pipeline.

| Plan | Monthly price | Included successful try-ons | Effective price |
| --- | ---: | ---: | ---: |
| Trial | $0 for 12 days | 300 | Evaluation only |
| Starter | $49 | 1,000 | $0.0490/result |
| Growth | $199 | 7,500 | $0.0265/result |
| Pro | $499 | 25,000 | $0.0200/result |
| Enterprise | Custom | 100,000+ | Negotiated |

One unit is consumed only when `POST /v1/tryons` produces its first successful, publishable HTTP 200 result. The following do not consume another unit:

- HTTP 422 results rejected by the quality gate
- validation, authentication, rate-limit, or upstream generation failures
- a duplicate idempotency key after an already-counted result
- token exchange, usage reads, webhook operations, and OpenAPI access

Public plans use a hard monthly quota with no automatic overage billing at launch. When quota is exhausted, try-on creation returns HTTP 429. Use `GET /v1/usage` to read current usage, quota, and remaining capacity. Prices are in USD and exclude applicable taxes.

## Idempotency

Generate a new idempotency key for each logical try-on. Concurrent duplicates return HTTP 409 with `Retry-After`. After the first response completes, DrapixAI keeps the metadata idempotency record but does not retain the shopper preview bytes. A later replay therefore returns `IDEMPOTENT_RESPONSE_NOT_RETAINED` instead of silently generating and charging for a second result. Clients must save the original successful response locally when they need it.

Never reuse a key for a different person image or product.

## Signed webhooks

Supported events:

- `tryon.completed`
- `tryon.rejected`

The endpoint secret is returned only at creation. DrapixAI sends:

- `DrapixAI-Event-Id`
- `DrapixAI-Event-Type`
- `DrapixAI-Timestamp`
- `DrapixAI-Signature: v1=<hex digest>`

Verify the signature over:

```text
<timestamp>.<event-id>.<raw-request-body>
```

Reject timestamps older than five minutes and persist event IDs to prevent replay. Delivery retries use bounded exponential delays and stop after six attempts.

## OpenAPI

The machine-readable contract is available from:

```text
GET /v1/openapi.json
```

Deployment evidence must verify the sandbox and live endpoints independently before the REST API is advertised as generally available.
