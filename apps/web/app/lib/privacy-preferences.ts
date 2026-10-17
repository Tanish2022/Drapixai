// This preference contains no visitor/account identifier. It controls optional
// website analytics, independently of necessary authentication and try-on consent.
export const PRIVACY_STORAGE_KEY = 'drapixaiPrivacyPreferences';
export const PRIVACY_CHANGE_EVENT = 'drapixai:privacy-preferences';
export const VISITOR_STORAGE_KEY = 'drapixaiVisitorId';
export const PRIVACY_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
let storageWriteFailed = false;

export type PrivacyPreferences = {
  version: 1;
  analytics: boolean;
  updatedAt: number;
  expiresAt: number;
};

export const readPrivacyPreferences = (): PrivacyPreferences | null => {
  if (typeof window === 'undefined' || storageWriteFailed) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(PRIVACY_STORAGE_KEY) || 'null');
    const now = Date.now();
    if (!value || value.version !== 1 || typeof value.analytics !== 'boolean'
      || !Number.isFinite(value.updatedAt) || !Number.isFinite(value.expiresAt)
      || value.updatedAt > now || value.expiresAt <= now
      || value.expiresAt - value.updatedAt !== PRIVACY_MAX_AGE_MS) return null;
    return { version: 1, analytics: value.analytics, updatedAt: value.updatedAt, expiresAt: value.expiresAt };
  } catch {
    // Restricted storage must never break the website or enable tracking.
    return null;
  }
};

export const clearAnalyticsIdentifier = () => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(VISITOR_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
};

export const hasAnalyticsConsent = () => readPrivacyPreferences()?.analytics === true;

export const savePrivacyPreferences = (analytics: boolean): boolean => {
  if (typeof window === 'undefined') return false;
  const updatedAt = Date.now();
  try {
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify({
      version: 1, analytics, updatedAt, expiresAt: updatedAt + PRIVACY_MAX_AGE_MS,
    } satisfies PrivacyPreferences));
    storageWriteFailed = false;
    if (!analytics) clearAnalyticsIdentifier();
    window.dispatchEvent(new Event(PRIVACY_CHANGE_EVENT));
    return true;
  } catch {
    // Even if a previously accepted choice remains in read-only storage, a
    // failed withdrawal must stop this page from sending any further events.
    storageWriteFailed = true;
    clearAnalyticsIdentifier();
    window.dispatchEvent(new Event(PRIVACY_CHANGE_EVENT));
    return false;
  }
};
