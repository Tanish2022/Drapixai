export type SetupGarment = {
  garmentId: string;
  displayName?: string | null;
  productName?: string | null;
  status: string;
  cacheKey?: string | null;
  garmentType?: string | null;
  confirmedProductId?: string | null;
  confirmedProductName?: string | null;
};

export type SetupSummary = {
  companyName?: string | null;
  quotaRemaining: number;
  storeVerified?: boolean;
  approvedTryOnResultCount?: number;
  warningFreeTryOnCount?: number;
  recentRenders?: { status: string; productId?: string | null }[];
};

// Resume from server evidence, never a browser-stored "completed" flag.
export function getMerchantSetup(summary: SetupSummary, garments: SetupGarment[]) {
  const ready = garments.filter((garment) =>
    (garment.garmentType || 'upper') === 'upper' && garment.status === 'ready' &&
    Boolean(garment.cacheKey && garment.confirmedProductId));
  const previewed = ready.some((garment) => summary.recentRenders?.some((render) =>
    render.status === 'complete' && render.productId === garment.confirmedProductId));
  const reviewed = (summary.approvedTryOnResultCount || 0) > 0 &&
    (summary.warningFreeTryOnCount || 0) > 0;
  return {
    ready,
    previewed,
    reviewed,
    stage: ready.length === 0 ? 0 : !previewed ? 1 : 2,
    // This is setup eligibility only. It is not evidence that a widget is installed
    // or that the company's public-launch gates have passed.
    canInstall: ready.length > 0 && previewed && reviewed && Boolean(summary.storeVerified) && summary.quotaRemaining > 0,
  };
}

export function setupErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    GARMENT_NOT_APPROVED: 'This image is still being prepared or needs review. Check its status before confirming.',
    GARMENT_CACHE_MISS: 'This product image needs to be prepared again. Open product management for help.',
    GARMENT_PRODUCT_TYPE_MISMATCH: 'Choose an upper-body product for this garment.',
    AI_SERVICE_UNAVAILABLE: 'Image preparation is temporarily unavailable. Your saved product is safe; try again later.',
    TRYON_INTAKE_PAUSED: 'Product preparation is temporarily paused. Please try again later.',
    UNSUPPORTED_GARMENT_CATEGORY: 'Start with a shirt, T-shirt, polo, blouse or top.',
    INVALID_IMAGE_CONTENT: 'Choose a valid JPG, PNG or WebP garment photo.',
    CLOTH_IMAGE_REQUIRED: 'Choose a garment photo before continuing.',
    AI_SERVICE_ERROR: 'Photo preparation could not finish. Please try again later or ask for setup help.',
    TRYON_TEMPORARILY_UNAVAILABLE: 'Product preparation is temporarily paused. Your saved product is safe; please try again later.',
    LOW_RESOLUTION: 'Choose a higher-resolution garment photo, at least 512 × 512 pixels.',
    IMAGE_BLURRY: 'Choose a sharper photo so the garment details are clear.',
    SUBJECT_TOO_SMALL: 'Use a photo with one centered garment filling more of the frame.',
    NO_BACKGROUND_REMOVAL: 'Use a plain background or a transparent garment photo.',
    MODEL_WORN_GARMENT: 'Choose a photo of the garment alone, without a person or mannequin wearing it.',
    GARMENT_TOO_LONG: 'Start with a shirt or top. Long garments are outside the current launch scope.',
    GARMENT_CATEGORY_UNSUPPORTED: 'Start with a shirt, T-shirt, polo, blouse or top.',
    'Garment upload failed': 'Photo preparation could not finish. Your product details are saved; try again later or ask for setup help.',
    GARMENT_NOT_FOUND: 'This image is no longer available. Refresh your products and try again.',
    PRODUCT_NOT_FOUND: 'This product is no longer available. Refresh your products and try again.',
  };
  return messages[code || ''] || 'We could not complete this step. Your saved progress is kept. Try again or open Help.';
}
