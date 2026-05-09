'use client';

import { useEffect } from 'react';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';

type DrapixAITryOnProps = {
  apiKey: string;
  productId: string;
  containerId?: string;
  baseUrl?: string;
  garmentType?: 'upper';
  quality?: 'standard';
  buttonText?: string;
  modalTitle?: string;
  modalSubtitle?: string;
  footerText?: string;
  timeoutMs?: number;
  primaryGradient?: string;
  onResult?: DrapixAIInitOptions['onResult'];
  onError?: DrapixAIInitOptions['onError'];
};

export default function DrapixAITryOn(props: DrapixAITryOnProps) {
  const {
    apiKey,
    productId,
    containerId = 'drapixai-container',
    baseUrl = PUBLIC_API_BASE_URL,
    garmentType = 'upper',
    quality = 'standard',
    buttonText,
    modalTitle,
    modalSubtitle,
    footerText,
    timeoutMs,
    primaryGradient,
    onResult,
    onError,
  } = props;

  useEffect(() => {
    const scriptId = 'drapixai-sdk';
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const loadAndInit = () => {
      if (window.DrapixAI) {
        window.DrapixAI.init({
          apiKey,
          productId,
          containerId,
          baseUrl,
          garmentType,
          quality,
          buttonText,
          modalTitle,
          modalSubtitle,
          footerText,
          timeoutMs,
          primaryGradient,
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
    apiKey,
    productId,
    containerId,
    baseUrl,
    garmentType,
    quality,
    buttonText,
    modalTitle,
    modalSubtitle,
    footerText,
    timeoutMs,
    primaryGradient,
    onResult,
    onError,
  ]);

  return <div id={containerId}></div>;
}
