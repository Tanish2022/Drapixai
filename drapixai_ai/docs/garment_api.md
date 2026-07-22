# DrapixAI Garment API (Brand Integration)

## 1. Upload Garment (Preprocess + Cache)
**POST** `/sdk/garments`

Form fields:
- `garment_id` (optional, internal asset label)
- `cloth_image` (required)
- `garment_type` (optional, `upper`; `lower` is V1 beta only)
- `category` (recommended for lower-body V1: `Jeans`, `Pants`, `Trousers`, `Shorts`, `Skirt`, `Leggings`, or `Joggers`)
- `admin_bypass` (optional)

Garment upload standard:
- one isolated upper-body garment only
- plain, white, or transparent background
- no visible face, arms, hands, legs, or torso
- no model-worn lifestyle photos
- minimum recommended size: 512x512

Current support matrix:
- launch-ready: shirts, t-shirts, polos, blouses, clean tops
- beta: short kurtis, hoodies, sweatshirts
- lower-body V1 beta: jeans, pants, trousers, shorts, skirts, leggings, joggers
- unsupported: long kurtas, jackets, blazers, coats, cardigans, layered outerwear

Lower-body V1 is disabled unless `DRAPIXAI_ENABLE_LOWER_BODY=1` is set on the Node API and AI service. Lower-body garments use cache version `lower-v1-1024x1365` and are stored as `pending` by default for admin review.

Headers:
- `Authorization: Bearer <api_key>`

Response:
```json
{
  "garmentId": "black-oxford-shirt-a1b2c3",
  "displayName": "Black Oxford Shirt",
  "cacheKey": "brand:sku:hash",
  "didProcess": true,
  "reason": "BACKGROUND_REMOVED"
}
```

During onboarding, DrapixAI stores the original garment and generates a high-quality try-on cache. The current launch cache version is `v3-1024x1365`, built for the SDK to reuse during shopper try-on requests. Product mapping is required before live SDK usage: the shopper-facing SDK sends a confirmed `productId`, and DrapixAI resolves it to the cached garment asset.

Common validation errors:
- `MODEL_WORN_GARMENT`
- `GARMENT_TOO_LONG`
- `GARMENT_CATEGORY_UNSUPPORTED`
- `LOWER_BODY_NOT_ENABLED`
- `LOW_RESOLUTION`
- `IMAGE_BLURRY`
- `SUBJECT_TOO_SMALL`
- `NO_BACKGROUND_REMOVAL`

## 2. Get Garment Info
**GET** `/sdk/garments/:garmentId`

Response:
```json
{
  "garmentId": "black-oxford-shirt-a1b2c3",
  "displayName": "Black Oxford Shirt",
  "cacheKey": "brand:sku:hash",
  "status": "ready",
  "matchStatus": "suggested",
  "suggestedProductId": "sku-123",
  "confirmedProductId": null,
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

## 3. List Garments
**GET** `/sdk/garments`

Response:
```json
{
  "items": [
    {
      "garmentId": "black-oxford-shirt-a1b2c3",
      "displayName": "Black Oxford Shirt",
      "cacheKey": "...",
      "status": "ready",
      "matchStatus": "confirmed",
      "suggestedProductId": "sku-123",
      "confirmedProductId": "sku-123",
      "updatedAt": "..."
    }
  ]
}
```

## 4. Catalog Discovery
**POST** `/sdk/catalog/sync`

Body:
```json
{
  "items": [
    { "productId": "sku-123", "productName": "Black Oxford Shirt", "category": "Shirts", "garmentType": "upper" },
    { "productId": "sku-jeans-1", "productName": "Blue Straight Jeans", "category": "Jeans", "garmentType": "lower" }
  ]
}
```

Response:
```json
{
  "items": [{ "productId": "sku-123", "status": "discovered" }],
  "skipped": []
}
```

**GET** `/sdk/catalog`

Returns discovered products available for matching.

## 5. Match Confirmation
**POST** `/sdk/matches/:garmentId/confirm`

Body:
```json
{ "productId": "sku-123" }
```

This sets the live storefront pairing for that garment.

Upper-body garments can only be confirmed against upper-body products. Lower-body garments can only be confirmed against lower-body products. Type mismatches return `GARMENT_PRODUCT_TYPE_MISMATCH`.

**DELETE** `/sdk/matches/:garmentId/confirm`

Clears a confirmed pairing and lets DrapixAI fall back to suggestion state.

## 6. Garment Image Preview
**GET** `/sdk/garments/:garmentId/image`

Returns PNG image if cached.

## 7. Regenerate Garment Caches

When RunPod is back online, rebuild all onboarding caches after a model, preprocessing, or resolution change:

```bash
npm --prefix apps/api run garments:regenerate-cache
```

Useful options:

```bash
npm --prefix apps/api run garments:regenerate-cache -- --dry-run
npm --prefix apps/api run garments:regenerate-cache -- --user-id=123
```

The command calls the AI preprocess endpoint for each stored original garment, writes a JSON report under `runtime/cache-regeneration`, marks successful products as `ready`, and marks failures as `pending` with a `CACHE_REGEN_FAILED` reason so admins can review or re-upload those assets.

## Try-On Usage
**POST** `/sdk/tryon`

Form fields:
- `person_image`
- `productId` (must point to a confirmed product mapping)
- `quality=standard` (optional; standard is the only production try-on mode)
- `garment_type=upper`
- `garment_type=lower` only when lower-body V1 beta is enabled and the confirmed product/garment mapping is lower-body

Response:
- body: PNG image bytes
- `x-drapixai-tryon-result-id`
- `x-drapixai-engine`
- `x-drapixai-quality-score`
- `x-drapixai-candidate-count`
- `x-drapixai-processing-ms`
- `x-drapixai-latency-ms`
- `x-drapixai-latency-target-ms`
- `x-drapixai-timing-json`
- `x-drapixai-quality-json`
- `x-drapixai-quality-profile`
- `x-drapixai-warnings`

The API stores review metadata for admin quality review:
- person input image
- garment input or cached garment preview
- result image
- quality score
- AI processing time
- full API latency
- warnings

If garment is not ready:
- returns `GARMENT_NOT_READY`
If the storefront product is not confirmed yet:
- returns `GARMENT_MAPPING_NOT_CONFIRMED`

Production latency target:
- warm standard try-on should aim for 10-12 seconds end-to-end
- `x-drapixai-latency-ms` is the API-visible customer wait
- `x-drapixai-processing-ms` is the AI worker/model time
- results above the configured target include a latency warning for admin review
