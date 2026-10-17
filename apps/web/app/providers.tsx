'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import SiteAnalytics from './components/SiteAnalytics';
import PrivacyPreferences from './components/PrivacyPreferences';

const THEME_STORAGE_KEY = 'drapixai-theme';

function ThemeSync() {
  useEffect(() => {
    const applyTheme = (theme: string) => {
      document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    };

    let storedTheme = 'dark';
    try { storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark'; } catch { /* Optional preference storage may be blocked. */ }
    applyTheme(storedTheme);
  }, []);

  return null;
}

function SessionSync() {
  const { status } = useSession();
  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/dashboard/oauth-session', { method: 'POST' }).catch(() => undefined);
    }
  }, [status]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeSync />
      <SiteAnalytics />
      <PrivacyPreferences />
      <SessionSync />
      {children}
    </SessionProvider>
  );
}
