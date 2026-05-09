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
      onResult={(metadata) => console.log(metadata.qualityScore, metadata.latencyMs)}
      onError={(error) => console.warn(error.message)}
    />
  );
}
```

## Props
- `apiKey` (required)
- `productId` (required)
- `containerId` (optional)
- `baseUrl` (optional, default `http://localhost:8000`)
- `garmentType` (optional, `upper`)
- `quality` (optional, `standard`; this is the only production try-on mode)
- `buttonText` (optional)
- `modalTitle` (optional)
- `modalSubtitle` (optional)
- `footerText` (optional)
- `timeoutMs` (optional, default `20000`; storefront should expect normal warm results in 10-12 seconds, with extra room for network variance)
- `primaryGradient` (optional)
- `onResult` (optional metadata callback with result id, engine, quality score, candidate count, AI processing time, API latency, timing breakdown, and warnings)
- `onError` (optional callback with a clean error message and product id)

## Production Flow

1. Upload and preprocess garment images through `/sdk/garments`.
2. Sync catalog products through `/sdk/catalog/sync`.
3. Confirm garment-to-product mapping through `/sdk/matches/:garmentId/confirm`.
4. Install the widget with the confirmed `productId`.
5. Read `metadata.latencyMs`, `metadata.qualityScore`, and `metadata.warnings` from `onResult` for storefront monitoring.
