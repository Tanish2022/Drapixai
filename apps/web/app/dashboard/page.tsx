'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Building2, CheckCircle2, Copy, ExternalLink, KeyRound, Mail, Store, UploadCloud } from 'lucide-react';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';
import { useThemePreference } from '@/app/lib/theme-client';

interface UsageData {
  email?: string | null;
  companyName?: string | null;
  planType: string;
  planName: string;
  selectedPlan?: string | null;
  selectedPlanName?: string | null;
  subscriptionPlan?: string | null;
  subscriptionPlanName?: string | null;
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEndsAt?: string | null;
  rendersUsed: number;
  quota: number;
  quotaRemaining: number;
  trialDaysLeft: number;
  domain?: string;
  storeConnected?: boolean;
  storeVerified?: boolean;
  catalogSyncSource?: string | null;
  catalogFeedUrl?: string | null;
  catalogLastSyncedAt?: string | null;
  catalogLastSyncStatus?: string | null;
  dailyUsage?: { date: string; count: number }[];
  recentRenders?: { id: number; status: string; productId?: string | null; error?: string | null; outputUrl?: string | null; createdAt: string }[];
}

interface GarmentItem {
  garmentId: string;
  cacheKey: string;
  status: string;
  productName?: string | null;
  category?: string | null;
  garmentType?: string | null;
  sourceImageUrl?: string | null;
  updatedAt: string;
}

interface GarmentSyncRow {
  productId: string;
  productName?: string;
  category?: string;
  garmentType?: string;
}

const splitCsvLine = (line: string) =>
  line
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, ''));

const getCsvValue = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value) return value;
  }
  return '';
};

const parseCatalogCsv = (csvText: string): GarmentSyncRow[] => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});

    return {
      productId: getCsvValue(row, ['productid', 'product_id', 'sku', 'id']),
      productName: getCsvValue(row, ['productname', 'product_name', 'title', 'name']),
      category: getCsvValue(row, ['category', 'producttype', 'product_type', 'type']),
      garmentType: getCsvValue(row, ['garmenttype', 'garment_type']),
    };
  }).filter((item) => item.productId);
};

export default function Dashboard() {
  const themePreference = useThemePreference();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [garmentUploadId, setGarmentUploadId] = useState('');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentStatus, setGarmentStatus] = useState('');
  const [catalogCsvFile, setCatalogCsvFile] = useState<File | null>(null);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState('');
  const [bulkGarmentFiles, setBulkGarmentFiles] = useState<File[]>([]);
  const [bulkGarmentStatus, setBulkGarmentStatus] = useState('');
  const [missingPage, setMissingPage] = useState(0);
  const [toast, setToast] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const router = useRouter();

  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#edf4ff] text-slate-950' : 'min-h-screen bg-black text-white';
  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'p-6 rounded-[28px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,249,255,0.96)_100%)] shadow-[0_24px_80px_rgba(71,85,105,0.12)]'
        : 'p-6 border border-white/10 rounded-xl bg-white/[0.02]',
    [themePreference]
  );
  const panelClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-2xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]'
        : 'rounded-xl border border-white/10 bg-white/5 p-4',
    [themePreference]
  );
  const subtleCardClass =
    themePreference === 'light'
      ? 'p-6 rounded-[28px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,249,255,0.96)_100%)] shadow-[0_24px_80px_rgba(71,85,105,0.12)]'
      : 'p-6 border border-white/10 rounded-xl';
  const inputClass =
    themePreference === 'light'
      ? 'flex-1 p-3 bg-white border border-sky-100 rounded-lg font-mono text-sm text-slate-900'
      : 'flex-1 p-3 bg-white/5 border border-white/10 rounded-lg font-mono text-sm';
  const mutedTextClass = themePreference === 'light' ? 'text-slate-600' : 'text-gray-400';
  const strongTextClass = themePreference === 'light' ? 'text-slate-950' : 'text-white';
  const actionClass =
    themePreference === 'light'
      ? 'rounded-lg border border-sky-100 bg-white px-4 py-2 text-slate-900 transition-colors hover:bg-sky-50'
      : 'rounded-lg border border-white/10 bg-white/10 px-4 py-2 transition-colors hover:bg-white/20';

  const refreshGarments = async (activeApiKey: string) => {
    const data = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
      headers: { Authorization: `Bearer ${activeApiKey}` },
    })
      .then((res) => res.json())
      .catch(() => ({ items: [] }));
    setGarments(data.items || []);
  };

  useEffect(() => {
    let active = true;

    const bootstrapDashboard = async () => {
      if (apiKey) {
        if (active) {
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const sessionResponse = await fetch('/api/dashboard/session', {
          cache: 'no-store',
        });

        if (sessionResponse.ok) {
          const data = (await sessionResponse.json().catch(() => null)) as { apiKey?: string } | null;
          const nextApiKey = data?.apiKey?.trim();
          if (active && nextApiKey) {
            localStorage.setItem('apiKey', nextApiKey);
            setApiKey(nextApiKey);
            setIsBootstrapping(false);
            return;
          }
        }
      } catch {
        // ignore and fall back to local storage
      }

      const storedApiKey = localStorage.getItem('apiKey')?.trim() || '';
      if (active && storedApiKey) {
        setApiKey(storedApiKey);
        fetch('/api/dashboard/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: storedApiKey }),
        }).catch(() => undefined);
        setIsBootstrapping(false);
        return;
      }

      if (active) {
        setIsBootstrapping(false);
        router.replace('/auth/login?next=/dashboard');
      }
    };

    bootstrapDashboard();
    return () => {
      active = false;
    };
  }, [apiKey, router]);

  useEffect(() => {
    if (!apiKey) return;

    const headers = { Authorization: `Bearer ${apiKey}` };

    fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, { headers })
      .then(async (res) => {
        if (res.status === 401) {
          throw new Error('UNAUTHORIZED');
        }
        return res.json();
      })
      .then((data) => setUsage(data))
      .catch(async (error: Error) => {
        if (error.message === 'UNAUTHORIZED') {
          localStorage.removeItem('apiKey');
          setApiKey('');
          await fetch('/api/dashboard/session', { method: 'DELETE' }).catch(() => undefined);
          router.replace('/auth/login?next=/dashboard');
          return;
        }
        console.error(error);
      });

    refreshGarments(apiKey).catch(() => setGarments([]));
  }, [apiKey, router]);

  useEffect(() => {
    if (!apiKey || garments.length === 0) return;
    let active = true;
    const load = async () => {
      const next: Record<string, string> = {};
      for (const g of garments.slice(0, 6)) {
        try {
          const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments/${encodeURIComponent(g.garmentId)}/thumbnail`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) continue;
          const blob = await res.blob();
          next[g.garmentId] = URL.createObjectURL(blob);
        } catch {
          // ignore
        }
      }
      if (active) setThumbs(next);
    };
    load();
    return () => {
      active = false;
    };
  }, [apiKey, garments]);

  useEffect(() => {
    if (!apiKey) return;
    const script = document.createElement('script');
    script.src = getSdkScriptUrl();
    script.async = true;
    script.onload = () => {
      if (window.DrapixAI) {
        window.DrapixAI.init({
          apiKey,
          productId: garments[0]?.garmentId || 'demo-product',
          containerId: 'drapixai-dashboard-demo',
          garmentType: 'upper',
        });
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [apiKey, garments]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleLogout = () => {
    fetch('/api/dashboard/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        localStorage.removeItem('apiKey');
        signOut({ redirect: false })
          .catch(() => undefined)
          .finally(() => {
            router.push('/');
          });
      });
  };

  const handleCatalogSync = async () => {
    if (!apiKey || !catalogCsvFile) {
      setCatalogSyncStatus('Add a CSV file first.');
      return;
    }

    setCatalogSyncStatus('Syncing upper-body catalog IDs...');

    try {
      const csvText = await catalogCsvFile.text();
      const items = parseCatalogCsv(csvText);
      if (items.length === 0) {
        setCatalogSyncStatus('No valid rows found. Include at least a productId column.');
        return;
      }

      const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCatalogSyncStatus(data?.error || 'Catalog sync failed.');
        setToast(data?.error || 'Catalog sync failed.');
        return;
      }

      const syncedCount = Array.isArray(data?.items) ? data.items.length : 0;
      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      setCatalogSyncStatus(`Synced ${syncedCount} upper-body products.${skippedCount ? ` Skipped ${skippedCount} non-upper-body rows.` : ''}`);
      setToast(`Catalog sync complete. ${syncedCount} products ready for garment upload.`);
      setCatalogCsvFile(null);
      await refreshGarments(apiKey);
    } catch {
      setCatalogSyncStatus('Catalog sync failed.');
      setToast('Catalog sync failed.');
    }
  };

  const handleBulkGarmentUpload = async () => {
    if (!apiKey || bulkGarmentFiles.length === 0) {
      setBulkGarmentStatus('Select garment files first.');
      return;
    }

    setBulkGarmentStatus('Uploading upper-body garments...');

    const form = new FormData();
    bulkGarmentFiles.forEach((file) => {
      form.append('cloth_images', file);
    });

    const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBulkGarmentStatus(data?.error || 'Bulk upload failed.');
      setToast(data?.error || 'Bulk upload failed.');
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const successCount = items.filter((item: { cacheKey?: string }) => Boolean(item.cacheKey)).length;
    const failedCount = items.length - successCount;
    setBulkGarmentStatus(`Uploaded ${successCount} garments.${failedCount ? ` ${failedCount} files need matching synced product IDs.` : ''}`);
    setToast(`Bulk upload complete. ${successCount} garments are now try-on ready.`);
    setBulkGarmentFiles([]);
    await refreshGarments(apiKey);
  };

  if (isBootstrapping || !usage) {
    return (
      <div className={`${pageClass} flex items-center justify-center`}>
        <p className={mutedTextClass}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      {themePreference === 'light' ? (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_85%_18%,rgba(59,130,246,0.14),transparent_24%),linear-gradient(180deg,#f6fbff_0%,#edf4ff_100%)]" />
          <div className="absolute inset-0 opacity-[0.35] bg-[linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] bg-[size:42px_42px]" />
        </div>
      ) : null}

      {toast ? (
        <div className="fixed right-6 top-24 z-50 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          {toast}
        </div>
      ) : null}

      <header className={`relative z-10 border-b ${themePreference === 'light' ? 'border-slate-200/80 bg-white/70 backdrop-blur' : 'border-white/10'} p-6`}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            DrapixAI
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/subscription" className={`text-sm transition-colors ${themePreference === 'light' ? 'text-slate-600 hover:text-slate-950' : 'text-gray-400 hover:text-white'}`}>
              Subscription
            </Link>
            <Link href="/settings" className={`text-sm transition-colors ${themePreference === 'light' ? 'text-slate-600 hover:text-slate-950' : 'text-gray-400 hover:text-white'}`}>
              Settings
            </Link>
            <button onClick={handleLogout} className={`transition-colors ${themePreference === 'light' ? 'text-slate-600 hover:text-slate-950' : 'text-gray-400 hover:text-white'}`}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {usage.planType === 'trial' ? (
          <div className="p-4 mb-8 border border-cyan-500/30 bg-cyan-500/10 rounded-xl">
            <p className={`text-sm ${themePreference === 'light' ? 'text-cyan-900' : 'text-cyan-200'}`}>
              Trial active: {usage.trialDaysLeft} day(s) left. You have {usage.quotaRemaining} try-ons remaining.
            </p>
            {usage.selectedPlanName ? (
              <p className={`text-xs mt-2 ${themePreference === 'light' ? 'text-cyan-800/80' : 'text-cyan-100/80'}`}>
                Selected paid plan after trial: {usage.selectedPlanName}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 mb-8">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">Workspace Ownership</h2>
            </div>
            <p className={`text-sm mb-5 ${mutedTextClass}`}>
              This dashboard is tied to the current DrapixAI workspace owner identity. These are the ownership details currently active in this account.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={panelClass}>
                <p className={`text-xs uppercase tracking-[0.2em] mb-2 ${mutedTextClass}`}>Workspace Owner</p>
                <p className={`text-lg font-semibold ${strongTextClass}`}>{usage.companyName || usage.email?.split('@')[0] || 'Account owner'}</p>
              </div>
              <div className={panelClass}>
                <div className={`flex items-center gap-2 mb-2 ${mutedTextClass}`}>
                  <Mail className="w-4 h-4" />
                  <p className={`text-xs uppercase tracking-[0.2em] ${mutedTextClass}`}>Owner Email</p>
                </div>
                <p className={`text-sm font-medium break-all ${strongTextClass}`}>{usage.email || 'Not available'}</p>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              <h2 className="text-xl font-bold">Account Status</h2>
            </div>
            <div className="space-y-3">
              <div className={panelClass}>
                <p className={`text-sm ${mutedTextClass}`}>Current plan path</p>
                <p className={`text-lg font-semibold ${strongTextClass}`}>{usage.subscriptionPlanName || usage.selectedPlanName || usage.planName}</p>
              </div>
            <div className={panelClass}>
              <p className={`text-sm ${mutedTextClass}`}>Store status</p>
              <p className={`text-lg font-semibold ${strongTextClass}`}>
                {usage.storeConnected ? 'Verified and connected' : usage.domain && usage.domain !== '*' ? 'Domain saved, verification pending' : 'Store not connected yet'}
              </p>
            </div>
          </div>
        </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 mb-8">
          <div className={subtleCardClass}>
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">Onboarding Checklist</h2>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Account session active', done: Boolean(apiKey) },
                { label: 'Store domain connected', done: Boolean(usage.storeConnected) },
                { label: 'At least one garment uploaded', done: garments.length > 0 },
                { label: 'Ready to run live try-ons', done: Boolean(apiKey) && Boolean(usage.storeConnected) && garments.length > 0 },
              ].map((item) => (
                <div key={item.label} className={`flex items-center gap-3 px-4 py-3 ${panelClass}`}>
                  <CheckCircle2 className={`w-5 h-5 ${item.done ? 'text-emerald-400' : 'text-gray-600'}`} />
                  <span className={item.done ? strongTextClass : mutedTextClass}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={subtleCardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Store className={`w-6 h-6 ${usage.storeConnected ? 'text-emerald-400' : 'text-amber-300'}`} />
              <h2 className="text-xl font-bold">Store Connection Status</h2>
            </div>
            <div className={panelClass}>
              <p className={`text-sm ${mutedTextClass}`}>Current status</p>
              <p className={`text-2xl font-bold mt-1 ${strongTextClass}`}>{usage.storeConnected ? 'Connected' : usage.domain && usage.domain !== '*' ? 'Verification pending' : 'Not connected'}</p>
              <p className={`text-sm mt-3 ${mutedTextClass}`}>{usage.domain && usage.domain !== '*' ? usage.domain : 'No authorized domain has been set yet.'}</p>
              {usage.catalogLastSyncStatus ? (
                <p className={`text-xs mt-3 ${mutedTextClass}`}>
                  Catalog sync: {usage.catalogLastSyncStatus}
                  {usage.catalogLastSyncedAt ? ` · ${new Date(usage.catalogLastSyncedAt).toLocaleString()}` : ''}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/settings" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <Store className="w-4 h-4" />
                Manage Store Settings
              </Link>
              <Link href="/subscription" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <ExternalLink className="w-4 h-4" />
                Manage Subscription
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className={subtleCardClass}>
            <p className={`text-sm ${mutedTextClass}`}>Plan</p>
            <p className={`text-2xl font-bold capitalize ${strongTextClass}`}>{usage.planName || usage.planType}</p>
            {usage.planType === 'trial' && usage.selectedPlanName ? (
              <p className={`text-xs mt-2 ${mutedTextClass}`}>Trial is currently linked to {usage.selectedPlanName}.</p>
            ) : null}
          </div>
          <div className={subtleCardClass}>
            <p className={`text-sm ${mutedTextClass}`}>Renders Used</p>
            <p className={`text-2xl font-bold ${strongTextClass}`}>
              {usage.rendersUsed} <span className={`text-sm ${mutedTextClass}`}>/ {usage.quota}</span>
            </p>
          </div>
          <div className={subtleCardClass}>
            <p className={`text-sm ${mutedTextClass}`}>Quota Remaining</p>
            <p className={`text-2xl font-bold ${strongTextClass}`}>{usage.quotaRemaining}</p>
          </div>
          <div className={subtleCardClass}>
            <p className={`text-sm ${mutedTextClass}`}>{usage.planType === 'trial' ? 'Trial Days Left' : 'Days Until Renewal'}</p>
            <p className={`text-2xl font-bold ${strongTextClass}`}>
              {usage.planType === 'trial'
                ? usage.trialDaysLeft
                : usage.subscriptionCurrentPeriodEndsAt
                  ? Math.max(
                      0,
                      Math.ceil(
                        (new Date(usage.subscriptionCurrentPeriodEndsAt).getTime() - Date.now()) /
                          (1000 * 60 * 60 * 24)
                      )
                    )
                  : '--'}
            </p>
          </div>
        </div>

        <div className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-4">Your API Key</h2>
          <div className="flex gap-4">
            <input type="text" value={apiKey} readOnly className={inputClass} />
            <button
              onClick={() => navigator.clipboard.writeText(apiKey).then(() => setToast('API key copied.'))}
              className={actionClass}
            >
              <span className="inline-flex items-center gap-2"><Copy className="w-4 h-4" />Copy</span>
            </button>
            <button
              onClick={async () => {
                const res = await fetch(`${PUBLIC_API_BASE_URL}/analytics/api-key/rotate`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${apiKey}` },
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.apiKey) {
                  setToast('Unable to rotate API key right now.');
                  return;
                }
                localStorage.setItem('apiKey', data.apiKey);
                setApiKey(data.apiKey);
                await fetch('/api/dashboard/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ apiKey: data.apiKey }),
                }).catch(() => undefined);
                setToast('API key rotated successfully.');
              }}
              className={actionClass}
            >
              <span className="inline-flex items-center gap-2"><KeyRound className="w-4 h-4" />Rotate</span>
            </button>
          </div>
        </div>

        <div className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-4">Authorized Domain</h2>
          <p className={`mb-4 ${mutedTextClass}`}>Each subscriber can use the SDK on a single domain. Set it once.</p>
          <div className="flex gap-4">
            <input
              type="text"
              defaultValue={usage.domain || ''}
              placeholder="yourbrand.com"
              className={inputClass}
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (!value || !apiKey) return;
                const res = await fetch(`${PUBLIC_API_BASE_URL}/analytics/domain`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({ domain: value }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setUsage((prev) => (prev ? { ...prev, domain: data.domain, storeConnected: true } : prev));
                  setToast('Store domain updated.');
                }
              }}
            />
          </div>
        </div>

        <div className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-4">Daily Try-On Traffic</h2>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {(usage.dailyUsage || []).slice(-7).map((d) => (
              <div key={d.date} className={`${panelClass} text-center`}>
                <p className={`text-xs ${mutedTextClass}`}>{d.date.slice(5)}</p>
                <p className={`text-2xl font-bold ${strongTextClass}`}>{d.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`${cardClass} mb-8`}>
          <div className="flex items-center gap-3 mb-4">
            <UploadCloud className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bold">Recent Try-On Activity</h2>
          </div>
          {!usage.recentRenders || usage.recentRenders.length === 0 ? (
            <p className={`text-sm ${mutedTextClass}`}>No try-on history yet. Once your store is connected and requests run, recent jobs will appear here.</p>
          ) : (
            <div className="space-y-3">
              {usage.recentRenders.map((render) => (
                <div key={render.id} className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${panelClass}`}>
                  <div>
                    <p className={`text-sm font-medium ${strongTextClass}`}>Job #{render.id}{render.productId ? ` - ${render.productId}` : ''}</p>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>{new Date(render.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${
                        render.status === 'complete'
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                          : render.status === 'failed'
                            ? 'border-rose-400/30 bg-rose-400/10 text-rose-100'
                            : 'border-white/10 bg-white/5 text-gray-300'
                      }`}
                    >
                      {render.status}
                    </span>
                    {render.outputUrl ? (
                      <Link href={`${PUBLIC_API_BASE_URL}/sdk/result/${render.id}`} className="text-sm text-cyan-300 hover:text-cyan-200">
                        Open result
                      </Link>
                    ) : null}
                    {render.error ? <span className="text-xs text-rose-200">{render.error}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${cardClass} mb-8`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Garment Cache</h2>
            {garments.some((g) => g.status === 'missing') ? (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-200">
                Missing: {garments.filter((g) => g.status === 'missing').length}
              </span>
            ) : null}
          </div>
          <p className={`mb-4 ${mutedTextClass}`}>
            Upper-body only. First sync your catalog product IDs, then upload garment files that match those IDs exactly.
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <div className={panelClass}>
              <p className={`text-sm font-medium mb-2 ${strongTextClass}`}>1. CSV catalog sync</p>
              <p className={`text-sm mb-3 ${mutedTextClass}`}>
                Upload a CSV with <span className="font-mono">productId</span> and optional <span className="font-mono">productName</span>, <span className="font-mono">category</span>, or <span className="font-mono">garmentType</span>. We only sync rows identified as upper-body.
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCatalogCsvFile(e.target.files?.[0] || null)}
                className={`p-2 text-sm ${mutedTextClass}`}
              />
              <div className="flex flex-wrap gap-3 mt-3">
                <button onClick={handleCatalogSync} className={actionClass}>
                  Sync Upper-Body Catalog
                </button>
                <button
                  onClick={() => {
                    const sample = [
                      'productId,productName,category,garmentType',
                      'shirt-001,Blue Oxford Shirt,Shirts,upper',
                      'hoodie-017,Black Hoodie,Hoodies,upper',
                    ].join('\n');
                    const blob = new Blob([sample], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = 'drapixai-upper-body-template.csv';
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  className={actionClass}
                >
                  Download Template
                </button>
              </div>
              {catalogSyncStatus ? <p className={`text-xs mt-3 ${mutedTextClass}`}>{catalogSyncStatus}</p> : null}
            </div>

            <div className={panelClass}>
              <p className={`text-sm font-medium mb-2 ${strongTextClass}`}>2. Bulk garment upload</p>
              <p className={`text-sm mb-3 ${mutedTextClass}`}>
                Upload multiple upper-body garment files at once. Each filename must match a synced product ID, for example <span className="font-mono">shirt-001.png</span>.
              </p>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setBulkGarmentFiles(Array.from(e.target.files || []))}
                className={`p-2 text-sm ${mutedTextClass}`}
              />
              {bulkGarmentFiles.length ? (
                <p className={`text-xs mt-2 ${mutedTextClass}`}>
                  Selected files: {bulkGarmentFiles.slice(0, 4).map((file) => file.name).join(', ')}
                  {bulkGarmentFiles.length > 4 ? ` +${bulkGarmentFiles.length - 4} more` : ''}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 mt-3">
                <button onClick={handleBulkGarmentUpload} className={actionClass}>
                  Upload Bulk Garments
                </button>
              </div>
              {bulkGarmentStatus ? <p className={`text-xs mt-3 ${mutedTextClass}`}>{bulkGarmentStatus}</p> : null}
            </div>
          </div>
          <div className={`mb-6 ${panelClass}`}>
            <p className={`text-sm mb-3 ${mutedTextClass}`}>
              3. Single garment upload. Use this when you want to update one synced upper-body product manually.
            </p>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={garmentUploadId}
                onChange={(e) => setGarmentUploadId(e.target.value)}
                placeholder="product-id"
                className={inputClass}
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setGarmentFile(e.target.files?.[0] || null)}
                className={`p-2 text-sm ${mutedTextClass}`}
              />
              <button
                onClick={async () => {
                  if (!apiKey || !garmentUploadId || !garmentFile) {
                    setGarmentStatus('Please provide product ID and image.');
                    return;
                  }
                  setGarmentStatus('Uploading...');
                  const form = new FormData();
                  form.append('garment_id', garmentUploadId);
                  form.append('cloth_image', garmentFile);
                  const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: form,
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setGarmentStatus(data?.error || 'Upload failed.');
                    setToast(data?.error || 'Upload failed.');
                    return;
                  }
                  setGarmentStatus('Uploaded and cached.');
                  setToast('Garment uploaded successfully.');
                  setGarmentUploadId('');
                  setGarmentFile(null);
                  await refreshGarments(apiKey);
                }}
                className={actionClass}
              >
                Upload
              </button>
            </div>
            {garmentStatus ? <p className={`text-xs mt-2 ${mutedTextClass}`}>{garmentStatus}</p> : null}
          </div>
          {garments.length === 0 ? (
            <p className={`text-sm ${mutedTextClass}`}>No garments uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {garments.slice(0, 6).map((g) => (
                <div key={g.garmentId} className={panelClass}>
                  <div className="mb-3">
                    <img
                      src={thumbs[g.garmentId] || ''}
                      alt={g.garmentId}
                      className={`w-full h-40 object-contain rounded-md ${themePreference === 'light' ? 'bg-slate-50 border border-sky-100' : 'bg-white/5 border border-white/10'}`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <p className={`text-sm ${mutedTextClass}`}>Garment ID</p>
                  <p className={`text-base font-mono ${strongTextClass}`}>{g.garmentId}</p>
                  {g.productName ? <p className={`text-sm mt-2 ${mutedTextClass}`}>{g.productName}</p> : null}
                  {g.category ? <p className={`text-xs mt-1 ${mutedTextClass}`}>Category: {g.category}</p> : null}
                  <p className={`text-sm mt-2 ${mutedTextClass}`}>Cache Key</p>
                  <p className={`text-xs font-mono break-all ${strongTextClass}`}>{g.cacheKey}</p>
                  <p className={`text-xs mt-2 ${mutedTextClass}`}>Status: {g.status}</p>
                </div>
              ))}
            </div>
          )}

          {garments.some((g) => g.status === 'missing') ? (
            <div className={`mt-6 ${panelClass}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-sm ${mutedTextClass}`}>Missing garments (from catalog sync)</p>
                <button
                  onClick={() => {
                    const missing = garments.filter((g) => g.status === 'missing');
                    const rows = ['garmentId,status', ...missing.map((g) => `${g.garmentId},${g.status}`)];
                    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'drapixai-missing-garments.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className={actionClass}
                >
                  Export CSV
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {garments
                  .filter((g) => g.status === 'missing')
                  .slice(missingPage * 12, missingPage * 12 + 12)
                  .map((g) => (
                    <span key={g.garmentId} className={`text-xs font-mono px-2 py-1 rounded ${themePreference === 'light' ? 'bg-sky-50 text-slate-900 border border-sky-100' : 'bg-white/10'}`}>
                      {g.garmentId}
                    </span>
                  ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => setMissingPage(Math.max(0, missingPage - 1))} className={actionClass}>
                  Prev
                </button>
                <button onClick={() => setMissingPage(missingPage + 1)} className={actionClass}>
                  Next
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {garments
                  .filter((g) => g.status === 'missing')
                  .slice(missingPage * 6, missingPage * 6 + 6)
                  .map((g) => (
                    <div key={`${g.garmentId}-upload`} className={`p-3 rounded-lg ${themePreference === 'light' ? 'bg-white border border-sky-100' : 'bg-black/30 border border-white/10'}`}>
                      <p className={`text-xs mb-2 ${mutedTextClass}`}>Upload for {g.garmentId}</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !apiKey) return;
                          setGarmentStatus(`Uploading ${g.garmentId}...`);
                          const form = new FormData();
                          form.append('garment_id', g.garmentId);
                          form.append('cloth_image', file);
                          const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${apiKey}` },
                            body: form,
                          });
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            setGarmentStatus(data?.error || 'Upload failed.');
                            setToast(data?.error || 'Upload failed.');
                            return;
                          }
                          setGarmentStatus(`Uploaded ${g.garmentId}.`);
                          setToast(`Uploaded ${g.garmentId}.`);
                          await refreshGarments(apiKey);
                        }}
                        className={`p-2 text-xs ${mutedTextClass}`}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>

        <div id="plugin-demo" className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-4">Plugin Demo</h2>
          <p className={`mb-4 ${mutedTextClass}`}>Preview the customer-facing plugin experience.</p>
          <div className={panelClass}>
            <div id="drapixai-dashboard-demo"></div>
          </div>
        </div>

        <div className={cardClass}>
          <h2 className="text-xl font-bold mb-4">Quick Start</h2>
          <p className={`mb-4 ${mutedTextClass}`}>
            Upper-body garments only. You can embed the launcher on a single product page or auto-attach it across eligible product cards in your storefront.
          </p>
          <pre className={`p-4 rounded-lg overflow-x-auto text-sm ${themePreference === 'light' ? 'bg-slate-950 text-slate-100 border border-slate-800' : 'bg-white/5 border border-white/10'}`}>
{`<script src="${getSdkScriptUrl()}"></script>

<!-- Single product mode -->
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: '${apiKey}',
    productId: 'your-product-id',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>

<!-- Auto-attach mode -->
<div data-drapix-product-id="shirt-001">
  <div data-drapix-button-slot></div>
</div>
<script>
  DrapixAI.init({
    apiKey: '${apiKey}',
    autoAttach: true,
    productSelector: '[data-drapix-product-id]',
    productIdAttribute: 'data-drapix-product-id',
    buttonTargetSelector: '[data-drapix-button-slot]',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`}
          </pre>
        </div>
      </main>
    </div>
  );
}
