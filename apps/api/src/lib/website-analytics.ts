const publicPages = new Set(['/', '/demo', '/pricing', '/help', '/docs', '/contact', '/privacy', '/terms', '/cookies', '/refund-policy', '/status', '/changelog']);
const publicTargets = new Set(['demo_run_tryon', 'demo_result_generated', 'demo_start_trial', 'demo_read_help']);
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Allowlisted public analytics only. Never persist arbitrary browser URLs,
// account identifiers, referrers, form fields or caller-provided metadata.
export function parseWebsiteAnalytics(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.analyticsConsent !== true || input.privacyPreferenceVersion !== 1
    || typeof input.path !== 'string' || !publicPages.has(input.path)
    || typeof input.visitorId !== 'string' || !visitorPattern.test(input.visitorId)
    || typeof input.event !== 'string' || !['page_view', 'cta_click'].includes(input.event)) return null;
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown> : {};
  if (input.event === 'cta_click' && (typeof metadata.target !== 'string' || !publicTargets.has(metadata.target))) return null;
  return {
    event: input.event as 'page_view' | 'cta_click', path: input.path, visitorId: input.visitorId,
    referrer: null,
    metadata: input.event === 'cta_click'
      ? { consentVersion: 1, target: metadata.target as string }
      : { consentVersion: 1 },
  };
}
