export {};

declare global {
  interface DrapixAIInitOptions {
    apiKey: string;
    productId: string;
    containerId?: string;
    baseUrl?: string;
    garmentType?: 'upper';
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
    primaryGradient?: string;
    onResult?: (metadata: {
      resultId?: string;
      engine?: string;
      qualityScore?: number;
      candidateCount?: number;
      processingMs?: number;
      latencyMs?: number;
      latencyTargetMs?: number;
      timings?: Record<string, unknown>;
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
        timings?: Record<string, unknown>;
        warnings?: string[];
      };
    };
    DRAPIXAI_API_BASE_URL?: string;
  }
}
