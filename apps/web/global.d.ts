export {};

declare global {
  interface DrapixAIInitOptions {
    storefrontToken?: string;
    tokenProvider?: (productId: string) => Promise<string>;
    appId?: string;
    productId: string;
    containerId?: string;
    baseUrl?: string;
    garmentType?: 'upper' | 'lower';
    garmentCategory?: 'jeans' | 'pants' | 'trousers' | 'shorts' | 'skirt' | 'leggings' | 'joggers';
    enableLowerBody?: boolean;
    quality?: 'standard';
    autoAttach?: boolean;
    productSelector?: string;
    productIdAttribute?: string;
    buttonTargetSelector?: string;
    buttonText?: string;
    modalTitle?: string;
    modalSubtitle?: string;
    footerText?: string;
    timeoutMs?: number;
    enableDownload?: boolean;
    primaryGradient?: string;
    logoUrl?: string;
    onResult?: (metadata: {
      resultId?: string;
      engine?: string;
      qualityScore?: number;
      candidateCount?: number;
      processingMs?: number;
      latencyMs?: number;
      latencyTargetMs?: number;
      qualityMode?: string;
      qualityProfile?: string;
      garmentSource?: string;
      timings?: Record<string, unknown>;
      qualityMetrics?: Record<string, unknown>;
      warnings?: string[];
    }) => void;
    onError?: (error: { message: string; productId?: string }) => void;
  }

  interface Window {
    DrapixAI?: {
      init: (options: DrapixAIInitOptions) => void | Promise<void>;
      lastResultMetadata?: {
        resultId?: string;
        engine?: string;
        qualityScore?: number;
        candidateCount?: number;
        processingMs?: number;
        latencyMs?: number;
        latencyTargetMs?: number;
        qualityMode?: string;
        qualityProfile?: string;
        garmentSource?: string;
        timings?: Record<string, unknown>;
        qualityMetrics?: Record<string, unknown>;
        warnings?: string[];
      };
    };
    DRAPIXAI_API_BASE_URL?: string;
  }
}
