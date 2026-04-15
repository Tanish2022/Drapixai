'use client';

import { useEffect, useState } from 'react';

export type DrapixThemePreference = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'drapixai-theme';

export const readThemePreference = (): DrapixThemePreference => {
  if (typeof document !== 'undefined') {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  return 'dark';
};

export const applyThemePreference = (theme: DrapixThemePreference) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
};

export const useThemePreference = () => {
  const [themePreference, setThemePreference] = useState<DrapixThemePreference>('dark');

  useEffect(() => {
    const syncTheme = () => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      const nextTheme = stored === 'light' ? 'light' : readThemePreference();
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
