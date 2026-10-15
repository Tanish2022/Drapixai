'use client';

import { useEffect } from 'react';

// Resolve the initial deep link after authenticated workspace panels exist.
export function useWorkspaceAnchor(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [ready]);
}
