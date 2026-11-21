import { detectImageMimeType } from './security';
import { shouldAutoRejectTryOn, type TryOnQualityInput } from './tryon-quality';

export async function acceptPublicDemoOutput(
  quality: TryOnQualityInput, output: Response, settle: (receipt: string) => Promise<Response>,
) {
  if (shouldAutoRejectTryOn(quality)) return { state: 'rejected' } as const;
  const receipt = output.headers.get('x-drapixai-demo-receipt') || '';
  const bytes = Buffer.from(await output.arrayBuffer());
  const mime = detectImageMimeType(bytes);
  if (!mime || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt)) {
    return { state: 'unavailable' } as const;
  }
  // Reuse the same receipt to resolve a lost acknowledgement without charging twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await settle(receipt).catch(() => null);
    if (response?.status === 204) return { state: 'accepted', bytes, mime } as const;
    if (response?.status === 429) return { state: 'limited' } as const;
    if (response && response.status < 500) break;
  }
  return { state: 'unavailable' } as const;
}
