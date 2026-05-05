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
      quality="enhanced"
      buttonText="Try It On"
      modalTitle="Try On"
      modalSubtitle="Upload your photo to see the fit."
      footerText="We never store your photo."
      primaryGradient="linear-gradient(90deg,#22d3ee,#3b82f6)"
      onResult={(metadata) => console.log(metadata.qualityScore)}
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
- `quality` (optional, `standard` or `enhanced`)
- `buttonText` (optional)
- `modalTitle` (optional)
- `modalSubtitle` (optional)
- `footerText` (optional)
- `primaryGradient` (optional)
- `onResult` (optional metadata callback with result id, engine, quality score, candidate count, and warnings)
