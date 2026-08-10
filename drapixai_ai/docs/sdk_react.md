# DrapixAI React Component

Use this component in a React or Next.js storefront. The browser must receive a
**short-lived, product-scoped storefront token** from your own server endpoint.
Never place a DrapixAI server API key in component props, browser code, mobile
binaries, environment variables prefixed `NEXT_PUBLIC_`, or a public Git
repository.

```tsx
import DrapixAITryOn from '@/app/components/DrapixAITryOn';

async function getStorefrontToken(productId: string) {
  const response = await fetch('/api/drapixai/storefront-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId }),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.token !== 'string') {
    throw new Error(payload.error || 'TOKEN_UNAVAILABLE');
  }
  return payload.token;
}

export default function ProductPage() {
  return (
    <DrapixAITryOn
      tokenProvider={getStorefrontToken}
      productId="PRODUCT_ID"
      garmentType="upper"
      quality="standard"
      buttonText="Try It On"
      modalTitle="Try On"
      modalSubtitle="Upload your photo to see the fit."
      footerText="Your photo is processed transiently and is never used to train AI models."
      timeoutMs={20000}
      primaryGradient="linear-gradient(90deg,#22d3ee,#3b82f6)"
      logoUrl="https://cdn.yourbrand.com/logo-mark.svg"
      onResult={(metadata) => {
        console.log(metadata.qualityScore, metadata.latencyMs);
      }}
      onError={(error) => {
        console.warn(error.message);
      }}
    />
  );
}
```

Your `/api/drapixai/storefront-token` endpoint runs on the brand server. It
holds the permanent DrapixAI server key and exchanges it through
`POST /sdk/storefront-token` for a five-minute, domain-bound and product-scoped
shopper token. Return only `{ "token": "dpxsf_..." }` to the browser.

For Next.js App Router, a secure server-only route has this shape:

```ts
// app/api/drapixai/storefront-token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { findPublicProductById } from '@/lib/catalog'; // implement in the brand app

const apiBase = process.env.DRAPIXAI_API_BASE_URL!;
const serverKey = process.env.DRAPIXAI_SERVER_KEY!; // never NEXT_PUBLIC_*
const storefrontOrigin = new URL(process.env.STOREFRONT_ORIGIN!).origin;

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== storefrontOrigin) {
    return NextResponse.json({ error: 'ORIGIN_FORBIDDEN' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
  if (!productId) return NextResponse.json({ error: 'PRODUCT_REQUIRED' }, { status: 400 });

  // Reject drafts, unknown products, and IDs that are not valid for the
  // current public product page before minting a token.
  const product = await findPublicProductById(productId);
  if (!product) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 });

  const upstream = await fetch(`${apiBase}/sdk/storefront-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serverKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: 'web', productIds: [productId] }),
    cache: 'no-store',
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || typeof payload.token !== 'string') {
    return NextResponse.json({ error: 'TOKEN_UNAVAILABLE' }, { status: upstream.status || 502 });
  }
  return NextResponse.json(
    { token: payload.token },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
```

Do not pass an arbitrary client-supplied product ID through a token route. Check
that it belongs to the currently public product in the brand catalog before the
server calls DrapixAI.

## Props

- `tokenProvider` (required): async function that returns a fresh short-lived storefront token for the requested product.
- `productId` (required): confirmed DrapixAI product mapping.
- `containerId` (optional).
- `baseUrl` (optional): HTTPS API endpoint; localhost is allowed only for local development.
- `garmentType` (optional, `upper`): the only public launch garment type.
- `quality` (optional, `standard`): the only production try-on mode.
- `buttonText`, `modalTitle`, `modalSubtitle`, `footerText`, `timeoutMs`, `enableDownload`, `primaryGradient`, `logoUrl`, `onResult`, `onError` (optional).

The component deliberately does not accept a permanent API key. The browser SDK
also rejects modern `dpx_` server keys, legacy 32-character keys, and public API
tokens if they are passed by mistake.

## Production Flow

1. Upload and preprocess merchant garment images through `/sdk/garments`.
2. Synchronize catalog products through `/sdk/catalog/sync`.
3. Confirm the garment-to-product mapping through `/sdk/matches/:garmentId/confirm`.
4. DrapixAI generates the approved onboarding cache at `v3-1024x1365`.
5. Implement the server-side token endpoint and install the component with the confirmed `productId`.
6. Monitor `metadata.latencyMs`, `metadata.qualityScore`, and `metadata.warnings` from `onResult`.

The shopper SDK sends only the person photo plus confirmed `productId`. The API
resolves the approved cached garment asset, preserving quality and avoiding
shopper-time garment preprocessing.

## Returned Metadata

The binary `/sdk/tryon` response includes its PNG body plus quality, latency,
warning, cache, engine, and timing headers. The component maps those values into
`onResult` for storefront analytics and review routing.
