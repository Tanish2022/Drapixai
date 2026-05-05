export {};

declare global {
  interface DrapixAIInitOptions {
    apiKey: string;
    productId: string;
    containerId?: string;
    baseUrl?: string;
    garmentType?: 'upper';
    quality?: 'standard' | 'enhanced';
    autoAttach?: boolean;
    productSelector?: string;
    productIdAttribute?: string;
    buttonTargetSelector?: string;
    buttonText?: string;
    modalTitle?: string;
    modalSubtitle?: string;
    footerText?: string;
    primaryGradient?: string;
    onResult?: (metadata: {
      resultId?: string;
      engine?: string;
      qualityScore?: number;
      candidateCount?: number;
      warnings?: string[];
    }) => void;
  }

  interface Window {
    DrapixAI?: {
      init: (options: DrapixAIInitOptions) => void | Promise<void>;
      lastResultMetadata?: {
        resultId?: string;
        engine?: string;
        qualityScore?: number;
        candidateCount?: number;
        warnings?: string[];
      };
    };
    DRAPIXAI_API_BASE_URL?: string;
  }
}
