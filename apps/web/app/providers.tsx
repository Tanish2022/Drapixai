'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import SiteAnalytics from './components/SiteAnalytics';

const THEME_STORAGE_KEY = 'drapixai-theme';

function ThemeSync() {
  useEffect(() => {
    const applyTheme = (theme: string) => {
      document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    };

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
    applyTheme(storedTheme);
  }, []);

  return null;
}

function SessionSync() {
  const { data: session } = useSession();
  useEffect(() => {
    const apiKey = (session as any)?.apiKey;
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
      fetch('/api/dashboard/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }).catch(() => undefined);
    }
  }, [session]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeSync />
      <SiteAnalytics />
      <SessionSync />
      {children}
    </SessionProvider>
  );
}
