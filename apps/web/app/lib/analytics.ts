'use client';

import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

import { clearAnalyticsIdentifier, hasAnalyticsConsent, VISITOR_STORAGE_KEY } from './privacy-preferences';

const publicPages = new Set(['/', '/demo', '/pricing', '/help', '/docs', '/contact', '/privacy', '/terms', '/cookies', '/refund-policy', '/status', '/changelog']);
const publicTargets = new Set(['demo_run_tryon', 'demo_result_generated', 'demo_start_trial', 'demo_read_help']);
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getVisitorId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && visitorPattern.test(existing)) return existing;
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
  const pagePath = (input.path || window.location.pathname).split(/[?#]/, 1)[0];
  if (!publicPages.has(pagePath) || !['page_view', 'cta_click'].includes(event)) return;
  const target = input.metadata?.target;
  if (event === 'cta_click' && (typeof target !== 'string' || !publicTargets.has(target))) return;
  const visitorId = getVisitorId();
  if (!visitorId) return;

  const payload = JSON.stringify({
    event,
    path: pagePath,
    visitorId,
    analyticsConsent: true,
    privacyPreferenceVersion: 1,
    // Referrers may contain private document names or identifiers. Do not send them.
    referrer: '',
    metadata: event === 'cta_click' ? { target } : {},
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
