'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Code2, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { PUBLIC_API_BASE_URL, SHOPIFY_APP_INSTALL_URL, getSdkScriptUrl } from '@/app/lib/public-env';
import WorkspaceHeader from '@/app/components/WorkspaceHeader';

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
  cacheKey?: string | null;
  confirmedProductId?: string | null;
  confirmedProductName?: string | null;
  status: string;
};

type ShopifyInstallation = {
  id: number;
  shopDomain: string;
  shopName?: string | null;
  primaryDomain?: string | null;
  status: string;
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
  themeEditorUrl?: string | null;
};

type ShopifyPreparation = {
  counts: Record<string, number>;
  failures: Array<{ productId: string; productName?: string | null; preparationError?: string | null }>;
};

const platformTabs = ['HTML', 'Shopify', 'WooCommerce', 'React'] as const;
type PlatformTab = (typeof platformTabs)[number];

const escapeForSnippet = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export default function SdkInstallPage() {
  const router = useRouter();
  const [storefrontApiKey, setStorefrontApiKey] = useState('');
  const [storefrontKeyExists, setStorefrontKeyExists] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [activeTab, setActiveTab] = useState<PlatformTab>('Shopify');
  const [shopify, setShopify] = useState<ShopifyInstallation | null>(null);
  const [shopifyPreparation, setShopifyPreparation] = useState<ShopifyPreparation>({ counts: {}, failures: [] });
  const [shopifyMessage, setShopifyMessage] = useState('');
  const [toast, setToast] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const pageClass = 'min-h-screen bg-[#fbfcf9] text-[#172019]';
  const cardClass = 'border-t border-black/10 bg-white p-6 sm:p-8';
  const panelClass = 'border border-black/10 bg-[#f2f5f1] p-4';
  const mutedTextClass = 'text-[#68736b]';
  const strongTextClass = 'text-[#172019]';
  const actionClass = 'border border-black/15 bg-white px-4 py-2 text-sm font-bold text-[#172019] hover:bg-[#f1f4f0]';

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

        const [summaryResponse, garmentsResponse, shopifyResponse, preparationResponse, keyStatusResponse] = await Promise.all([
          fetch('/api/dashboard/proxy/analytics/summary', { cache: 'no-store' }),
          fetch('/api/dashboard/proxy/sdk/garments', { cache: 'no-store' }),
          fetch('/api/dashboard/proxy/shopify/status', { cache: 'no-store' }),
          fetch('/api/dashboard/proxy/shopify/preparation', { cache: 'no-store' }),
          fetch('/api/dashboard/proxy/analytics/api-key/status', { cache: 'no-store' }),
        ]);

        if (!summaryResponse.ok) {
          throw new Error('SUMMARY_FAILED');
        }

        const summary = (await summaryResponse.json().catch(() => null)) as UsageData | null;
        const garmentPayload = (await garmentsResponse.json().catch(() => ({ items: [] }))) as { items?: GarmentItem[] };
        const shopifyPayload = (await shopifyResponse.json().catch(() => null)) as { installation?: ShopifyInstallation | null } | null;
        const preparationPayload = (await preparationResponse.json().catch(() => null)) as ShopifyPreparation | null;
        const keyStatusPayload = (await keyStatusResponse.json().catch(() => null)) as { exists?: boolean } | null;
        if (!active) return;

        setUsage(summary);
        setGarments(garmentPayload.items || []);
        setShopify(shopifyPayload?.installation || null);
        setShopifyPreparation(preparationPayload || { counts: {}, failures: [] });
        setStorefrontKeyExists(Boolean(keyStatusPayload?.exists));
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
  const safeBaseUrl = escapeForSnippet(PUBLIC_API_BASE_URL);
  const safeSdkUrl = getSdkScriptUrl();
  const safeProductId = escapeForSnippet(sampleProductId);
  const installReady = Boolean(usage?.storeVerified && confirmedGarments.length > 0);

  const snippets: Record<PlatformTab, string> = {
    HTML: `<script src="${safeSdkUrl}"></script>

<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    productId: '${safeProductId}',
    containerId: 'drapixai-container',
    baseUrl: '${safeBaseUrl}',
    garmentType: 'upper',
    quality: 'standard',
    timeoutMs: 20000,
    enableDownload: true,
    onResult: function (metadata) {
      console.log('DrapixAI result', metadata);
    },
    onError: function (error) {
      console.warn('DrapixAI error', error.message);
    }
  });
</script>`,
    Shopify: `DrapixAI Shopify Theme App Extension

1. Install and connect DrapixAI from Shopify.
2. Open Online Store > Themes > Customize.
3. Select the default product template.
4. Add the DrapixAI Try-On app block.
5. Position the block beside the product form and save.
6. Preview one approved DrapixAI-ready product before publishing.

No Liquid editing or permanent storefront API key is required.`,
    WooCommerce: `<script src="${safeSdkUrl}"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    DrapixAI.init({
      tokenProvider: async function (productId) {
        const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
        return payload.token;
      },
      productId: String(window.drapixaiProductId || ''),
      baseUrl: '${safeBaseUrl}',
      garmentType: 'upper',
      quality: 'standard',
      enableDownload: true,
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
      tokenProvider={async (productId) => {
        const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
        return payload.token;
      }}
      productId="${safeProductId}"
      baseUrl="${safeBaseUrl}"
      garmentType="upper"
      quality="standard"
      buttonText="Try On"
      timeoutMs={20000}
      enableDownload={true}
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

  const rotateStorefrontKey = async () => {
    const response = await fetch('/api/dashboard/proxy/analytics/api-key/rotate', { method: 'POST' });
    const payload = (await response.json().catch(() => null)) as { apiKey?: string } | null;
    const nextKey = payload?.apiKey?.trim() || '';
    if (!response.ok || !nextKey) {
      setToast('Unable to create the storefront key right now.');
      return;
    }
    setStorefrontApiKey(nextKey);
    setStorefrontKeyExists(true);
    setToast(storefrontKeyExists ? 'Storefront key rotated. Update your installed widget.' : 'Storefront key created. Copy it now.');
  };

  const syncShopify = async () => {
    setShopifyMessage('Syncing Shopify products and variants...');
    const response = await fetch('/api/dashboard/proxy/shopify/sync', { method: 'POST' });
    const payload = await response.json().catch(() => null) as { error?: string; eligible?: number; queued?: number; skipped?: number } | null;
    if (!response.ok) {
      setShopifyMessage(payload?.error || 'Shopify sync failed.');
      return;
    }
    setShopifyMessage(`Sync complete: ${payload?.eligible || 0} eligible, ${payload?.queued || 0} queued, ${payload?.skipped || 0} skipped.`);
    const statusResponse = await fetch('/api/dashboard/proxy/shopify/status', { cache: 'no-store' });
    const statusPayload = await statusResponse.json().catch(() => null) as { installation?: ShopifyInstallation | null } | null;
    setShopify(statusPayload?.installation || null);
  };

  const prepareShopify = async () => {
    setShopifyMessage('Preparing the next Shopify garment batch...');
    const response = await fetch('/api/dashboard/proxy/shopify/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3 }),
    });
    const payload = await response.json().catch(() => null) as { error?: string; message?: string; busy?: boolean; processed?: number } | null;
    if (!response.ok) {
      setShopifyMessage(payload?.message || payload?.error || 'Garment preparation is temporarily unavailable.');
      return;
    }
    setShopifyMessage(payload?.busy
      ? 'Another preparation batch is already running. Queued products remain safe and will be handled in order.'
      : `Preparation batch complete: ${payload?.processed || 0} product(s) processed. Review prepared garments before publishing.`);
    const preparationResponse = await fetch('/api/dashboard/proxy/shopify/preparation', { cache: 'no-store' });
    const preparationPayload = await preparationResponse.json().catch(() => null) as ShopifyPreparation | null;
    setShopifyPreparation(preparationPayload || { counts: {}, failures: [] });
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
    { label: 'Preprocessing complete', done: garments.some((garment) => Boolean(garment.status) && garment.status !== 'missing'), href: '/dashboard#garment-onboarding' },
    { label: 'Try-on cache ready', done: garments.some((garment) => Boolean(garment.cacheKey) && garment.status === 'ready'), href: '/dashboard#garment-onboarding' },
    { label: 'Products discovered', done: (usage.discoveredProductCount || 0) > 0, href: '/dashboard#garment-onboarding' },
    { label: 'Mappings confirmed', done: confirmedGarments.length > 0, href: '/dashboard#mapping-flow' },
  ];
  const nextAction = readiness.find((item) => !item.done);

  return (
    <main className={pageClass}>
      <WorkspaceHeader active="sdk" />
      {toast ? (
        <div className="fixed right-6 top-6 z-50 border border-[#9bb6a8] bg-[#eaf0e9] px-4 py-3 text-sm font-semibold text-[#183f32] shadow-lg">
          {toast}
        </div>
      ) : null}
      <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12 lg:py-16">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6 border-b border-black/10 pb-10">
          <div>
            <Link href="/dashboard" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]">
              <ArrowLeft className="w-4 h-4" />
              Back to dashboard
            </Link>
            <p className="mb-3 text-xs font-bold uppercase text-[#31725b]">SDK installation</p>
            <h1 className="font-serif text-5xl leading-none text-[#101712]">Install DrapixAI on your store.</h1>
            <p className={`mt-3 max-w-3xl ${mutedTextClass}`}>
              Follow the next action below, copy the snippet for your platform, and test one approved product before publishing the widget to shoppers.
            </p>
          </div>
          <Link href="/docs" className={`inline-flex items-center gap-2 ${actionClass}`}>
            Developer Quickstart
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>

        <section className={`${cardClass} mb-8 border-l-4 border-l-[#31725b] bg-[#eaf0e9]`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-[#31725b]">Your next action</p>
              <h2 className={`mt-2 text-2xl font-bold ${strongTextClass}`}>{nextAction ? nextAction.label : 'Run a storefront test'}</h2>
              <p className={`mt-2 text-sm ${mutedTextClass}`}>
                {nextAction
                  ? 'Complete this item and DrapixAI will unlock the next part of installation.'
                  : 'Setup is ready. Open the Shopify Theme Editor and test one confirmed product before publishing.'}
              </p>
            </div>
            {nextAction ? (
              <Link href={nextAction.href} className="inline-flex h-12 items-center justify-center bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
                Continue setup
              </Link>
            ) : (
              <button type="button" onClick={() => setActiveTab('Shopify')} className="inline-flex h-12 items-center justify-center bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
                View Shopify install
              </button>
            )}
          </div>
        </section>

        <section className={`${cardClass} mb-8`}>
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-3"><Store className="h-6 w-6 text-[#31725b]" /><h2 className="text-xl font-bold">Shopify-native installation</h2></div>
              {shopify?.status === 'active' ? (
                <div className="mt-3">
                  <p className={strongTextClass}>{shopify.shopName || shopify.shopDomain} is connected.</p>
                  <p className={`mt-1 text-sm ${mutedTextClass}`}>Products and variants synchronize automatically. Eligible base-product images are queued for preprocessing and review. Last sync: {shopify.lastSyncedAt ? new Date(shopify.lastSyncedAt).toLocaleString() : 'pending'}.</p>
                  <p className={`mt-2 text-sm ${mutedTextClass}`}>Queued: {shopifyPreparation.counts.queued || 0} | Processing: {shopifyPreparation.counts.processing || 0} | Review: {shopifyPreparation.counts.review_required || 0} | Ready: {shopifyPreparation.counts.ready || 0} | Failed: {shopifyPreparation.counts.failed || 0}</p>
                </div>
              ) : (
                <p className={`mt-3 max-w-3xl text-sm ${mutedTextClass}`}>Install DrapixAI through Shopify, approve read-only product access, and return with the catalog connected. DrapixAI can prepare eligible Shopify product images without CSV files, Liquid edits, or uploading the same garment twice; every prepared garment remains review-gated before shoppers can use it.</p>
              )}
              {shopifyMessage ? <p className="mt-3 text-sm text-[#31725b]">{shopifyMessage}</p> : null}
            </div>
            {shopify?.status === 'active' ? (
              <div className="flex flex-wrap gap-3">
                {shopify.themeEditorUrl ? <a href={shopify.themeEditorUrl} className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">Add try-on block <ExternalLink className="h-4 w-4" /></a> : null}
                {(shopifyPreparation.counts.queued || 0) > 0 ? <button type="button" onClick={() => void prepareShopify()} className={`inline-flex items-center justify-center gap-2 ${actionClass}`}><RefreshCw className="h-4 w-4" />Prepare next batch</button> : null}
                <button type="button" onClick={() => void syncShopify()} className={`inline-flex items-center justify-center gap-2 ${actionClass}`}><RefreshCw className="h-4 w-4" />Sync now</button>
              </div>
            ) : SHOPIFY_APP_INSTALL_URL ? (
              <a href={SHOPIFY_APP_INSTALL_URL} className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">Install on Shopify <ExternalLink className="h-4 w-4" /></a>
            ) : (
              <span className="inline-flex items-center border border-[#d5b77d] bg-[#fbf5e9] px-4 py-3 text-sm text-[#7c5620]">Partner configuration required</span>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 mb-8">
          <section className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className={installReady ? 'w-6 h-6 text-emerald-400' : 'w-6 h-6 text-amber-300'} />
              <h2 className="text-xl font-bold">Setup details</h2>
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
              <Store className="h-6 w-6 text-[#31725b]" />
              <h2 className="text-xl font-bold">Confirmed product IDs</h2>
            </div>
            {confirmedGarments.length === 0 ? (
              <div className={panelClass}>
                <p className={mutedTextClass}>No confirmed mappings yet. Confirm at least one garment-to-product pair in the dashboard before installing live. Each live product must point to a ready cached garment asset.</p>
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
              <Code2 className="h-6 w-6 text-[#31725b]" />
              <div>
                <h2 className="text-xl font-bold">{activeTab === 'Shopify' ? 'Theme extension setup' : 'Install snippet'}</h2>
                <p className={`mt-1 text-sm ${mutedTextClass}`}>{activeTab === 'Shopify' ? 'Shopify uses the native app block and short-lived storefront credentials.' : 'Use the domain-bound storefront key generated below.'}</p>
              </div>
            </div>
            <button type="button" onClick={() => copyText(snippets[activeTab], `${activeTab} snippet copied.`)} className={`inline-flex items-center gap-2 ${actionClass}`}>
              <Copy className="w-4 h-4" />
              {activeTab === 'Shopify' ? 'Copy instructions' : 'Copy snippet'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {platformTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border px-4 py-2 text-sm font-bold ${activeTab === tab ? 'border-[#183f32] bg-[#183f32] text-white' : 'border-black/15 bg-white text-[#5d6961] hover:bg-[#f1f4f0]'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <pre className="overflow-x-auto border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
            <code>{snippets[activeTab]}</code>
          </pre>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Expected latency</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Warm standard try-on should aim for 10-12 seconds. SDK timeout is set to 20 seconds for network headroom.</p>
            </div>
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Metadata callback</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Use `onResult` to capture result id, quality, latency, and warning metadata, plus the timing breakdown returned by the SDK headers.</p>
            </div>
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Error handling</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Use `onError` to show clean messages for missing mappings, quota limits, validation failures, or timeout.</p>
            </div>
            <div className={panelClass}>
              <p className={`text-sm font-semibold ${strongTextClass}`}>Shopper actions</p>
              <p className={`text-sm mt-2 ${mutedTextClass}`}>Keep `enableDownload` on for shopper saves, or set it to false when a brand wants only Buy and Share actions.</p>
            </div>
          </div>
        </section>

        {activeTab !== 'Shopify' ? <section className={`${cardClass} mt-8`}>
          <div className="flex items-center gap-3 mb-4">
            <KeyRound className="h-6 w-6 text-[#31725b]" />
            <h2 className="text-xl font-bold">Server-only storefront key</h2>
          </div>
          <p className={`mb-4 text-sm ${mutedTextClass}`}>
            Store this credential only in your backend secret manager. Your `/api/drapixai-token` route exchanges it through `POST /sdk/storefront-token` for a five-minute token restricted to the requested DrapixAI-ready product. Never place this key in HTML, JavaScript, a mobile binary, logs, or analytics.
          </p>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              readOnly
              value={storefrontApiKey || (storefrontKeyExists ? 'Active storefront key hidden' : 'No storefront key created')}
              className="flex-1 border border-black/15 bg-white px-4 py-3 font-mono text-sm text-[#172019]"
            />
            <button type="button" disabled={!storefrontApiKey} onClick={() => copyText(storefrontApiKey, 'Storefront key copied.')} className={`inline-flex items-center justify-center gap-2 ${actionClass}`}>
              <Copy className="w-4 h-4" />
              Copy key
            </button>
            <button type="button" onClick={rotateStorefrontKey} className={`inline-flex items-center justify-center gap-2 ${actionClass}`}>
              <KeyRound className="w-4 h-4" />
              {storefrontKeyExists ? 'Rotate key' : 'Create key'}
            </button>
          </div>
        </section> : null}
      </div>
    </main>
  );
}
