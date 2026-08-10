'use client';

import { useEffect } from 'react';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';

type DrapixAITryOnProps = {
  tokenProvider: (productId: string) => Promise<string>;
  appId?: string;
  productId: string;
  containerId?: string;
  baseUrl?: string;
  garmentType?: 'upper' | 'lower';
  garmentCategory?: 'jeans' | 'pants' | 'trousers' | 'shorts' | 'skirt' | 'leggings' | 'joggers';
  enableLowerBody?: boolean;
  quality?: 'standard';
  buttonText?: string;
  modalTitle?: string;
  modalSubtitle?: string;
  footerText?: string;
  timeoutMs?: number;
  enableDownload?: boolean;
  primaryGradient?: string;
  logoUrl?: string;
  onResult?: DrapixAIInitOptions['onResult'];
  onError?: DrapixAIInitOptions['onError'];
};

export default function DrapixAITryOn(props: DrapixAITryOnProps) {
  const {
    tokenProvider,
    appId,
    productId,
    containerId = 'drapixai-container',
    baseUrl = PUBLIC_API_BASE_URL,
    garmentType = 'upper',
    garmentCategory,
    enableLowerBody,
    quality = 'standard',
    buttonText,
    modalTitle,
    modalSubtitle,
    footerText,
    timeoutMs,
    enableDownload,
    primaryGradient,
    logoUrl,
    onResult,
    onError,
  } = props;

  useEffect(() => {
    const scriptId = 'drapixai-sdk';
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const loadAndInit = () => {
      if (window.DrapixAI) {
        window.DrapixAI.init({
          tokenProvider,
          appId,
          productId,
          containerId,
          baseUrl,
          garmentType,
          garmentCategory,
          enableLowerBody,
          quality,
          buttonText,
          modalTitle,
          modalSubtitle,
          footerText,
          timeoutMs,
          enableDownload,
          primaryGradient,
          logoUrl,
          onResult,
          onError,
        });
      }
    };

    if (existing) {
      loadAndInit();
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = getSdkScriptUrl();
    script.async = true;
    script.onload = loadAndInit;
    document.body.appendChild(script);

    return () => {
      // leave SDK loaded for other instances
    };
  }, [
    tokenProvider,
    appId,
    productId,
    containerId,
    baseUrl,
    garmentType,
    garmentCategory,
    enableLowerBody,
    quality,
    buttonText,
    modalTitle,
    modalSubtitle,
    footerText,
    timeoutMs,
    enableDownload,
    primaryGradient,
    logoUrl,
    onResult,
    onError,
  ]);

  return <div id={containerId}></div>;
}
