export {};

declare global {
  interface DrapixAIInitOptions {
    apiKey: string;
    productId: string;
    containerId?: string;
    baseUrl?: string;
    garmentType?: 'upper';
    buttonText?: string;
    modalTitle?: string;
    modalSubtitle?: string;
    footerText?: string;
    primaryGradient?: string;
  }

  interface Window {
    DrapixAI?: {
      init: (options: DrapixAIInitOptions) => void | Promise<void>;
    };
    DRAPIXAI_API_BASE_URL?: string;
  }
}
