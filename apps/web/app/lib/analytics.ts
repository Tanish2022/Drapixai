'use client';

import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

import { clearAnalyticsIdentifier, hasAnalyticsConsent, VISITOR_STORAGE_KEY } from './privacy-preferences';

const getVisitorId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    return created;
  } catch { return ''; }
};

type TrackEventInput = {
  path?: string;
  metadata?: Record<string, unknown>;
};

export const trackEvent = (event: string, input: TrackEventInput = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!hasAnalyticsConsent()) {
    clearAnalyticsIdentifier();
    return;
  }
  const visitorId = getVisitorId();
  if (!visitorId) return;

  const payload = JSON.stringify({
    event,
    path: input.path || window.location.pathname,
    visitorId,
    // Referrers may contain private document names or identifiers. Do not send them.
    referrer: '',
    metadata: input.metadata || {},
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(`${PUBLIC_API_BASE_URL}/events`, blob);
    return;
  }

  fetch(`${PUBLIC_API_BASE_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
};
