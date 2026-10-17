'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackEvent } from '@/app/lib/analytics';
import { hasAnalyticsConsent, PRIVACY_CHANGE_EVENT } from '@/app/lib/privacy-preferences';

export default function SiteAnalytics() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    const trackCurrentPage = () => {
      if (!hasAnalyticsConsent()) { lastTrackedPath.current = null; return; }
      if (!pathname || lastTrackedPath.current === pathname) return;
      lastTrackedPath.current = pathname;
      trackEvent('page_view', { path: pathname });
    };
    trackCurrentPage();
    window.addEventListener(PRIVACY_CHANGE_EVENT, trackCurrentPage);
    window.addEventListener('storage', trackCurrentPage);
    return () => {
      window.removeEventListener(PRIVACY_CHANGE_EVENT, trackCurrentPage);
      window.removeEventListener('storage', trackCurrentPage);
    };
  }, [pathname]);

  return null;
}
