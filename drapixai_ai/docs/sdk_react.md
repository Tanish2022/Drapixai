# DrapixAI React Component

Use this when a brand has a React/Next.js storefront.

```tsx
import DrapixAITryOn from '@/app/components/DrapixAITryOn';

export default function ProductPage() {
  return (
    <DrapixAITryOn
      apiKey="YOUR_API_KEY"
      productId="PRODUCT_ID"
      garmentType="upper"
      quality="standard"
      buttonText="Try It On"
      modalTitle="Try On"
      modalSubtitle="Upload your photo to see the fit."
      footerText="We never store your photo."
      timeoutMs={20000}
      primaryGradient="linear-gradient(90deg,#22d3ee,#3b82f6)"
      logoUrl="https://cdn.yourbrand.com/logo-mark.svg"
      onResult={(metadata) => {
        // Send this to your brand analytics or admin monitoring.
        console.log(metadata.qualityScore, metadata.latencyMs);
      }}
      onError={(error) => {
        // Show a clean storefront message and log the code internally.
        console.warn(error.message);
      }}
    />
  );
}
```

## Props
- `apiKey` (required)
- `productId` (required)
- `containerId` (optional)
- `baseUrl` (optional; defaults to the deployed `NEXT_PUBLIC_API_BASE_URL` used by your storefront build, with localhost only for local development)
- `garmentType` (optional, `upper`; `lower` is V1 beta only)
- `garmentCategory` (optional for lower-body beta: `jeans`, `pants`, `trousers`, `shorts`, `skirt`, `leggings`, or `joggers`)
- `enableLowerBody` (optional; required by the browser SDK before it initializes lower-body beta)
- `quality` (optional, `standard`; this is the only production try-on mode)
- `buttonText` (optional)
- `modalTitle` (optional)
- `modalSubtitle` (optional)
- `footerText` (optional)
- `timeoutMs` (optional, default `20000`; storefront should expect normal warm results in 10-12 seconds, with extra room for network variance)
- `enableDownload` (optional, default `true`; set `false` if a brand wants shoppers to buy/share without saving a local result)
- `primaryGradient` (optional)
- `logoUrl` (optional; override the delivered DrapixAI emblem with an approved co-branded mark)
- `onResult` (optional metadata callback with result id, engine, quality score, candidate count, AI processing time, API latency, timing breakdown, and warnings)
- `onError` (optional callback with a clean error message and product id)

## Production Flow

1. Upload and preprocess garment images through `/sdk/garments`.
2. Sync catalog products through `/sdk/catalog/sync`.
3. Confirm garment-to-product mapping through `/sdk/matches/:garmentId/confirm`.
4. DrapixAI generates a high-quality onboarding cache for each garment at the active cache version, currently `v3-1024x1365`.
5. Install the widget with the confirmed `productId`.
6. Read `metadata.latencyMs`, `metadata.qualityScore`, and `metadata.warnings` from `onResult` for storefront monitoring.

Lower-body V1 remains server-gated. Even if a storefront passes `garmentType="lower"` and `enableLowerBody`, the API rejects the request unless `DRAPIXAI_ENABLE_LOWER_BODY=1` is set on both the Node API and AI service. Lower-body garments use the separate `lower-v1-1024x1365` cache version and remain admin-review gated before public rollout.

The storefront SDK should not upload arbitrary garment photos during shopper try-on. It sends the shopper person photo plus the confirmed `productId`; the API resolves that product to the approved garment and uses the cached try-on asset. This keeps quality consistent and avoids spending request time on garment preprocessing.

Production storefronts must set `NEXT_PUBLIC_API_BASE_URL` to the HTTPS API endpoint, for example `https://api.drapixai.com`. Do not ship a public storefront that points to localhost or a development tunnel.

## Returned Metadata

The binary `/sdk/tryon` response includes the PNG body and these headers, which the SDK maps into `onResult`:

- `x-drapixai-quality-score`
- `x-drapixai-latency-ms`
- `x-drapixai-processing-ms`
- `x-drapixai-latency-target-ms`
- `x-drapixai-warnings`
- `x-drapixai-timing-json`
- `x-drapixai-engine`
- `x-drapixai-quality-mode`
- `x-drapixai-quality-profile`
- `x-drapixai-quality-json`

Use the quality, latency, and warnings fields for brand dashboards, public-launch monitoring, and manual review routing.
