# DrapixAI Garment API (Brand Integration)

## 1. Upload Garment (Preprocess + Cache)
**POST** `/sdk/garments`

Form fields:
- `garment_id` (optional, internal asset label)
- `cloth_image` (required)
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
- unsupported: long kurtas, jackets, blazers, coats, cardigans, layered outerwear

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

Common validation errors:
- `MODEL_WORN_GARMENT`
- `GARMENT_TOO_LONG`
- `GARMENT_CATEGORY_UNSUPPORTED`
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
    { "productId": "sku-123", "productName": "Black Oxford Shirt", "category": "Shirts", "garmentType": "upper" }
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

**DELETE** `/sdk/matches/:garmentId/confirm`

Clears a confirmed pairing and lets DrapixAI fall back to suggestion state.

## 6. Garment Image Preview
**GET** `/sdk/garments/:garmentId/image`

Returns PNG image if cached.

## Try-On Usage
**POST** `/sdk/tryon`

Form fields:
- `person_image`
- `productId` (must point to a confirmed product mapping)
- `quality` (optional)
- `garment_type=upper`

If garment is not ready:
- returns `GARMENT_NOT_READY`
If the storefront product is not confirmed yet:
- returns `GARMENT_MAPPING_NOT_CONFIRMED`
