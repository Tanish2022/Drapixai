'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackEvent } from '@/app/lib/analytics';

export default function SiteAnalytics() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTrackedPath.current === pathname) {
      return;
    }

    lastTrackedPath.current = pathname;
    trackEvent('page_view', {
      path: pathname,
      metadata: {
        title: document.title,
      },
    });
  }, [pathname]);

  return null;
}
