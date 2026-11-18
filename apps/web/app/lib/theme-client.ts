'use client';

import { useEffect, useState } from 'react';

export type DrapixThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'drapixai-theme';

export const readThemePreference = (): DrapixThemePreference => {
  if (typeof document !== 'undefined') {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  return 'light';
};

export const applyThemePreference = (theme: DrapixThemePreference) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* In-memory theme still works when optional storage is blocked. */ }
  }
};

export const useThemePreference = () => {
  const [themePreference, setThemePreference] = useState<DrapixThemePreference>('light');

  useEffect(() => {
    const syncTheme = () => {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(THEME_STORAGE_KEY); } catch { /* Use the current page theme. */ }
      const nextTheme = stored === 'dark' || stored === 'light' ? stored : readThemePreference();
      setThemePreference(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    };

    syncTheme();
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  return themePreference;
};
