'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ArrowRight, CheckCircle2, Copy, ExternalLink, KeyRound, Sparkles, Store, UploadCloud, Wand2 } from 'lucide-react';
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
  uploadedGarmentCount?: number;
  discoveredProductCount?: number;
  suggestedMatchCount?: number;
  confirmedMatchCount?: number;
  dailyUsage?: { date: string; count: number }[];
  recentRenders?: { id: number; status: string; productId?: string | null; error?: string | null; outputUrl?: string | null; createdAt: string }[];
}

interface GarmentItem {
  garmentId: string;
  displayName?: string | null;
  cacheKey?: string | null;
  status: string;
  productName?: string | null;
  category?: string | null;
  garmentType?: string | null;
  sourceImageUrl?: string | null;
  matchStatus?: string;
  suggestedProductId?: string | null;
  suggestedProductName?: string | null;
  confirmedProductId?: string | null;
  confirmedProductName?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
  updatedAt: string;
}

interface GarmentSyncRow {
  productId: string;
  productName?: string;
  category?: string;
  garmentType?: string;
}

interface CatalogProductItem {
  productId: string;
  productName?: string | null;
  category?: string | null;
  garmentType?: string | null;
  imageUrl?: string | null;
  status?: string;
  updatedAt: string;
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

const getApiErrorMessage = (payload: { message?: string; error?: string } | null | undefined, fallback: string) =>
  payload?.message || payload?.error || fallback;

const humanizeGarmentId = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export default function Dashboard() {
  const themePreference = useThemePreference();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [garmentUploadId, setGarmentUploadId] = useState('');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentStatus, setGarmentStatus] = useState('');
  const [catalogCsvFile, setCatalogCsvFile] = useState<File | null>(null);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState('');
  const [bulkGarmentFiles, setBulkGarmentFiles] = useState<File[]>([]);
  const [bulkGarmentStatus, setBulkGarmentStatus] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [matchStatusMessage, setMatchStatusMessage] = useState('');
  const [activeMatchGarmentId, setActiveMatchGarmentId] = useState('');
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

  const refreshCatalog = async (activeApiKey: string) => {
    const data = await fetch(`${PUBLIC_API_BASE_URL}/sdk/catalog`, {
      headers: { Authorization: `Bearer ${activeApiKey}` },
    })
      .then((res) => res.json())
      .catch(() => ({ items: [] }));
    setCatalogProducts(data.items || []);
  };

  const refreshUsage = async (activeApiKey: string) => {
    const headers = { Authorization: `Bearer ${activeApiKey}` };
    const res = await fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, { headers });
    if (res.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    const data = await res.json();
    setUsage(data);
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

    Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]).catch(async (error: Error) => {
      if (error.message === 'UNAUTHORIZED') {
        localStorage.removeItem('apiKey');
        setApiKey('');
        await fetch('/api/dashboard/session', { method: 'DELETE' }).catch(() => undefined);
        router.replace('/auth/login?next=/dashboard');
        return;
      }
      console.error(error);
      setGarments([]);
      setCatalogProducts([]);
    });
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
    setSelectedProducts((current) => {
      const next = { ...current };
      for (const garment of garments) {
        if (!next[garment.garmentId]) {
          next[garment.garmentId] = garment.confirmedProductId || garment.suggestedProductId || '';
        }
      }
      return next;
    });
  }, [garments]);

  useEffect(() => {
    if (!apiKey) return;
    const script = document.createElement('script');
    script.src = getSdkScriptUrl();
    script.async = true;
    script.onload = () => {
      if (window.DrapixAI) {
        const previewProductId =
          garments.find((garment) => garment.confirmedProductId)?.confirmedProductId ||
          catalogProducts[0]?.productId ||
          'demo-product';
        window.DrapixAI.init({
          apiKey,
          productId: previewProductId,
          containerId: 'drapixai-dashboard-demo',
          garmentType: 'upper',
        });
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [apiKey, garments, catalogProducts]);

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

      const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/catalog/sync`, {
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
      setToast(`Catalog discovery complete. ${syncedCount} products are now available for matching.`);
      setCatalogCsvFile(null);
      await Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]);
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
      const message = getApiErrorMessage(data, 'Bulk upload failed.');
      setBulkGarmentStatus(message);
      setToast(message);
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const successCount = items.filter((item: { cacheKey?: string }) => Boolean(item.cacheKey)).length;
    const failedCount = items.length - successCount;
    const firstFailure = items.find((item: { message?: string; error?: string }) => item.message || item.error);
    setBulkGarmentStatus(
      failedCount && firstFailure
        ? `Uploaded ${successCount} garments. ${failedCount} file(s) failed. ${getApiErrorMessage(firstFailure, 'Review the rejected uploads and use isolated garment-only images.')}`
        : `Uploaded ${successCount} garments.${failedCount ? ` ${failedCount} files still need cleaner garment assets.` : ''}`
    );
    setToast(`Bulk upload complete. ${successCount} garments are now ready for matching.`);
    setBulkGarmentFiles([]);
    await Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]);
  };

  const handleConfirmMatch = async (garmentId: string) => {
    const productId = selectedProducts[garmentId];
    if (!apiKey || !productId) {
      setMatchStatusMessage('Choose a discovered product before confirming the mapping.');
      return;
    }

    setActiveMatchGarmentId(garmentId);
    setMatchStatusMessage('Saving confirmed mapping...');

    try {
      const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/matches/${encodeURIComponent(garmentId)}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = getApiErrorMessage(data, 'Unable to confirm the mapping.');
        setMatchStatusMessage(message);
        setToast(message);
        return;
      }

      setMatchStatusMessage('Confirmed mapping saved.');
      setToast('Confirmed mapping saved.');
      await Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]);
    } catch {
      setMatchStatusMessage('Unable to confirm the mapping.');
      setToast('Unable to confirm the mapping.');
    } finally {
      setActiveMatchGarmentId('');
    }
  };

  const handleClearConfirmedMatch = async (garmentId: string) => {
    if (!apiKey) return;

    setActiveMatchGarmentId(garmentId);
    setMatchStatusMessage('Clearing confirmed mapping...');

    try {
      const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/matches/${encodeURIComponent(garmentId)}/confirm`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = getApiErrorMessage(data, 'Unable to clear the mapping.');
        setMatchStatusMessage(message);
        setToast(message);
        return;
      }

      setMatchStatusMessage('Confirmed mapping cleared. DrapixAI recalculated the suggestion.');
      setToast('Confirmed mapping cleared.');
      await Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]);
    } catch {
      setMatchStatusMessage('Unable to clear the mapping.');
      setToast('Unable to clear the mapping.');
    } finally {
      setActiveMatchGarmentId('');
    }
  };

  if (isBootstrapping || !usage) {
    return (
      <div className={`${pageClass} flex items-center justify-center`}>
        <p className={mutedTextClass}>Loading...</p>
      </div>
    );
  }

  const hasDomain = Boolean(usage.domain && usage.domain !== '*');
  const hasVerifiedStore = Boolean(usage.storeVerified);
  const hasCatalogSynced = (usage.discoveredProductCount || 0) > 0;
  const hasGarments = (usage.uploadedGarmentCount || garments.length) > 0;
  const hasSuggestedMatches = (usage.suggestedMatchCount || 0) > 0;
  const hasConfirmedMappings = (usage.confirmedMatchCount || 0) > 0;
  const readyForPreview = hasConfirmedMappings;
  const readyForGoLive = hasVerifiedStore && hasConfirmedMappings;
  const isQuotaExhausted = usage.quotaRemaining <= 0;
  const isQuotaLow = !isQuotaExhausted && usage.quotaRemaining <= Math.max(50, Math.ceil(usage.quota * 0.1));

  const nextBestAction = isQuotaExhausted
    ? 'Your plan has reached its try-on limit. Upgrade volume or contact sales before continuing previews or storefront rollout.'
    : !hasGarments
    ? 'Upload a few clean garment-only assets first. That gives DrapixAI something real to validate before any storefront work.'
    : !hasCatalogSynced
      ? 'Connect product discovery next, so DrapixAI can understand which storefront products these garments might belong to.'
      : !hasSuggestedMatches
        ? 'Review the first suggested matches and make sure the right garments are linked to the right products.'
        : !hasVerifiedStore
          ? 'Save and verify your store when you are happy with the preview path. Live verification can wait until after internal testing.'
          : 'Install the SDK only after the confirmed mappings and preview experience look right.';

  const onboardingSteps = [
    {
      title: '1. Garment upload and validation',
      summary: 'Upload a few clean upper-body assets first. DrapixAI validates the files so weak inputs get blocked early.',
      done: hasGarments,
      actionLabel: 'Upload Garments',
      actionHref: '#garment-onboarding',
    },
    {
      title: '2. Catalog discovery',
      summary: 'Bring in a small product list so DrapixAI can discover what exists on the brand side before any live install.',
      done: hasCatalogSynced,
      actionLabel: 'Discover Products',
      actionHref: '#garment-onboarding',
    },
    {
      title: '3. Suggested matches',
      summary: 'Use discovery plus garment context to propose likely product links instead of forcing brands to manage exact IDs up front.',
      done: hasSuggestedMatches,
      actionLabel: 'Review Flow',
      actionHref: '#garment-onboarding',
    },
    {
      title: '4. Manual confirmation',
      summary: 'A human still approves the final garment-to-product pairings. That keeps the workflow safe for non-technical teams.',
      done: hasConfirmedMappings,
      actionLabel: 'See Confirmation Path',
      actionHref: '#mapping-flow',
    },
    {
      title: '5. SDK uses confirmed mappings',
      summary: 'Only after the matches feel right should the storefront install use those confirmed links for live shoppers.',
      done: readyForGoLive,
      actionLabel: readyForPreview ? 'Preview Try-On' : 'Open Help',
      actionHref: readyForPreview ? '#plugin-demo' : '/help',
    },
  ];

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
        <div className="mb-8">
          <p className={`text-sm uppercase tracking-[0.25em] mb-3 ${themePreference === 'light' ? 'text-cyan-700/80' : 'text-cyan-400/80'}`}>Guided Onboarding</p>
          <h1 className="text-3xl font-bold mb-3">Give brands a clean path from garment upload to confirmed live mappings.</h1>
          <p className={`max-w-3xl text-base ${mutedTextClass}`}>
            The launch story is now: upload garments, discover products, review suggested matches, confirm the right pairings, then let the SDK use only those confirmed mappings on the storefront.
          </p>
        </div>

        {isQuotaExhausted ? (
          <div className={`p-5 mb-8 border rounded-xl ${themePreference === 'light' ? 'border-rose-200 bg-rose-50' : 'border-rose-400/30 bg-rose-500/10'}`}>
            <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${themePreference === 'light' ? 'text-rose-700' : 'text-rose-200'}`}>Plan limit reached</p>
            <p className={`text-sm mt-3 leading-7 ${themePreference === 'light' ? 'text-rose-900' : 'text-rose-100'}`}>
              You have used all {usage.quota} try-ons in the current period. Pause internal preview and live rollout here, then upgrade the plan or contact sales before trying to push more traffic.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/subscription" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <ExternalLink className="w-4 h-4" />
                Review plan
              </Link>
              <Link href="/pricing" className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${themePreference === 'light' ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-rose-500 text-white hover:bg-rose-400'}`}>
                Upgrade now
              </Link>
              <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Quota%20Upgrade" className={`inline-flex items-center gap-2 ${actionClass}`}>
                Contact sales
              </a>
            </div>
          </div>
        ) : usage.planType === 'trial' ? (
          <div className="p-4 mb-8 border border-cyan-500/30 bg-cyan-500/10 rounded-xl">
            <p className={`text-sm ${themePreference === 'light' ? 'text-cyan-900' : 'text-cyan-200'}`}>
              Trial active: {usage.trialDaysLeft} day(s) left. You have {usage.quotaRemaining} try-ons remaining to validate product quality, onboarding, and storefront flow before scaling usage.
            </p>
            {usage.selectedPlanName ? (
              <p className={`text-xs mt-2 ${themePreference === 'light' ? 'text-cyan-800/80' : 'text-cyan-100/80'}`}>
                Selected paid plan after trial: {usage.selectedPlanName}
              </p>
            ) : null}
          </div>
        ) : isQuotaLow ? (
          <div className={`p-4 mb-8 border rounded-xl ${themePreference === 'light' ? 'border-amber-200 bg-amber-50' : 'border-amber-400/30 bg-amber-500/10'}`}>
            <p className={`text-sm ${themePreference === 'light' ? 'text-amber-900' : 'text-amber-100'}`}>
              Usage warning: only {usage.quotaRemaining} try-ons remain in this period. If you expect more internal previews or live traffic soon, upgrade before rollout stalls.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 mb-8">
          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">Start here</h2>
            </div>
            <p className={`text-sm mb-5 ${mutedTextClass}`}>
              Ignore full rollout for a moment. The fastest path is: save your store, add a few products, upload clean garment assets, then preview internally.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {onboardingSteps.map((step) => (
                <div key={step.title} className={panelClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`font-semibold ${strongTextClass}`}>{step.title}</p>
                      <p className={`text-sm mt-2 ${mutedTextClass}`}>{step.summary}</p>
                    </div>
                    <CheckCircle2 className={`w-5 h-5 flex-shrink-0 ${step.done ? 'text-emerald-400' : 'text-slate-400'}`} />
                  </div>
                  <Link href={step.actionHref} className={`mt-4 inline-flex items-center gap-2 text-sm ${themePreference === 'light' ? 'text-cyan-700 hover:text-cyan-900' : 'text-cyan-300 hover:text-cyan-200'}`}>
                    {step.actionLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              ))}
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Wand2 className="w-6 h-6 text-emerald-400" />
              <h2 className="text-xl font-bold">What should you do next?</h2>
            </div>
            <div className={panelClass}>
              <p className={`text-sm ${mutedTextClass}`}>Recommended next action</p>
              <p className={`text-lg font-semibold mt-2 ${strongTextClass}`}>{nextBestAction}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 mt-4">
              <div className={panelClass}>
                <p className={`text-sm ${mutedTextClass}`}>Current setup status</p>
                <p className={`text-2xl font-bold mt-1 ${strongTextClass}`}>{readyForGoLive ? 'Launch path ready' : readyForPreview ? 'Ready for internal preview' : 'Still in setup'}</p>
                <p className={`text-sm mt-3 ${mutedTextClass}`}>
                  {hasVerifiedStore
                    ? 'Your store is verified.'
                    : hasDomain
                      ? 'Your store URL is saved, but verification is still pending.'
                      : 'You have not saved a store URL yet.'}
                </p>
              </div>
              <div className={panelClass}>
                <p className={`text-sm ${mutedTextClass}`}>Workspace owner</p>
                <p className={`text-lg font-semibold mt-1 ${strongTextClass}`}>{usage.companyName || usage.email?.split('@')[0] || 'Account owner'}</p>
                <p className={`text-xs mt-2 break-all ${mutedTextClass}`}>{usage.email || 'Not available'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/settings" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <Store className="w-4 h-4" />
                Store Settings
              </Link>
              <Link href="/help" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <ExternalLink className="w-4 h-4" />
                Full Help
              </Link>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 mb-8">
          <div className={subtleCardClass}>
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">What success looks like</h2>
            </div>
            <p className={`text-sm mb-4 ${mutedTextClass}`}>
              Keep the early goal simple: get one believable internal preview first. Full storefront setup should happen only after this checklist feels solid.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Clean garments validated', done: hasGarments },
                { label: 'Catalog discovery connected', done: hasCatalogSynced },
                { label: 'Suggested matches available', done: hasSuggestedMatches },
                { label: 'Confirmed pairings ready', done: hasConfirmedMappings },
                { label: 'Internal preview trusted', done: readyForPreview },
                { label: 'Safe to install live mappings', done: readyForGoLive },
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
              <h2 className="text-xl font-bold">Go live later, not first</h2>
            </div>
            <div className={panelClass}>
              <p className={`text-sm ${mutedTextClass}`}>What belongs in this stage</p>
              <p className={`text-2xl font-bold mt-1 ${strongTextClass}`}>Preview first. Install second.</p>
              <p className={`text-sm mt-3 ${mutedTextClass}`}>
                Save your store URL now if you want, but keep domain verification, API key sharing, and storefront installation for after your internal try-on preview looks believable.
              </p>
              {usage.catalogLastSyncStatus ? (
                <p className={`text-xs mt-3 ${mutedTextClass}`}>
                  Catalog sync: {usage.catalogLastSyncStatus}
                  {usage.catalogLastSyncedAt ? ` | ${new Date(usage.catalogLastSyncedAt).toLocaleString()}` : ''}
                </p>
              ) : null}
            </div>
            <div className={`${panelClass} mt-4`}>
              <p className={`text-sm ${mutedTextClass}`}>Current rollout state</p>
              <p className={`text-lg font-semibold mt-1 ${strongTextClass}`}>
                {usage.storeConnected ? 'Store verified and ready when you are' : usage.domain && usage.domain !== '*' ? 'Store URL saved, live verification can wait' : 'No live store setup yet'}
              </p>
              <p className={`text-sm mt-3 ${mutedTextClass}`}>
                {usage.domain && usage.domain !== '*'
                  ? usage.domain
                  : 'That is okay. You can still finish product prep and internal testing before connecting a live storefront.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/settings" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <Store className="w-4 h-4" />
                Store Settings
              </Link>
              <Link href="/help" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <ExternalLink className="w-4 h-4" />
                Full Help
              </Link>
              <Link href="/subscription" className={`inline-flex items-center gap-2 ${actionClass}`}>
                <ExternalLink className="w-4 h-4" />
                Plans
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
            <p className={`text-2xl font-bold ${isQuotaExhausted ? (themePreference === 'light' ? 'text-rose-700' : 'text-rose-300') : strongTextClass}`}>{usage.quotaRemaining}</p>
            <p className={`text-xs mt-2 ${isQuotaExhausted ? (themePreference === 'light' ? 'text-rose-700' : 'text-rose-300') : isQuotaLow ? (themePreference === 'light' ? 'text-amber-700' : 'text-amber-300') : mutedTextClass}`}>
              {isQuotaExhausted ? 'Upgrade required before more try-ons can run' : isQuotaLow ? 'Plan is close to its limit' : 'Current period remaining'}
            </p>
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
          <h2 className="text-xl font-bold mb-2">Technical install details</h2>
          <p className={`mb-4 ${mutedTextClass}`}>You do not need this for early preview work. Come back here only when you are ready to install DrapixAI on a live storefront or hand setup to a technical teammate.</p>
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
          <h2 className="text-xl font-bold mb-2">Live storefront domain</h2>
          <p className={`mb-4 ${mutedTextClass}`}>This matters only when you are close to launch. If you are still testing image quality and product prep, you can leave live domain work inside Settings for later.</p>
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

        <div id="garment-onboarding" className={`${cardClass} mb-8`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Product and garment prep</h2>
            {garments.some((g) => g.status === 'missing') ? (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-200">
                Missing: {garments.filter((g) => g.status === 'missing').length}
              </span>
            ) : null}
          </div>
          <p className={`mb-4 ${mutedTextClass}`}>
            Upper-body only. The brand-facing flow is: upload garments, let DrapixAI validate them, discover products, review suggested matches, confirm the right pairings, then preview before launch.
          </p>
          <div id="mapping-flow" className={`mb-6 ${panelClass}`}>
            <p className={`text-sm font-medium mb-3 ${strongTextClass}`}>Confirmed mapping flow for brands</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              {[
                {
                  title: '1. Garment upload and validation',
                  body: 'Brands upload garment-only assets. DrapixAI rejects weak inputs before they can degrade try-on quality.',
                },
                {
                  title: '2. Catalog discovery',
                  body: 'A small product import, feed, or storefront scan gives DrapixAI product context without forcing hard ID work on day one.',
                },
                {
                  title: '3. Suggested matches',
                  body: 'DrapixAI proposes likely links between garments and discovered products based on the product context it sees.',
                },
                {
                  title: '4. Manual confirmation',
                  body: 'A human approves or corrects those suggestions so the final mapping stays trustworthy.',
                },
                {
                  title: '5. SDK uses confirmed mappings',
                  body: 'The storefront layer should only use confirmed pairings when you are ready for a live shopper experience.',
                },
              ].map((item) => (
                <div key={item.title} className={`rounded-2xl border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                  <p className={`font-medium mb-2 ${strongTextClass}`}>{item.title}</p>
                  <p className={mutedTextClass}>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className={`mb-6 ${panelClass}`}>
            <p className={`text-sm font-medium mb-3 ${strongTextClass}`}>Launch garment standard</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className={`mb-2 font-medium ${strongTextClass}`}>Use these</p>
                <ul className={`space-y-2 ${mutedTextClass}`}>
                  <li>Garment-only product image</li>
                  <li>Plain, white, or transparent background</li>
                  <li>One centered upper-body item per file</li>
                  <li>Sharp image, at least 512x512</li>
                  <li>Front-facing shirts, tees, tops, blouses, short kurtis</li>
                </ul>
              </div>
              <div>
                <p className={`mb-2 font-medium ${strongTextClass}`}>Do not upload these</p>
                <ul className={`space-y-2 ${mutedTextClass}`}>
                  <li>Photos with a person wearing the garment</li>
                  <li>Visible face, arms, hands, legs, or torso in the garment file</li>
                  <li>Long full-body garments cropped with pants or feet visible</li>
                  <li>Busy lifestyle shots, mannequins, or multi-product layouts</li>
                  <li>Dark, blurry, or heavily shadowed catalog images</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <div className={panelClass}>
              <p className={`text-sm font-medium mb-2 ${strongTextClass}`}>1. Garment upload and validation</p>
              <p className={`text-sm mb-3 ${mutedTextClass}`}>
                Upload multiple upper-body garment files at once. DrapixAI validates the assets first, then uses catalog discovery to move toward suggested matches and later manual confirmation.
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
                  Validate and Upload Garments
                </button>
              </div>
              {bulkGarmentStatus ? <p className={`text-xs mt-3 ${mutedTextClass}`}>{bulkGarmentStatus}</p> : null}
            </div>

            <div className={panelClass}>
              <p className={`text-sm font-medium mb-2 ${strongTextClass}`}>2. Catalog discovery input</p>
              <p className={`text-sm mb-3 ${mutedTextClass}`}>
                Upload a CSV with <span className="font-mono">productId</span> and optional <span className="font-mono">productName</span>, <span className="font-mono">category</span>, or <span className="font-mono">garmentType</span>. This is the discovery layer that helps DrapixAI understand which products exist before matching garments.
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCatalogCsvFile(e.target.files?.[0] || null)}
                className={`p-2 text-sm ${mutedTextClass}`}
              />
              <div className="flex flex-wrap gap-3 mt-3">
                <button onClick={handleCatalogSync} className={actionClass}>
                  Run Catalog Discovery
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
          </div>
          <div className={`mb-6 ${panelClass}`}>
            <p className={`text-sm mb-3 ${mutedTextClass}`}>
              Optional operator upload. Use this only when you need to add or replace one asset manually behind the scenes. Brands should still experience the simpler flow: upload, discover, suggest, confirm, then preview.
            </p>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={garmentUploadId}
                onChange={(e) => setGarmentUploadId(e.target.value)}
                placeholder="asset label (optional)"
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
                  if (!apiKey || !garmentFile) {
                    setGarmentStatus('Please provide a garment image.');
                    return;
                  }
                  setGarmentStatus('Uploading...');
                  const form = new FormData();
                  if (garmentUploadId.trim()) {
                    form.append('garment_id', garmentUploadId.trim());
                  }
                  form.append('cloth_image', garmentFile);
                  const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: form,
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    const message = getApiErrorMessage(data, 'Upload failed.');
                    setGarmentStatus(message);
                    setToast(message);
                    return;
                  }
                  setGarmentStatus(`Uploaded ${data?.displayName || data?.garmentId || 'garment'} and refreshed suggestions.`);
                  setToast('Garment uploaded successfully.');
                  setGarmentUploadId('');
                  setGarmentFile(null);
                  await Promise.all([refreshUsage(apiKey), refreshGarments(apiKey), refreshCatalog(apiKey)]);
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
            <>
              <div className={`mb-6 ${panelClass}`}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className={`text-sm font-medium ${strongTextClass}`}>3. Suggested matches and 4. Manual confirmation</p>
                  <span className={`text-xs px-2 py-1 rounded-full ${themePreference === 'light' ? 'bg-sky-50 text-slate-900 border border-sky-100' : 'bg-white/10 text-gray-200 border border-white/10'}`}>
                    {catalogProducts.length
                      ? `${catalogProducts.length} discovered products available`
                      : 'Run catalog discovery to unlock suggestions'}
                  </span>
                </div>
                <p className={`text-sm ${mutedTextClass}`}>
                  DrapixAI is now using real product discovery and real confirmation state. Each garment can carry a suggested product, and the storefront should only depend on the rows you explicitly confirm here.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
                  <div className={`rounded-2xl border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                    <p className={`font-medium mb-2 ${strongTextClass}`}>Suggested matches</p>
                    <p className={mutedTextClass}>
                      {hasSuggestedMatches
                        ? `${usage.suggestedMatchCount || 0} garment${(usage.suggestedMatchCount || 0) === 1 ? '' : 's'} currently have a product suggestion.`
                        : 'Suggestions appear after at least one garment is validated and catalog discovery has run.'}
                    </p>
                  </div>
                  <div className={`rounded-2xl border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                    <p className={`font-medium mb-2 ${strongTextClass}`}>Manual confirmation</p>
                    <p className={mutedTextClass}>
                      {hasConfirmedMappings
                        ? `${usage.confirmedMatchCount || 0} garment${(usage.confirmedMatchCount || 0) === 1 ? '' : 's'} are confirmed for storefront use.`
                        : 'A human still needs to approve the final pairings before the storefront depends on them.'}
                    </p>
                  </div>
                  <div className={`rounded-2xl border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                    <p className={`font-medium mb-2 ${strongTextClass}`}>SDK live behavior</p>
                    <p className={mutedTextClass}>
                      {readyForGoLive
                        ? 'Your storefront can now resolve product IDs through confirmed garment mappings.'
                        : 'Keep the SDK in preview mode until at least one garment is confirmed.'}
                    </p>
                  </div>
                </div>
                {matchStatusMessage ? <p className={`text-xs mt-4 ${mutedTextClass}`}>{matchStatusMessage}</p> : null}
              </div>

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
                    <p className={`text-sm ${mutedTextClass}`}>Garment asset</p>
                    <p className={`text-base font-semibold ${strongTextClass}`}>{g.displayName || g.productName || humanizeGarmentId(g.garmentId)}</p>
                    <p className={`text-xs font-mono mt-1 ${mutedTextClass}`}>{g.garmentId}</p>
                    {g.category ? <p className={`text-xs mt-1 ${mutedTextClass}`}>Category: {g.category}</p> : null}
                    <p className={`text-xs mt-2 ${mutedTextClass}`}>Validation status: {g.status}</p>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>Suggested product: {g.suggestedProductName || g.suggestedProductId || 'No confident suggestion yet'}</p>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>Confirmed product: {g.confirmedProductName || g.confirmedProductId || 'Not confirmed yet'}</p>
                    {g.matchConfidence ? (
                      <p className={`text-xs mt-1 ${mutedTextClass}`}>Match confidence: {Math.round(g.matchConfidence * 100)}%</p>
                    ) : null}
                    {g.matchReason ? <p className={`text-xs mt-2 ${mutedTextClass}`}>{g.matchReason}</p> : null}
                    <div className="mt-4 flex flex-col gap-3">
                      <select
                        value={selectedProducts[g.garmentId] || ''}
                        onChange={(e) =>
                          setSelectedProducts((current) => ({
                            ...current,
                            [g.garmentId]: e.target.value,
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="">Choose discovered product</option>
                        {catalogProducts.map((product) => (
                          <option key={product.productId} value={product.productId}>
                            {product.productName ? `${product.productName} (${product.productId})` : product.productId}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => handleConfirmMatch(g.garmentId)}
                          disabled={!catalogProducts.length || activeMatchGarmentId === g.garmentId}
                          className={actionClass}
                        >
                          {activeMatchGarmentId === g.garmentId ? 'Saving...' : 'Confirm Mapping'}
                        </button>
                        {g.confirmedProductId ? (
                          <button
                            onClick={() => handleClearConfirmedMatch(g.garmentId)}
                            disabled={activeMatchGarmentId === g.garmentId}
                            className={actionClass}
                          >
                            Clear Confirmation
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div id="plugin-demo" className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-4">Try-On Modal Preview</h2>
          <p className={`mb-4 ${mutedTextClass}`}>This is the milestone to aim for first: one believable internal preview before anything goes live on your store.</p>
          <div className={panelClass}>
            <div id="drapixai-dashboard-demo"></div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold">Storefront Install Snippet</h2>
            <Link href="/help" className={`inline-flex items-center gap-2 ${actionClass}`}>
              <ExternalLink className="w-4 h-4" />
              Open Full Help
            </Link>
          </div>
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
