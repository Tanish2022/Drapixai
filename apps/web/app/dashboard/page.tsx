'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ArrowRight, CheckCircle2, Copy, ExternalLink, KeyRound, Sparkles, Store, UploadCloud, Wand2 } from 'lucide-react';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';
import { useThemePreference } from '@/app/lib/theme-client';
import WorkspaceHeader from '@/app/components/WorkspaceHeader';

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
  cacheReadyGarmentCount?: number;
  discoveredProductCount?: number;
  suggestedMatchCount?: number;
  confirmedMatchCount?: number;
  approvedTryOnResultCount?: number;
  warningFreeTryOnCount?: number;
  excellentTryOnCount?: number;
  averageLatencyMs?: number | null;
  averageQualityScore?: number | null;
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

const dashboardApiPath = (path: string) => '/api/dashboard/proxy/' + path.replace(/^\/+/, '');

const humanizeGarmentId = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const garmentCategoryOptions = [
  { value: '', label: 'Auto-detect from file name' },
  { value: 'Shirt', label: 'Shirt' },
  { value: 'T-Shirt', label: 'T-Shirt' },
  { value: 'Polo', label: 'Polo' },
  { value: 'Blouse', label: 'Blouse' },
  { value: 'Top', label: 'Top' },
  { value: 'Short Kurti', label: 'Short Kurti (beta)' },
  { value: 'Hoodie', label: 'Hoodie (beta)' },
  { value: 'Sweatshirt', label: 'Sweatshirt (beta)' },
  { value: 'Jeans', label: 'Jeans (lower-body V1)' },
  { value: 'Pants', label: 'Pants (lower-body V1)' },
  { value: 'Trousers', label: 'Trousers (lower-body V1)' },
  { value: 'Shorts', label: 'Shorts (lower-body V1)' },
  { value: 'Skirt', label: 'Skirt (lower-body V1)' },
  { value: 'Leggings', label: 'Leggings (lower-body V1)' },
  { value: 'Joggers', label: 'Joggers (lower-body V1)' },
];

export default function Dashboard() {
  const themePreference = useThemePreference();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [storefrontApiKey, setStorefrontApiKey] = useState('');
  const [storefrontKeyExists, setStorefrontKeyExists] = useState(false);
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [garmentUploadId, setGarmentUploadId] = useState('');
  const [garmentUploadCategory, setGarmentUploadCategory] = useState('');
  const [garmentUploadType, setGarmentUploadType] = useState<'upper' | 'lower'>('upper');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentStatus, setGarmentStatus] = useState('');
  const [catalogCsvFile, setCatalogCsvFile] = useState<File | null>(null);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState('');
  const [bulkGarmentFiles, setBulkGarmentFiles] = useState<File[]>([]);
  const [bulkGarmentType, setBulkGarmentType] = useState<'upper' | 'lower'>('upper');
  const [bulkGarmentStatus, setBulkGarmentStatus] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [matchStatusMessage, setMatchStatusMessage] = useState('');
  const [activeMatchGarmentId, setActiveMatchGarmentId] = useState('');
  const [toast, setToast] = useState('');
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const router = useRouter();
  const previewProductId = useMemo(
    () => garments.find((garment) => garment.status === 'ready' && garment.cacheKey && garment.confirmedProductId)?.confirmedProductId || '',
    [garments]
  );

  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#f4f6f2] text-[#172019]' : 'min-h-screen bg-[#0f1511] text-[#edf2ed]';
  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'border border-black/10 bg-white p-6'
        : 'border border-white/10 bg-[#151c17] p-6',
    [themePreference]
  );
  const panelClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'border border-black/10 bg-[#f4f6f2] p-4'
        : 'border border-white/10 bg-[#101712] p-4',
    [themePreference]
  );
  const subtleCardClass =
    themePreference === 'light'
      ? 'border border-black/10 bg-white p-6'
      : 'border border-white/10 bg-[#151c17] p-6';
  const inputClass =
    themePreference === 'light'
      ? 'flex-1 border border-black/15 bg-white p-3 font-mono text-sm text-[#172019]'
      : 'flex-1 border border-white/10 bg-[#101712] p-3 font-mono text-sm';
  const mutedTextClass = themePreference === 'light' ? 'text-[#68736b]' : 'text-[#aab6ac]';
  const strongTextClass = themePreference === 'light' ? 'text-[#172019]' : 'text-white';
  const actionClass =
    themePreference === 'light'
      ? 'border border-black/15 bg-white px-4 py-2 text-[#172019] transition-colors hover:bg-[#eef2ed]'
      : 'border border-white/10 bg-[#1b251e] px-4 py-2 transition-colors hover:bg-[#253229]';

  const refreshGarments = async () => {
    const data = await fetch(dashboardApiPath('sdk/garments'))
      .then((res) => res.json())
      .catch(() => ({ items: [] }));
    setGarments(data.items || []);
  };

  const refreshCatalog = async () => {
    const data = await fetch(dashboardApiPath('sdk/catalog'))
      .then((res) => res.json())
      .catch(() => ({ items: [] }));
    setCatalogProducts(data.items || []);
  };

  const refreshUsage = async () => {
    const res = await fetch(dashboardApiPath('analytics/summary'));
    if (res.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    const data = await res.json();
    setUsage(data);
  };

  const refreshStorefrontKeyStatus = async () => {
    const response = await fetch(dashboardApiPath('analytics/api-key/status'), { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json().catch(() => null)) as { exists?: boolean } | null;
    setStorefrontKeyExists(Boolean(data?.exists));
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
          cache: 'no-store'
    });

        if (sessionResponse.ok) {
          const data = (await sessionResponse.json().catch(() => null)) as { ok?: boolean } | null;
          if (active && data?.ok) {
            setApiKey('dashboard-session');
            setIsBootstrapping(false);
            return;
          }
        }
      } catch {
        // ignore and redirect below
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

    Promise.all([refreshUsage(), refreshGarments(), refreshCatalog(), refreshStorefrontKeyStatus()]).catch(async (error: Error) => {
      if (error.message === 'UNAUTHORIZED') {
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
          const res = await fetch(dashboardApiPath(`sdk/garments/${encodeURIComponent(g.garmentId)}/thumbnail`));
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
    if (!previewProductId) return;
    let cancelled = false;
    const container = document.getElementById('drapixai-dashboard-demo');
    if (!container) return;

    let script = document.getElementById('drapixai-sdk') as HTMLScriptElement | null;
    let resolveSdkLoad: (() => void) | null = null;
    let rejectSdkLoad: (() => void) | null = null;

    const loadSdk = () => new Promise<void>((resolve, reject) => {
      if (window.DrapixAI) {
        resolve();
        return;
      }
      resolveSdkLoad = resolve;
      rejectSdkLoad = () => reject(new Error('SDK_LOAD_FAILED'));
      if (!script) {
        script = document.createElement('script');
        script.id = 'drapixai-sdk';
        script.src = getSdkScriptUrl();
        script.async = true;
        document.body.appendChild(script);
      }
      script.addEventListener('load', resolveSdkLoad, { once: true });
      script.addEventListener('error', rejectSdkLoad, { once: true });
    });

    const preparePreview = async () => {
      setPreviewStatus('loading');
      setPreviewError('');
      const previewResponse = await fetch(dashboardApiPath('analytics/sdk-preview-token'), { method: 'POST' });
      const previewPayload = (await previewResponse.json().catch(() => null)) as { token?: string } | null;
      if (!previewResponse.ok || !previewPayload?.token) {
        throw new Error('PREVIEW_TOKEN_FAILED');
      }
      await loadSdk();
      if (cancelled || !window.DrapixAI) return;
      await Promise.resolve(window.DrapixAI.init({
        storefrontToken: previewPayload.token,
        productId: previewProductId,
        containerId: 'drapixai-dashboard-demo',
        baseUrl: PUBLIC_API_BASE_URL,
        garmentType: 'upper',
        quality: 'standard',
        enableDownload: true,
      }));
      if (!cancelled) setPreviewStatus('ready');
    };
    preparePreview().catch((error: unknown) => {
      if (!cancelled) {
        setPreviewStatus('error');
        setPreviewError(error instanceof Error ? error.message : 'PREVIEW_INIT_FAILED');
      }
    });

    return () => {
      cancelled = true;
      if (resolveSdkLoad) script?.removeEventListener('load', resolveSdkLoad);
      if (rejectSdkLoad) script?.removeEventListener('error', rejectSdkLoad);
      container.replaceChildren();
    };
  }, [previewProductId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleLogout = () => {
    fetch('/api/dashboard/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
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

      const res = await fetch(dashboardApiPath('sdk/catalog/sync'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items })
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
      await Promise.all([refreshUsage(), refreshGarments(), refreshCatalog()]);
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

    setBulkGarmentStatus(`Uploading ${bulkGarmentType === 'lower' ? 'lower-body V1' : 'upper-body'} garments...`);

    const form = new FormData();
    form.append('garment_type', bulkGarmentType);
    bulkGarmentFiles.forEach((file) => {
      form.append('cloth_images', file);
    });

    const res = await fetch(dashboardApiPath('sdk/garments/bulk'), {
      method: 'POST',

      body: form
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
    const betaCount = items.filter((item: { supportLevel?: string }) => item.supportLevel === 'beta' || item.supportLevel === 'future_lower_beta').length;
    setBulkGarmentStatus(
      failedCount && firstFailure
        ? `Uploaded ${successCount} garments. ${failedCount} file(s) failed. ${getApiErrorMessage(firstFailure, 'Review the rejected uploads and use isolated garment-only images.')}`
        : `Uploaded ${successCount} garments.${betaCount ? ` ${betaCount} beta-category item(s) still need closer preview review.` : ''}${failedCount ? ` ${failedCount} files still need cleaner garment assets.` : ''}`
    );
    setToast(`Bulk upload complete. ${successCount} garments are now ready for matching.`);
    setBulkGarmentFiles([]);
    await Promise.all([refreshUsage(), refreshGarments(), refreshCatalog()]);
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
      const res = await fetch(dashboardApiPath(`sdk/matches/${encodeURIComponent(garmentId)}/confirm`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId })
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
      await Promise.all([refreshUsage(), refreshGarments(), refreshCatalog()]);
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
      const res = await fetch(dashboardApiPath(`sdk/matches/${encodeURIComponent(garmentId)}/confirm`), {
        method: 'DELETE'
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
      await Promise.all([refreshUsage(), refreshGarments(), refreshCatalog()]);
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
  const hasCacheReady = (usage.cacheReadyGarmentCount || 0) > 0 || garments.some((g) => Boolean(g.cacheKey) && g.status === 'ready');
  const hasSuggestedMatches = (usage.suggestedMatchCount || 0) > 0;
  const hasConfirmedMappings = (usage.confirmedMatchCount || 0) > 0;
  const hasSdkPreviewResult = (usage.recentRenders || []).some((render) => render.status === 'complete') || usage.rendersUsed > 0;
  const hasApprovedTryOnResult = (usage.approvedTryOnResultCount || 0) > 0;
  const hasWarningFreeExamples = (usage.warningFreeTryOnCount || 0) > 0;
  const readyForPreview = hasConfirmedMappings;
  const readyForGoLive = hasVerifiedStore && hasConfirmedMappings && hasCacheReady && hasApprovedTryOnResult && hasWarningFreeExamples;
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
      actionLabel: readyForPreview ? 'Open SDK Install' : 'Preview First',
      actionHref: readyForPreview ? '/sdk-install' : '#plugin-demo',
    },
  ];
  const completedOnboardingSteps = onboardingSteps.filter((step) => step.done).length;
  const onboardingProgress = Math.round((completedOnboardingSteps / onboardingSteps.length) * 100);
  const currentOnboardingStep = onboardingSteps.find((step) => !step.done) || onboardingSteps[onboardingSteps.length - 1];
  const brandLaunchChecklist = [
    {
      label: 'Upload garment assets',
      done: hasGarments,
      detail: `${usage.uploadedGarmentCount || garments.length || 0} garment asset(s) uploaded`,
      href: '#garment-onboarding',
    },
    {
      label: 'Cache ready',
      done: hasCacheReady,
      detail: `${usage.cacheReadyGarmentCount || garments.filter((g) => Boolean(g.cacheKey) && g.status === 'ready').length || 0} ready cached asset(s)`,
      href: '#garment-onboarding',
    },
    {
      label: 'Sync product catalog',
      done: hasCatalogSynced,
      detail: `${usage.discoveredProductCount || 0} product(s) discovered`,
      href: '#garment-onboarding',
    },
    {
      label: 'Confirm mappings',
      done: hasConfirmedMappings,
      detail: `${usage.confirmedMatchCount || 0} confirmed product mapping(s)`,
      href: '#mapping-flow',
    },
    {
      label: 'Test SDK preview',
      done: hasSdkPreviewResult,
      detail: hasSdkPreviewResult ? 'At least one preview request has run' : 'Run one internal preview before live install',
      href: '#plugin-demo',
    },
    {
      label: 'Approve first results',
      done: hasApprovedTryOnResult,
      detail: `${usage.approvedTryOnResultCount || 0} approved try-on result(s)`,
      href: '/admin',
    },
    {
      label: 'Warning-free examples',
      done: hasWarningFreeExamples,
      detail: `${usage.warningFreeTryOnCount || 0} warning-free recent example(s)`,
      href: '/admin',
    },
    {
      label: 'Install live SDK',
      done: readyForGoLive,
      detail: readyForGoLive ? 'Ready for controlled storefront rollout' : 'Wait until cache, mappings, preview, approval, and warning-free examples are complete',
      href: '/sdk-install',
    },
  ];
  const completedLaunchChecklist = brandLaunchChecklist.filter((item) => item.done).length;

  return (
    <div className={pageClass}>
      {toast ? (
        <div className="fixed right-6 top-24 z-50 border border-[#9bb6a8] bg-[#eaf0e9] px-4 py-3 text-sm font-semibold text-[#183f32] shadow-lg">
          {toast}
        </div>
      ) : null}
      <WorkspaceHeader active="dashboard" onLogout={handleLogout} />

      <main className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="mb-8">
          <p className={`mb-3 text-xs font-bold uppercase ${themePreference === 'light' ? 'text-[#31725b]' : 'text-[#7fb29a]'}`}>Onboarding workspace</p>
          <h1 className="mb-3 max-w-4xl font-serif text-4xl leading-tight">From garment upload to a confirmed live product.</h1>
          <p className={`max-w-3xl text-base ${mutedTextClass}`}>
            The launch story is now: upload garments, discover products, review suggested matches, confirm the right pairings, then let the SDK use only those confirmed mappings on the storefront.
          </p>
        </div>

        {isQuotaExhausted ? (
          <div className={`p-5 mb-8 border rounded-md ${themePreference === 'light' ? 'border-rose-200 bg-rose-50' : 'border-rose-400/30 bg-rose-500/10'}`}>
            <p className={`text-xs font-bold uppercase ${themePreference === 'light' ? 'text-rose-700' : 'text-rose-200'}`}>Plan limit reached</p>
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
          <div className={`mb-8 border p-4 ${themePreference === 'light' ? 'border-[#9bb6a8] bg-[#e8f0eb]' : 'border-[#40624f] bg-[#1b2a20]'}`}>
            <p className={`text-sm ${themePreference === 'light' ? 'text-[#183f32]' : 'text-[#cbe0d1]'}`}>
              Trial active: {usage.trialDaysLeft} day(s) left. You have {usage.quotaRemaining} try-ons remaining to validate product quality, onboarding, and storefront flow before scaling usage.
            </p>
            {usage.selectedPlanName ? (
              <p className={`mt-2 text-xs ${themePreference === 'light' ? 'text-[#3f6552]' : 'text-[#9fc2ad]'}`}>
                Selected paid plan after trial: {usage.selectedPlanName}
              </p>
            ) : null}
          </div>
        ) : isQuotaLow ? (
          <div className={`p-4 mb-8 border rounded-md ${themePreference === 'light' ? 'border-amber-200 bg-amber-50' : 'border-amber-400/30 bg-amber-500/10'}`}>
            <p className={`text-sm ${themePreference === 'light' ? 'text-amber-900' : 'text-amber-100'}`}>
              Usage warning: only {usage.quotaRemaining} try-ons remain in this period. If you expect more internal previews or live traffic soon, upgrade before rollout stalls.
            </p>
          </div>
        ) : null}

        <section className={`${cardClass} mb-8`}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="w-6 h-6 text-[#31725b]" />
                <h2 className="text-xl font-bold">Brand launch checklist</h2>
              </div>
              <p className={`text-sm ${mutedTextClass}`}>
                Use this as the brand onboarding gate before live customer traffic. It keeps the launch path simple and makes missing work visible.
              </p>
            </div>
            <div className={`${panelClass} min-w-[180px]`}>
              <p className={`text-sm ${mutedTextClass}`}>Launch readiness</p>
              <p className={`text-2xl font-bold ${strongTextClass}`}>{completedLaunchChecklist} / {brandLaunchChecklist.length}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {brandLaunchChecklist.map((item) => (
              <Link key={item.label} href={item.href} className={`${panelClass} block transition-transform hover:-translate-y-0.5`}>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className={`w-5 h-5 mt-0.5 ${item.done ? 'text-emerald-400' : 'text-gray-600'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${item.done ? strongTextClass : mutedTextClass}`}>{item.label}</p>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>{item.detail}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
            <div className={panelClass}>
              <p className={`text-xs font-bold uppercase ${mutedTextClass}`}>Avg quality</p>
              <p className={`text-xl font-bold mt-2 ${strongTextClass}`}>{typeof usage.averageQualityScore === 'number' ? usage.averageQualityScore.toFixed(2) : 'n/a'}</p>
            </div>
            <div className={panelClass}>
              <p className={`text-xs font-bold uppercase ${mutedTextClass}`}>Avg latency</p>
              <p className={`text-xl font-bold mt-2 ${strongTextClass}`}>{typeof usage.averageLatencyMs === 'number' ? `${(usage.averageLatencyMs / 1000).toFixed(1)}s` : 'n/a'}</p>
            </div>
            <div className={panelClass}>
              <p className={`text-xs font-bold uppercase ${mutedTextClass}`}>Warning-free</p>
              <p className={`text-xl font-bold mt-2 ${strongTextClass}`}>{usage.warningFreeTryOnCount || 0}</p>
            </div>
            <div className={panelClass}>
              <p className={`text-xs font-bold uppercase ${mutedTextClass}`}>Excellent</p>
              <p className={`text-xl font-bold mt-2 ${strongTextClass}`}>{usage.excellentTryOnCount || 0}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 mb-8">
          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 text-[#31725b]" />
              <h2 className="text-xl font-bold">Brand onboarding wizard</h2>
            </div>
            <p className={`text-sm mb-5 ${mutedTextClass}`}>
              Ignore full rollout for a moment. The fastest path is: save your store, add a few products, upload clean garment assets, then preview internally.
            </p>
            <div className={`${panelClass} mb-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <p className={`text-sm ${mutedTextClass}`}>Progress</p>
                  <p className={`text-lg font-semibold ${strongTextClass}`}>{completedOnboardingSteps} of {onboardingSteps.length} launch steps complete</p>
                </div>
                <Link href={currentOnboardingStep.actionHref} className={`inline-flex items-center gap-2 ${actionClass}`}>
                  {currentOnboardingStep.actionLabel}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              <div className={`h-2 rounded-full overflow-hidden ${themePreference === 'light' ? 'bg-slate-200' : 'bg-white/10'}`}>
                <progress
                  className="onboarding-progress h-full w-full"
                  value={onboardingProgress}
                  max={100}
                  aria-label="Onboarding progress"
                />
              </div>
            </div>
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
                  <Link href={step.actionHref} className={`mt-4 inline-flex items-center gap-2 text-sm ${themePreference === 'light' ? 'text-[#246048] hover:text-[#183f32]' : 'text-[#8fc4a8] hover:text-[#b4d8c3]'}`}>
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
              <CheckCircle2 className="w-6 h-6 text-[#31725b]" />
              <h2 className="text-xl font-bold">What success looks like</h2>
            </div>
            <p className={`text-sm mb-4 ${mutedTextClass}`}>
              Keep the early goal simple: get one believable internal preview first. Full storefront setup should happen only after this checklist feels solid.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Garments uploaded', done: hasGarments },
                { label: 'Preprocessing complete', done: garments.some((g) => g.status !== 'missing') },
                { label: 'Try-on cache ready', done: hasCacheReady },
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

        <div id="storefront-key-controls" className={`${cardClass} mb-8`}>
          <h2 className="text-xl font-bold mb-2">Technical install details</h2>
          <p className={`mb-4 ${mutedTextClass}`}>The domain-bound storefront key is separate from your dashboard session, so signing in again will not break an installed widget. A new secret is shown only when it is created or rotated.</p>
          <div className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              value={storefrontApiKey || (storefrontKeyExists ? 'Active storefront key hidden' : 'No storefront key created')}
              readOnly
              className={inputClass}
            />
            <button
              type="button"
              disabled={!storefrontApiKey}
              onClick={() => navigator.clipboard.writeText(storefrontApiKey).then(() => setToast('Storefront key copied.'))}
              className={actionClass}
            >
              <span className="inline-flex items-center gap-2"><Copy className="w-4 h-4" />Copy</span>
            </button>
            <button
              onClick={async () => {
                const res = await fetch(dashboardApiPath('analytics/api-key/rotate'), {
                  method: 'POST'
    });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.apiKey) {
                  setToast('Unable to create the storefront key right now.');
                  return;
                }
                setStorefrontApiKey(data.apiKey);
                setStorefrontKeyExists(true);
                setToast(storefrontKeyExists ? 'Storefront key rotated. Update the installed widget with this new key.' : 'Storefront key created. Copy it now.');
              }}
              className={actionClass}
            >
              <span className="inline-flex items-center gap-2"><KeyRound className="w-4 h-4" />{storefrontKeyExists ? 'Rotate' : 'Create'}</span>
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
                const res = await fetch(dashboardApiPath('analytics/domain'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ domain: value })
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
            <UploadCloud className="w-6 h-6 text-[#31725b]" />
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
                      <Link href={dashboardApiPath(`sdk/result/${render.id}`)} className="text-sm text-[#8fc4a8] hover:text-[#b4d8c3]">
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
            Upper-body remains the production path. Lower-body V1 assets can be tested only when the server-side beta flag is enabled; those uploads stay review-gated before any public rollout.
          </p>
          <div id="mapping-flow" className={`mb-6 ${panelClass}`}>
            <p className={`text-sm font-medium mb-3 ${strongTextClass}`}>Confirmed mapping flow for brands</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              {[
                {
                  title: '1. Garment uploaded',
                  body: 'Brands upload garment-only assets. DrapixAI stores the original so caches can be regenerated after model or resolution upgrades.',
                },
                {
                  title: '2. Preprocessing complete',
                  body: 'The AI service validates the image, removes weak backgrounds when needed, and normalizes the garment for upper-body try-on.',
                },
                {
                  title: '3. Try-on cache ready',
                  body: 'A high-quality cached try-on asset is generated during onboarding, currently at v3-1024x1365, so shopper requests stay fast.',
                },
                {
                  title: '4. Approved or rejected',
                  body: 'Admins can approve launch-ready garments or reject weak assets before they reach a brand storefront.',
                },
                {
                  title: '5. Regenerate cache when needed',
                  body: 'After RunPod upgrades, use the cache regeneration command to rebuild stored garment assets and mark failures for review.',
                },
              ].map((item) => (
                <div key={item.title} className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
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
                Upload multiple garment files at once. DrapixAI validates the assets first, then uses catalog discovery to move toward suggested matches and later manual confirmation.
              </p>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setBulkGarmentFiles(Array.from(e.target.files || []))}
                className={`p-2 text-sm ${mutedTextClass}`}
              />
              <select
                value={bulkGarmentType}
                onChange={(e) => setBulkGarmentType(e.target.value === 'lower' ? 'lower' : 'upper')}
                className={`${inputClass} mt-3 w-full`}
              >
                <option value="upper">Upper-body production</option>
                <option value="lower">Lower-body V1 beta</option>
              </select>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-sm">
              <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-emerald-100 bg-emerald-50/70' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>Launch-ready</p>
                <p className={mutedTextClass}>Shirts, T-shirts, polos, blouses, and clean tops usually give the strongest 2D realism.</p>
              </div>
              <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-amber-100 bg-amber-50/70' : 'border-amber-500/20 bg-amber-500/10'}`}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>Beta</p>
                <p className={mutedTextClass}>Short kurtis, hoodies, and sweatshirts are still supported, but they need cleaner assets and closer review.</p>
              </div>
              <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-rose-100 bg-rose-50/70' : 'border-rose-500/20 bg-rose-500/10'}`}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>Blocked</p>
                <p className={mutedTextClass}>Long kurtas, jackets, blazers, coats, cardigans, and layered outerwear are rejected for now because they still hurt realism.</p>
              </div>
            </div>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={garmentUploadId}
                onChange={(e) => setGarmentUploadId(e.target.value)}
                placeholder="asset label (optional)"
                className={inputClass}
              />
              <select
                value={garmentUploadCategory}
                onChange={(e) => setGarmentUploadCategory(e.target.value)}
                className={inputClass}
              >
                {garmentCategoryOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={garmentUploadType}
                onChange={(e) => setGarmentUploadType(e.target.value === 'lower' ? 'lower' : 'upper')}
                className={inputClass}
              >
                <option value="upper">Upper-body production</option>
                <option value="lower">Lower-body V1 beta</option>
              </select>
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
                  if (garmentUploadCategory.trim()) {
                    form.append('category', garmentUploadCategory.trim());
                  }
                  form.append('garment_type', garmentUploadType);
                  form.append('cloth_image', garmentFile);
                  const res = await fetch(dashboardApiPath('sdk/garments'), {
                    method: 'POST',

                    body: form
    });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    const message = getApiErrorMessage(data, 'Upload failed.');
                    setGarmentStatus(message);
                    setToast(message);
                    return;
                  }
                  const warningSuffix =
                    Array.isArray(data?.warnings) && data.warnings.length
                      ? ' This category is still beta, so review the preview carefully before using it live.'
                      : '';
                  setGarmentStatus(
                    `Uploaded ${data?.displayName || data?.garmentId || 'garment'} as ${data?.category || garmentUploadCategory || 'an upper-body garment'} and refreshed suggestions.${warningSuffix}`
                  );
                  setToast('Garment uploaded successfully.');
                  setGarmentUploadId('');
                  setGarmentUploadCategory('');
                  setGarmentFile(null);
                  await Promise.all([refreshUsage(), refreshGarments(), refreshCatalog()]);
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
                  <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                    <p className={`font-medium mb-2 ${strongTextClass}`}>Suggested matches</p>
                    <p className={mutedTextClass}>
                      {hasSuggestedMatches
                        ? `${usage.suggestedMatchCount || 0} garment${(usage.suggestedMatchCount || 0) === 1 ? '' : 's'} currently have a product suggestion.`
                        : 'Suggestions appear after at least one garment is validated and catalog discovery has run.'}
                    </p>
                  </div>
                  <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
                    <p className={`font-medium mb-2 ${strongTextClass}`}>Manual confirmation</p>
                    <p className={mutedTextClass}>
                      {hasConfirmedMappings
                        ? `${usage.confirmedMatchCount || 0} garment${(usage.confirmedMatchCount || 0) === 1 ? '' : 's'} are confirmed for storefront use.`
                        : 'A human still needs to approve the final pairings before the storefront depends on them.'}
                    </p>
                  </div>
                  <div className={`rounded-md border p-4 ${themePreference === 'light' ? 'border-sky-100 bg-white/80' : 'border-white/10 bg-black/20'}`}>
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full border ${themePreference === 'light' ? 'border-sky-100 bg-sky-50 text-slate-700' : 'border-white/10 bg-white/5 text-gray-300'}`}>
                        Garment uploaded
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full border ${g.status !== 'missing' ? (themePreference === 'light' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200') : (themePreference === 'light' ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-amber-500/20 bg-amber-500/10 text-amber-200')}`}>
                        Preprocessing {g.status !== 'missing' ? 'complete' : 'pending'}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full border ${g.cacheKey && g.status === 'ready' ? (themePreference === 'light' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200') : (themePreference === 'light' ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-amber-500/20 bg-amber-500/10 text-amber-200')}`}>
                        Try-on cache {g.cacheKey && g.status === 'ready' ? 'ready' : 'needs review'}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full border ${g.status === 'rejected' ? (themePreference === 'light' ? 'border-rose-100 bg-rose-50 text-rose-800' : 'border-rose-500/20 bg-rose-500/10 text-rose-200') : g.status === 'ready' ? (themePreference === 'light' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200') : (themePreference === 'light' ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-amber-500/20 bg-amber-500/10 text-amber-200')}`}>
                        {g.status === 'rejected' ? 'Rejected' : g.status === 'ready' ? 'Approved' : 'Awaiting review'}
                      </span>
                    </div>
                    <p className={`text-xs mt-2 ${mutedTextClass}`}>Raw status: {g.status}</p>
                    {g.cacheKey ? <p className={`text-xs mt-1 font-mono ${mutedTextClass}`}>Cache: {g.cacheKey}</p> : null}
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
                            [g.garmentId]: e.target.value
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
            {previewProductId ? (
              <div data-preview-status={previewStatus} aria-live="polite">
                <div id="drapixai-dashboard-demo"></div>
                {previewStatus === 'loading' ? <p className={`mt-3 text-sm ${mutedTextClass}`}>Loading secure SDK preview...</p> : null}
                {previewStatus === 'ready' ? <p className={`mt-3 text-sm ${mutedTextClass}`}>Secure SDK preview ready.</p> : null}
                {previewStatus === 'error' ? (
                  <p role="alert" className="mt-3 text-sm text-rose-500">Preview unavailable: {previewError}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className={`font-semibold ${strongTextClass}`}>Confirm a ready product mapping to unlock preview</p>
                  <p className={`mt-1 text-sm ${mutedTextClass}`}>DrapixAI uses a short-lived preview credential; permanent dashboard and storefront keys stay private.</p>
                </div>
                <button
                  type="button"
                  onClick={() => document.getElementById('garment-onboarding')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={actionClass}
                >
                  Open product prep
                </button>
              </div>
            )}
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
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    productId: 'your-product-id',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper',
    quality: 'standard',
    timeoutMs: 20000,
    enableDownload: true
  });
</script>

<!-- Auto-attach mode -->
<div data-drapix-product-id="shirt-001">
  <div data-drapix-button-slot></div>
</div>
<script>
  DrapixAI.init({
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    autoAttach: true,
    productSelector: '[data-drapix-product-id]',
    productIdAttribute: 'data-drapix-product-id',
    buttonTargetSelector: '[data-drapix-button-slot]',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper',
    quality: 'standard',
    timeoutMs: 20000,
    enableDownload: true
  });
</script>`}
          </pre>
        </div>
      </main>
    </div>
  );
}
