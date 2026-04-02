'use client';

import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

const VISITOR_STORAGE_KEY = 'drapixaiVisitorId';

const getVisitorId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
  return created;
};

type TrackEventInput = {
  path?: string;
  metadata?: Record<string, unknown>;
};

export const trackEvent = (event: string, input: TrackEventInput = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify({
    event,
    path: input.path || window.location.pathname,
    visitorId: getVisitorId(),
    referrer: document.referrer || '',
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
