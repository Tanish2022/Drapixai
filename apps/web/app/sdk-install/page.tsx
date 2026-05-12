'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Code2, Copy, ExternalLink, KeyRound, ShieldCheck, Store } from 'lucide-react';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';
import { useThemePreference } from '@/app/lib/theme-client';

type UsageData = {
  email?: string | null;
  companyName?: string | null;
  planName: string;
  quotaRemaining: number;
  domain?: string;
  storeVerified?: boolean;
  uploadedGarmentCount?: number;
  discoveredProductCount?: number;
  confirmedMatchCount?: number;
};

type GarmentItem = {
  garmentId: string;
  displayName?: string | null;
  confirmedProductId?: string | null;
  confirmedProductName?: string | null;
  status: string;
};

const platformTabs = ['HTML', 'Shopify', 'WooCommerce', 'React'] as const;
type PlatformTab = (typeof platformTabs)[number];

const escapeForSnippet = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export default function SdkInstallPage() {
  const themePreference = useThemePreference();
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [activeTab, setActiveTab] = useState<PlatformTab>('HTML');
  const [toast, setToast] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#edf4ff] text-slate-950' : 'min-h-screen bg-[#050816] text-white';
  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-[28px] border border-sky-100/80 bg-white/95 p-6 shadow-[0_24px_80px_rgba(71,85,105,0.12)]'
        : 'rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-6',
    [themePreference]
  );
  const panelClass =
    themePreference === 'light'
      ? 'rounded-2xl border border-sky-100 bg-sky-50/70 p-4'
      : 'rounded-2xl border border-white/[0.08] bg-black/20 p-4';
  const mutedTextClass = themePreference === 'light' ? 'text-slate-600' : 'text-gray-400';
  const strongTextClass = themePreference === 'light' ? 'text-slate-950' : 'text-white';
  const actionClass =
    themePreference === 'light'
      ? 'rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm text-slate-900 transition-colors hover:bg-sky-50'
      : 'rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20';

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const sessionResponse = await fetch('/api/dashboard/session', { cache: 'no-store' });
        if (!sessionResponse.ok) {
          router.replace('/auth/login?next=/sdk-install');
          return;
        }
        const session = (await sessionResponse.json().catch(() => null)) as { apiKey?: string } | null;
        const nextApiKey = session?.apiKey?.trim() || '';
        if (!nextApiKey) {
          router.replace('/auth/login?next=/sdk-install');
          return;
        }

        const [summaryResponse, garmentsResponse] = await Promise.all([
          fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, {
            headers: { Authorization: `Bearer ${nextApiKey}` },
          }),
          fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
            headers: { Authorization: `Bearer ${nextApiKey}` },
          }),
        ]);

        if (!summaryResponse.ok) {
          throw new Error('SUMMARY_FAILED');
        }

        const summary = (await summaryResponse.json().catch(() => null)) as UsageData | null;
        const garmentPayload = (await garmentsResponse.json().catch(() => ({ items: [] }))) as { items?: GarmentItem[] };
        if (!active) return;

        setApiKey(nextApiKey);
        setUsage(summary);
        setGarments(garmentPayload.items || []);
      } catch {
        if (active) {
          router.replace('/auth/login?next=/sdk-install');
        }
      } finally {
        if (active) setIsLoading(false);
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

  const confirmedGarments = garments.filter((garment) => garment.confirmedProductId);
  const sampleProductId = confirmedGarments[0]?.confirmedProductId || 'your-product-id';
  const safeApiKey = escapeForSnippet(apiKey || 'YOUR_API_KEY');
  const safeBaseUrl = escapeForSnippet(PUBLIC_API_BASE_URL);
  const safeSdkUrl = getSdkScriptUrl();
  const safeProductId = escapeForSnippet(sampleProductId);
  const installReady = Boolean(usage?.storeVerified && confirmedGarments.length > 0);

  const snippets: Record<PlatformTab, string> = {
    HTML: `<script src="${safeSdkUrl}"></script>

<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: '${safeApiKey}',
    productId: '${safeProductId}',
    containerId: 'drapixai-container',
    baseUrl: '${safeBaseUrl}',
    garmentType: 'upper',
    quality: 'standard',
    timeoutMs: 20000,
    onResult: function (metadata) {
      console.log('DrapixAI result', metadata);
    },
    onError: function (error) {
      console.warn('DrapixAI error', error.message);
    }
  });
</script>`,
    Shopify: `<script src="${safeSdkUrl}"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    DrapixAI.init({
      apiKey: '${safeApiKey}',
      productId: '{{ product.id }}',
      baseUrl: '${safeBaseUrl}',
      garmentType: 'upper',
      quality: 'standard',
      buttonText: 'Try On',
      autoAttach: true,
      productSelector: '[data-drapix-product-id]',
      productIdAttribute: 'data-drapix-product-id',
      buttonTargetSelector: '[data-drapix-button-slot]'
    });
  });
</script>

<!-- Add this inside the Shopify product template -->
<div data-drapix-product-id="{{ product.id }}">
  <div data-drapix-button-slot></div>
</div>`,
    WooCommerce: `<script src="${safeSdkUrl}"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    DrapixAI.init({
      apiKey: '${safeApiKey}',
      productId: String(window.drapixaiProductId || ''),
      baseUrl: '${safeBaseUrl}',
      garmentType: 'upper',
      quality: 'standard',
      autoAttach: true,
      productSelector: '[data-drapix-product-id]',
      productIdAttribute: 'data-drapix-product-id',
      buttonTargetSelector: '[data-drapix-button-slot]'
    });
  });
</script>

<!-- Add this in the WooCommerce product template -->
<div data-drapix-product-id="<?php echo esc_attr(get_the_ID()); ?>">
  <div data-drapix-button-slot></div>
</div>`,
    React: `import DrapixAITryOn from '@/app/components/DrapixAITryOn';

export default function ProductTryOn() {
  return (
    <DrapixAITryOn
      apiKey="${safeApiKey}"
      productId="${safeProductId}"
      baseUrl="${safeBaseUrl}"
      garmentType="upper"
      quality="standard"
      buttonText="Try On"
      timeoutMs={20000}
      onResult={(metadata) => console.log(metadata)}
      onError={(error) => console.warn(error.message)}
    />
  );
}`,
  };

  const copyText = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    setToast(message);
  };

  if (isLoading || !usage) {
    return (
      <main className={`${pageClass} flex items-center justify-center px-6`}>
        <div className={cardClass}>
          <p className={mutedTextClass}>Loading SDK install page...</p>
        </div>
      </main>
    );
  }

  const readiness = [
    { label: 'Store domain verified', done: Boolean(usage.storeVerified), href: '/settings' },
    { label: 'Garments uploaded', done: (usage.uploadedGarmentCount || 0) > 0, href: '/dashboard#garment-onboarding' },
    { label: 'Products discovered', done: (usage.discoveredProductCount || 0) > 0, href: '/dashboard#garment-onboarding' },
    { label: 'Mappings confirmed', done: confirmedGarments.length > 0, href: '/dashboard#mapping-flow' },
  ];

  return (
    <main className={pageClass}>
      {toast ? (
        <div className="fixed right-6 top-6 z-50 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          {toast}
        </div>
      ) : null}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <Link href="/dashboard" className={`inline-flex items-center gap-2 text-sm mb-4 ${themePreference === 'light' ? 'text-cyan-700' : 'text-cyan-300'}`}>
              <ArrowLeft className="w-4 h-4" />
              Back to dashboard
            </Link>
            <p className={`text-sm uppercase tracking-[0.25em] mb-3 ${themePreference === 'light' ? 'text-cyan-700/80' : 'text-cyan-400/80'}`}>SDK Install</p>
            <h1 className="text-4xl font-bold">Copy-paste storefront install for confirmed products.</h1>
            <p className={`mt-3 max-w-3xl ${mutedTextClass}`}>
              Use this page after product-to-garment mappings are confirmed. The SDK keeps the binary image response simple while exposing quality, latency, and warning metadata.
            </p>
          </div>
          <Link href="/help" className={`inline-flex items-center gap-2 ${actionClass}`}>
            Full Docs
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 mb-8">
          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className={installReady ? 'w-6 h-6 text-emerald-400' : 'w-6 h-6 text-amber-300'} />
              <h2 className="text-xl font-bold">Install readiness</h2>
            </div>
            <p className={`text-sm mb-4 ${mutedTextClass}`}>
              {installReady
                ? 'This account has the minimum setup for a controlled SDK install.'
                : 'Finish the missing setup items before sending real shopper traffic to the widget.'}
            </p>
            <div className="space-y-3">
              {readiness.map((item) => (
                <Link key={item.label} href={item.href} className={`flex items-center justify-between gap-3 ${panelClass}`}>
                  <span className={item.done ? strongTextClass : mutedTextClass}>{item.label}</span>
                  <CheckCircle2 className={`w-5 h-5 ${item.done ? 'text-emerald-400' : 'text-slate-500'}`} />
                </Link>
              ))}
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <Store className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">Confirmed product IDs</h2>
            </div>
            {confirmedGarments.length === 0 ? (
              <div className={panelClass}>
                <p className={mutedTextClass}>No confirmed mappings yet. Confirm at least one garment-to-product pair in the dashboard before installing live.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {confirmedGarments.slice(0, 6).map((garment) => (
                  <div key={garment.garmentId} className={panelClass}>
                    <p className={`text-sm font-semibold ${strongTextClass}`}>{garment.confirmedProductName || garment.confirmedProductId}</p>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>{garment.displayName || garment.garmentId}</p>
                    <button
                      type="button"
                      onClick={() => copyText(garment.confirmedProductId || '', 'Product ID copied.')}
                      className={`mt-3 inline-flex items-center gap-2 ${actionClass}`}
                    >
                      <Copy className="w-4 h-4" />
                      Copy ID
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <Code2 className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl font-bold">Install snippet</h2>
            </div>
            <button type="button" onClick={() => copyText(snippets[activeTab], `${activeTab} snippet copied.`)} className={`inline-flex items-center gap-2 ${actionClass}`}>
              <Copy className="w-4 h-4" />
              Copy snippet
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {platformTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-2 text-sm transition-colors ${
                  activeTab === tab
                    ? 'bg-cyan-500 text-white'
                    : themePreference === 'light'
                      ? 'border border-sky-100 bg-white text-slate-700 hover:bg-sky-50'
                      : 'border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <pre className={`overflow-x-auto rounded-2xl p-5 text-sm leading-6 ${themePreference === 'light' ? 'bg-slate-950 text-slate-100' : 'bg-black/40 text-slate-100'}`}>
            <code>{snippets[activeTab]}</code>
          </pre>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Expected latency</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Warm standard try-on should aim for 10-12 seconds. SDK timeout is set to 20 seconds for network headroom.</p>
            </div>
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Metadata callback</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Use `onResult` to capture result id, quality score, latency, warnings, and timing breakdown.</p>
            </div>
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Error handling</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Use `onError` to show clean messages for missing mappings, quota limits, validation failures, or timeout.</p>
            </div>
          </div>
        </section>

        <section className={`${cardClass} mt-8`}>
          <div className="flex items-center gap-3 mb-4">
            <KeyRound className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bold">API key</h2>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              readOnly
              value={apiKey}
              className={`flex-1 rounded-xl border px-4 py-3 font-mono text-sm ${themePreference === 'light' ? 'border-sky-100 bg-white text-slate-900' : 'border-white/10 bg-white/5 text-white'}`}
            />
            <button type="button" onClick={() => copyText(apiKey, 'API key copied.')} className={`inline-flex items-center justify-center gap-2 ${actionClass}`}>
              <Copy className="w-4 h-4" />
              Copy key
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
