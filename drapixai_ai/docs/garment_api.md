# DrapixAI Garment API (Brand Integration)

## 1. Upload Garment (Preprocess + Cache)
**POST** `/sdk/garments`

Form fields:
- `garment_id` (required, your product ID)
- `cloth_image` (required)
- `admin_bypass` (optional)

Headers:
- `Authorization: Bearer <api_key>`

Response:
```json
{
  "garmentId": "sku-123",
  "cacheKey": "brand:sku:hash",
  "didProcess": true,
  "reason": "BACKGROUND_REMOVED"
}
```

## 2. Get Garment Info
**GET** `/sdk/garments/:garmentId`

Response:
```json
{
  "garmentId": "sku-123",
  "cacheKey": "brand:sku:hash",
  "status": "ready",
  "updatedAt": "2026-03-16T00:00:00.000Z"
}
```

## 3. List Garments
**GET** `/sdk/garments`

Response:
```json
{
  "items": [
    { "garmentId": "sku-123", "cacheKey": "...", "status": "ready", "updatedAt": "..." }
  ]
}
```

## 4. Garment Image Preview
**GET** `/sdk/garments/:garmentId/image`

Returns PNG image if cached.

## 5. Sync Product Catalog
**POST** `/sdk/garments/sync`

Body:
```json
{ "productIds": ["sku-1", "sku-2"] }
```

Response:
```json
{ "items": [{ "garmentId": "sku-1", "status": "missing" }] }
```

## Try-On Usage
**POST** `/sdk/tryon`

Form fields:
- `person_image`
- `productId` (maps to garment_id)
- `quality` (optional)
- `garment_type=upper`

If garment is not ready:
- returns `GARMENT_NOT_READY`
