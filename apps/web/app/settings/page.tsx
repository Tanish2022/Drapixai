'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  KeyRound,
  LogOut,
  Mail,
  MoonStar,
  Phone,
  Settings2,
  Shield,
  Store,
  SunMedium,
  UserCircle2,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

type UsageData = {
  email?: string | null;
  companyName?: string | null;
  planName: string;
  selectedPlanName?: string | null;
  subscriptionStatus?: string | null;
  quotaRemaining: number;
  domain?: string;
  storeConnected?: boolean;
  storeVerified?: boolean;
  storeVerifiedAt?: string | null;
  catalogSyncSource?: string | null;
  catalogFeedUrl?: string | null;
  catalogLastSyncedAt?: string | null;
  catalogLastSyncStatus?: string | null;
};

type AccountProfile = {
  email: string;
  emailVerifiedAt?: string | null;
  companyName?: string | null;
  mobileNumber?: string | null;
  themePreference?: 'dark' | 'light';
  domain?: string | null;
  storeConnected?: boolean;
  storeVerified?: boolean;
  storeVerificationToken?: string | null;
  storeVerificationMetaTag?: string | null;
  storeVerifiedAt?: string | null;
  catalogSyncSource?: string | null;
  catalogFeedUrl?: string | null;
  catalogLastSyncedAt?: string | null;
  catalogLastSyncStatus?: string | null;
};

const THEME_STORAGE_KEY = 'drapixai-theme';

const applyTheme = (theme: 'dark' | 'light') => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export default function SettingsPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [toast, setToast] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [themePreference, setThemePreference] = useState<'dark' | 'light'>('dark');
  const [storeDomain, setStoreDomain] = useState('');
  const [storeSyncSource, setStoreSyncSource] = useState<'manual' | 'feed_url' | 'shopify' | 'woocommerce'>('manual');
  const [storeFeedUrl, setStoreFeedUrl] = useState('');
  const [verificationMetaTag, setVerificationMetaTag] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [currentEmailOtp, setCurrentEmailOtp] = useState('');
  const [newEmailOtp, setNewEmailOtp] = useState('');
  const [emailOtpRequested, setEmailOtpRequested] = useState(false);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const sessionResponse = await fetch('/api/dashboard/session', { cache: 'no-store' });
        if (!sessionResponse.ok) {
          router.replace('/auth/login?next=/settings');
          return;
        }

        const sessionPayload = (await sessionResponse.json().catch(() => null)) as { apiKey?: string } | null;
        const nextApiKey = sessionPayload?.apiKey?.trim() || '';
        if (!nextApiKey) {
          router.replace('/auth/login?next=/settings');
          return;
        }

        if (!active) return;
        setApiKey(nextApiKey);

        const [summaryResponse, profileResponse] = await Promise.all([
          fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, {
            headers: { Authorization: `Bearer ${nextApiKey}` },
          }),
          fetch(`${PUBLIC_API_BASE_URL}/account/profile`, {
            headers: { Authorization: `Bearer ${nextApiKey}` },
          }),
        ]);

        if (!summaryResponse.ok || !profileResponse.ok) {
          throw new Error('ACCOUNT_BOOTSTRAP_FAILED');
        }

        const summaryPayload = (await summaryResponse.json().catch(() => null)) as UsageData | null;
        const profilePayload = (await profileResponse.json().catch(() => null)) as AccountProfile | null;
        if (!active) return;

        setUsage(summaryPayload);
        setProfile(profilePayload);
        setCompanyName(profilePayload?.companyName || summaryPayload?.companyName || '');
        setMobileNumber(profilePayload?.mobileNumber || '');
        setThemePreference(profilePayload?.themePreference || 'dark');
        setStoreDomain(profilePayload?.domain || summaryPayload?.domain || '');
        setStoreSyncSource((profilePayload?.catalogSyncSource as 'manual' | 'feed_url' | 'shopify' | 'woocommerce') || 'manual');
        setStoreFeedUrl(profilePayload?.catalogFeedUrl || '');
        setVerificationMetaTag(profilePayload?.storeVerificationMetaTag || '');
        applyTheme((profilePayload?.themePreference || 'dark') as 'dark' | 'light');
      } catch {
        if (active) {
          router.replace('/auth/login?next=/settings');
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-[28px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,249,255,0.96)_100%)] p-6 shadow-[0_28px_90px_rgba(71,85,105,0.12)] backdrop-blur'
        : 'rounded-3xl border border-white/[0.08] bg-[#0b1120]/75 p-6',
    [themePreference]
  );

  const panelClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-2xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]'
        : 'rounded-2xl border border-white/[0.08] bg-black/20 p-4',
    [themePreference]
  );

  const mutedTextClass = themePreference === 'light' ? 'text-slate-600' : 'text-gray-400';
  const sectionTitleClass = themePreference === 'light' ? 'text-slate-950' : 'text-white';
  const strongTextClass = themePreference === 'light' ? 'text-slate-900' : 'text-gray-100';
  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#edf4ff] text-slate-950' : 'min-h-screen bg-[#050816] text-white';

  const handleLogout = () => {
    fetch('/api/dashboard/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        localStorage.removeItem('apiKey');
        signOut({ redirect: false }).catch(() => undefined).finally(() => {
          router.push('/');
        });
      });
  };

  const handleSaveProfile = async () => {
    if (!apiKey) return;
    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/profile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companyName,
        mobileNumber,
        themePreference,
      }),
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as Partial<AccountProfile> | null;
    if (!response?.ok) {
      setToast('Unable to save profile settings right now.');
      return;
    }

    applyTheme(themePreference);
    setProfile((current) => ({
      ...(current || ({} as AccountProfile)),
      companyName: payload?.companyName ?? companyName,
      mobileNumber: payload?.mobileNumber ?? mobileNumber,
      themePreference,
    }));
    setUsage((current) => (current ? { ...current, companyName } : current));
    setToast('Profile settings updated.');
  };

  const handlePasswordChange = async () => {
    if (!apiKey) return;
    if (!currentPassword || !newPassword || !confirmPassword) {
      setToast('Fill the current password and both new password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setToast('New password confirmation does not match.');
      return;
    }

    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as {
      error?: string;
      debugCurrentEmailOtp?: string;
      debugNewEmailOtp?: string;
    } | null;
    if (!response?.ok) {
      setToast(payload?.error || 'Unable to change password.');
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setToast('Password updated successfully.');
  };

  const handleRotateApiKey = async () => {
    if (!apiKey) return;
    const response = await fetch(`${PUBLIC_API_BASE_URL}/analytics/api-key/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as { apiKey?: string } | null;
    const nextApiKey = payload?.apiKey?.trim() || '';
    if (!response?.ok || !nextApiKey) {
      setToast('Unable to rotate the API key right now.');
      return;
    }

    setApiKey(nextApiKey);
    localStorage.setItem('apiKey', nextApiKey);
    await fetch('/api/dashboard/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: nextApiKey }),
    }).catch(() => undefined);
    setToast('API key rotated successfully.');
  };

  const handleSaveStoreConnection = async () => {
    if (!apiKey) return;
    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/store`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domain: storeDomain,
        syncSource: storeSyncSource,
        feedUrl: storeFeedUrl,
      }),
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as {
      error?: string;
      domain?: string;
      storeVerificationMetaTag?: string;
      storeVerified?: boolean;
      storeVerifiedAt?: string | null;
      catalogSyncSource?: string | null;
      catalogFeedUrl?: string | null;
    } | null;
    if (!response?.ok) {
      setToast(payload?.error || 'Unable to save store settings.');
      return;
    }

    setStoreDomain(payload?.domain || storeDomain);
    setStoreFeedUrl(payload?.catalogFeedUrl || storeFeedUrl);
    setStoreSyncSource((payload?.catalogSyncSource as 'manual' | 'feed_url' | 'shopify' | 'woocommerce') || storeSyncSource);
    setVerificationMetaTag(payload?.storeVerificationMetaTag || verificationMetaTag);
    setProfile((current) =>
      current
        ? {
            ...current,
            domain: payload?.domain || current.domain,
            storeVerified: payload?.storeVerified ?? current.storeVerified,
            storeVerifiedAt: payload?.storeVerifiedAt ?? current.storeVerifiedAt,
            catalogSyncSource: payload?.catalogSyncSource || current.catalogSyncSource,
            catalogFeedUrl: payload?.catalogFeedUrl || current.catalogFeedUrl,
            storeVerificationMetaTag: payload?.storeVerificationMetaTag || current.storeVerificationMetaTag,
          }
        : current
    );
    setUsage((current) =>
      current
        ? {
            ...current,
            domain: payload?.domain || current.domain,
            storeConnected: Boolean((payload?.domain || current.domain) && (payload?.storeVerified ?? current.storeVerified)),
            storeVerified: payload?.storeVerified ?? current.storeVerified,
            storeVerifiedAt: payload?.storeVerifiedAt ?? current.storeVerifiedAt,
            catalogSyncSource: payload?.catalogSyncSource || current.catalogSyncSource,
            catalogFeedUrl: payload?.catalogFeedUrl || current.catalogFeedUrl,
          }
        : current
    );
    setToast('Store settings saved. Add the verification meta tag to your storefront next.');
  };

  const handleVerifyStore = async () => {
    if (!apiKey) return;
    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/store/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as {
      error?: string;
      message?: string;
      storeVerified?: boolean;
      storeVerifiedAt?: string | null;
    } | null;
    if (!response?.ok) {
      setToast(payload?.message || payload?.error || 'Store verification failed.');
      return;
    }

    setProfile((current) =>
      current ? { ...current, storeVerified: true, storeVerifiedAt: payload?.storeVerifiedAt || new Date().toISOString() } : current
    );
    setUsage((current) =>
      current
        ? {
            ...current,
            storeConnected: true,
            storeVerified: true,
            storeVerifiedAt: payload?.storeVerifiedAt || new Date().toISOString(),
          }
        : current
    );
    setToast('Store verified successfully.');
  };

  const handleResyncCatalog = async () => {
    if (!apiKey) return;
    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/store/resync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as {
      error?: string;
      message?: string;
      syncedCount?: number;
      skippedCount?: number;
    } | null;
    if (!response?.ok) {
      setToast(payload?.message || payload?.error || 'Catalog re-sync failed.');
      return;
    }

    const nowIso = new Date().toISOString();
    setProfile((current) =>
      current
        ? {
            ...current,
            catalogLastSyncedAt: nowIso,
            catalogLastSyncStatus: `SYNCED_${payload?.syncedCount || 0}_SKIPPED_${payload?.skippedCount || 0}`,
          }
        : current
    );
    setUsage((current) =>
      current
        ? {
            ...current,
            catalogLastSyncedAt: nowIso,
            catalogLastSyncStatus: `SYNCED_${payload?.syncedCount || 0}_SKIPPED_${payload?.skippedCount || 0}`,
          }
        : current
    );
    setToast(`Catalog sync complete. ${payload?.syncedCount || 0} upper-body products refreshed.`);
  };

  const handleRequestEmailChange = async () => {
    if (!apiKey || !newEmail.trim()) {
      setToast('Enter the new email address first.');
      return;
    }

    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/email/request-change`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newEmail }),
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as {
      error?: string;
      debugCurrentEmailOtp?: string;
      debugNewEmailOtp?: string;
    } | null;
    if (!response?.ok) {
      setToast(payload?.error || 'Unable to send verification codes.');
      return;
    }

    setEmailOtpRequested(true);
    setToast(
      payload?.debugCurrentEmailOtp && payload?.debugNewEmailOtp
        ? `Local dev OTPs: current ${payload.debugCurrentEmailOtp}, new ${payload.debugNewEmailOtp}`
        : 'We sent OTPs to both the current and new email addresses.'
    );
  };

  const handleVerifyEmailChange = async () => {
    if (!apiKey) return;

    const response = await fetch(`${PUBLIC_API_BASE_URL}/account/email/verify-change`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newEmail,
        currentEmailOtp,
        newEmailOtp,
      }),
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as { error?: string; email?: string } | null;
    if (!response?.ok) {
      setToast(payload?.error || 'Unable to verify the email change.');
      return;
    }

    const nextEmail = payload?.email || newEmail.trim().toLowerCase();
    setProfile((current) => current ? { ...current, email: nextEmail, emailVerifiedAt: new Date().toISOString() } : current);
    setUsage((current) => current ? { ...current, email: nextEmail } : current);
    setNewEmail('');
    setCurrentEmailOtp('');
    setNewEmailOtp('');
    setEmailOtpRequested(false);
    setToast('Email address updated successfully.');
  };

  if (isBootstrapping || !profile || !usage) {
    return (
      <main className="min-h-screen bg-[#050816] text-white flex items-center justify-center px-6">
        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 max-w-lg text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Settings</p>
          <h1 className="text-3xl font-bold mb-4">Loading your account center</h1>
          <p className="text-gray-400">We&apos;re checking your current session and account data.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={pageClass}>
      {themePreference === 'light' ? (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_85%_18%,rgba(59,130,246,0.14),transparent_24%),linear-gradient(180deg,#f6fbff_0%,#edf4ff_100%)]" />
          <div className="absolute inset-0 opacity-[0.35] bg-[linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] bg-[size:42px_42px]" />
        </div>
      ) : null}
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        {toast ? (
          <div className={`${themePreference === 'light' ? 'border-cyan-300/50 bg-cyan-100 text-cyan-900' : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100'} mb-6 rounded-2xl border px-4 py-3 text-sm`}>
            {toast}
          </div>
        ) : null}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-10">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-cyan-400/80 mb-3">Account Settings</p>
            <h1 className={`text-4xl font-bold ${sectionTitleClass}`}>Keep your DrapixAI setup simple and launch-ready</h1>
            <p className={`mt-3 max-w-3xl text-sm ${mutedTextClass}`}>
              Use this page for account details and store basics. Product uploads and internal previews still belong in the dashboard, where non-technical teams can validate value before technical rollout.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex items-center justify-center rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
              Open Dashboard
            </Link>
            <Link href="/" className="inline-flex items-center justify-center rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
              Back to Home
            </Link>
          </div>
        </div>

        <div className={`${cardClass} mb-8`}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-cyan-400/80 mb-3">Fastest Setup Path</p>
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Keep the first pass lightweight</h2>
              <p className={`mt-3 text-sm ${mutedTextClass}`}>
                Non-technical founders do not need to finish verification, feeds, and SDK setup on day one. The easiest sequence is: save your store URL here, go back to the dashboard to add a few products and garment files, then return to verification only when the preview looks right.
              </p>
            </div>
            <div className={`${panelClass} space-y-3`}>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 mt-0.5 text-cyan-400" />
                <div>
                  <p className={`font-medium ${strongTextClass}`}>Step 1</p>
                  <p className={`text-sm ${mutedTextClass}`}>Save your store URL and preferred product import method.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 mt-0.5 text-cyan-400" />
                <div>
                  <p className={`font-medium ${strongTextClass}`}>Step 2</p>
                  <p className={`text-sm ${mutedTextClass}`}>Use the dashboard to upload a few product IDs and garment-only images.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 mt-0.5 text-cyan-400" />
                <div>
                  <p className={`font-medium ${strongTextClass}`}>Step 3</p>
                  <p className={`text-sm ${mutedTextClass}`}>Come back here for verification and live install only after you trust the preview quality.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 mb-8">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <UserCircle2 className="w-6 h-6 text-cyan-400" />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Identity and Contact</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={panelClass}>
                <p className={`text-sm mb-2 ${mutedTextClass}`}>Current email</p>
                <p className={`font-medium break-all ${strongTextClass}`}>{profile.email}</p>
                <p className={`text-xs mt-2 ${mutedTextClass}`}>
                  {profile.emailVerifiedAt ? 'Verified and active' : 'Legacy account verified at next secure login'}
                </p>
              </div>
              <div className={panelClass}>
                <p className={`text-sm mb-2 ${mutedTextClass}`}>Subscription status</p>
                <p className={`font-medium ${strongTextClass}`}>{usage.subscriptionStatus || 'active'}</p>
                <p className={`text-xs mt-2 ${mutedTextClass}`}>{usage.planName} plan currently active</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${mutedTextClass}`}>Brand / Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                  placeholder="Your brand name"
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-2 ${mutedTextClass}`}>Mobile Number (optional)</label>
                <div className="relative">
                  <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${themePreference === 'light' ? 'text-slate-400' : 'text-gray-500'}`} />
                  <input
                    type="tel"
                    value={mobileNumber}
                    onChange={(event) => setMobileNumber(event.target.value)}
                    className={`w-full rounded-xl border pl-11 pr-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveProfile}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              <CheckCircle2 className="w-4 h-4" />
              Save Profile Details
            </button>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Settings2 className="w-6 h-6 text-cyan-400" />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Appearance</h2>
            </div>
            <p className={`text-sm mb-5 ${mutedTextClass}`}>
              Choose the account theme you want to use while managing DrapixAI. The preference is saved to your account and this browser.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setThemePreference('dark');
                  applyTheme('dark');
                }}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                  themePreference === 'dark'
                    ? 'border-cyan-400/40 bg-cyan-400/10'
                    : 'border-white/[0.08] bg-black/20'
                }`}
              >
                <MoonStar className="w-5 h-5 text-cyan-400 mb-3" />
                <p className={`font-semibold ${sectionTitleClass}`}>Dark Mode</p>
                <p className={`text-sm mt-1 ${mutedTextClass}`}>Best fit for the current DrapixAI visual system.</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setThemePreference('light');
                  applyTheme('light');
                }}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                  themePreference === 'light'
                    ? 'border-cyan-400/40 bg-cyan-400/10'
                    : 'border-white/[0.08] bg-black/20'
                }`}
              >
                <SunMedium className="w-5 h-5 text-amber-400 mb-3" />
                <p className={`font-semibold ${sectionTitleClass}`}>Light Mode</p>
                <p className={`text-sm mt-1 ${mutedTextClass}`}>Useful for brighter workspaces and account editing.</p>
              </button>
            </div>
            <button
              type="button"
              onClick={handleSaveProfile}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
            >
              Save Theme Preference
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 mb-8">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-6 h-6 text-emerald-400" />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Change Password</h2>
            </div>
            <div className="space-y-4">
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                placeholder="Current password"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                placeholder="New password"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                placeholder="Confirm new password"
              />
            </div>
            <button
              type="button"
              onClick={handlePasswordChange}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Update Password
            </button>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Mail className="w-6 h-6 text-cyan-400" />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Change Email</h2>
            </div>
            <p className={`text-sm mb-5 ${mutedTextClass}`}>
              To protect ownership, changing the account email requires OTP verification on both the current email and the new email.
            </p>
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
              placeholder="New email address"
            />
            <div className="flex flex-wrap gap-3 mt-4">
              <button
                type="button"
                onClick={handleRequestEmailChange}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
              >
                Send OTPs
              </button>
              {emailOtpRequested ? (
                <span className={`text-xs self-center ${mutedTextClass}`}>Both email addresses should now have a 6-digit code.</span>
              ) : null}
            </div>

            {emailOtpRequested ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={currentEmailOtp}
                  onChange={(event) => setCurrentEmailOtp(event.target.value)}
                  className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                  placeholder="OTP sent to current email"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={newEmailOtp}
                  onChange={(event) => setNewEmailOtp(event.target.value)}
                  className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                  placeholder="OTP sent to new email"
                />
                <button
                  type="button"
                  onClick={handleVerifyEmailChange}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  Verify and Change Email
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Store className={`w-6 h-6 ${usage.storeConnected ? 'text-emerald-400' : 'text-amber-300'}`} />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Store basics</h2>
            </div>
            <div className={panelClass}>
              <p className={`text-sm mb-2 ${mutedTextClass}`}>Current progress</p>
              <p className={`font-medium ${strongTextClass}`}>
                {profile.storeVerified ? 'Verified and connected' : profile.domain && profile.domain !== '*' ? 'Domain saved, verification pending' : 'Not connected yet'}
              </p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>
                {profile.domain && profile.domain !== '*' ? profile.domain : 'No store URL has been saved yet.'}
              </p>
            </div>
            <div className={`${panelClass} mt-4 space-y-4`}>
              <div>
                <label className={`block text-sm font-medium mb-2 ${mutedTextClass}`}>Store URL or domain</label>
                <input
                  type="text"
                  value={storeDomain}
                  onChange={(event) => setStoreDomain(event.target.value)}
                  className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                  placeholder="store.yourbrand.com"
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-2 ${mutedTextClass}`}>How do you want to add products first?</label>
                <select
                  value={storeSyncSource}
                  onChange={(event) => setStoreSyncSource(event.target.value as 'manual' | 'feed_url' | 'shopify' | 'woocommerce')}
                  className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                >
                  <option value="manual">I will add a few products in the dashboard</option>
                  <option value="feed_url">I already have a product feed URL</option>
                  <option value="shopify">I want Shopify later</option>
                  <option value="woocommerce">I want WooCommerce later</option>
                </select>
              </div>
              {storeSyncSource === 'feed_url' ? (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${mutedTextClass}`}>Product feed URL</label>
                  <input
                    type="url"
                    value={storeFeedUrl}
                    onChange={(event) => setStoreFeedUrl(event.target.value)}
                    className={`w-full rounded-xl border px-4 py-3 ${themePreference === 'light' ? 'border-slate-300 bg-white text-slate-950' : 'border-white/[0.08] bg-black/20 text-white'}`}
                    placeholder="https://yourbrand.com/products-feed.csv"
                  />
                </div>
              ) : (
                <p className={`text-sm ${mutedTextClass}`}>
                  For most teams, the easiest start is manual dashboard import. Feed URL import also works now. Native Shopify and WooCommerce apps are future-friendly options, but they are not required for your first preview.
                </p>
              )}
              <div className={`${themePreference === 'light' ? 'border-sky-100 bg-sky-50/70' : 'border-cyan-400/20 bg-cyan-400/10'} rounded-2xl border p-4`}>
                <p className={`text-sm font-medium mb-2 ${strongTextClass}`}>Recommended order</p>
                <ol className={`space-y-2 text-sm list-decimal pl-5 ${mutedTextClass}`}>
                  <li>Save the storefront domain and choose the easiest product import path.</li>
                  <li>Go back to the dashboard and test a few product IDs plus clean garment images.</li>
                  <li>Only after the preview looks right, return here to verify the domain and complete live setup.</li>
                </ol>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSaveStoreConnection}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  Save Basics
                </button>
                <button
                  type="button"
                  onClick={handleVerifyStore}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
                >
                  Verify Store
                </button>
                {storeSyncSource === 'feed_url' ? (
                  <button
                    type="button"
                    onClick={handleResyncCatalog}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
                  >
                    Refresh Product List
                  </button>
                ) : null}
              </div>
            </div>
            <div className={`${panelClass} mt-4`}>
              <p className={`text-sm mb-2 ${mutedTextClass}`}>Verification meta tag</p>
              <p className={`text-sm mb-3 ${mutedTextClass}`}>
                Add this to your storefront homepage only when you are ready to prove you control the live domain. It is not required to start testing garments in the dashboard.
              </p>
              <p className={`font-mono text-xs break-all ${strongTextClass}`}>{verificationMetaTag || 'Save store settings to generate the verification tag.'}</p>
              <div className="flex flex-wrap gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(verificationMetaTag).then(() => setToast('Verification meta tag copied.'))}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
                  disabled={!verificationMetaTag}
                >
                  <Copy className="w-4 h-4" />
                  Copy Meta Tag
                </button>
                {profile.storeVerifiedAt ? (
                  <span className={`text-xs self-center ${mutedTextClass}`}>
                    Verified on {new Date(profile.storeVerifiedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
            </div>
            <div className={`${panelClass} mt-4`}>
              <p className={`text-sm mb-2 ${mutedTextClass}`}>Catalog sync status</p>
              <p className={`font-medium ${strongTextClass}`}>{profile.catalogLastSyncStatus || 'No catalog sync has run yet.'}</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>
                {profile.catalogLastSyncedAt ? `Last synced on ${new Date(profile.catalogLastSyncedAt).toLocaleString()}` : 'If you use a feed, one click will refresh only upper-body products. If you start manually, do that work in the dashboard.'}
              </p>
            </div>
            <div className={`${panelClass} mt-4`}>
              <p className={`text-sm mb-2 ${mutedTextClass}`}>Technical install key</p>
              <p className={`font-mono text-sm break-all ${strongTextClass}`}>{apiKey}</p>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(apiKey).then(() => setToast('API key copied.'))}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy Key
              </button>
              <button
                type="button"
                onClick={handleRotateApiKey}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                Rotate Key
              </button>
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                <Store className="w-4 h-4" />
                Back to Dashboard
              </Link>
              <Link href="/docs" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                Full Guide
              </Link>
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <CreditCard className="w-6 h-6 text-blue-400" />
              <h2 className={`text-2xl font-semibold ${sectionTitleClass}`}>Commercial Access</h2>
            </div>
            <div className={`${panelClass} space-y-2`}>
              <p className={`text-sm ${mutedTextClass}`}>Current plan</p>
              <p className={`text-lg font-semibold ${strongTextClass}`}>{usage.planName}</p>
              {usage.selectedPlanName ? (
                <p className={`text-sm ${mutedTextClass}`}>Selected plan after trial: {usage.selectedPlanName}</p>
              ) : null}
              <p className={`text-sm ${mutedTextClass}`}>Quota remaining this period: {usage.quotaRemaining}</p>
            </div>
            <div className={`${panelClass} mt-4 space-y-2`}>
              <p className={`text-sm ${mutedTextClass}`}>Launch-safe commercial posture</p>
              <p className={`text-sm ${strongTextClass}`}>Use the trial or current plan to validate real products first, then move into higher volume only after your onboarding flow is stable.</p>
              <p className={`text-sm ${mutedTextClass}`}>If you need guided rollout help, billing clarification, or custom volume, use pricing or contact sales before switching public traffic on.</p>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/subscription" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                Open Subscription
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                Upgrade Plan
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 px-4 py-2 text-sm text-rose-100 hover:bg-rose-400/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
