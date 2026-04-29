import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  Layers3,
  PlugZap,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Store,
  Upload,
} from 'lucide-react';
import { getSdkScriptUrl, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Brand onboarding, confirmed mapping flow, and storefront SDK guidance for DrapixAI.',
};

const singleProductSnippet = `<script src="${getSdkScriptUrl()}"></script>
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: 'YOUR_API_KEY',
    productId: 'shirt-001',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`;

const autoAttachSnippet = `<script src="${getSdkScriptUrl()}"></script>

<div data-drapix-product-id="shirt-001">
  <div data-drapix-button-slot></div>
</div>

<div data-drapix-product-id="hoodie-017">
  <div data-drapix-button-slot></div>
</div>

<script>
  DrapixAI.init({
    apiKey: 'YOUR_API_KEY',
    autoAttach: true,
    productSelector: '[data-drapix-product-id]',
    productIdAttribute: 'data-drapix-product-id',
    buttonTargetSelector: '[data-drapix-button-slot]',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`;

const apiTryOnSnippet = `curl -X POST "${PUBLIC_API_BASE_URL}/sdk/tryon" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "garment_id=shirt-001" \\
  -F "garment_type=upper" \\
  -F "quality=enhanced" \\
  -F "person_image=@./person.jpg" \\
  --output tryon-result.png`;

const onboardingSteps = [
  {
    title: 'Garment upload and validation',
    body: 'Brands start by uploading a few clean upper-body assets. DrapixAI validates those files before they ever affect shopper-facing try-on quality.',
  },
  {
    title: 'Catalog discovery',
    body: 'Next, bring in product context through a feed, import, or product list. The goal is discovery first, not hard integration work on day one.',
  },
  {
    title: 'Suggested matches',
    body: 'DrapixAI uses the discovered catalog plus garment context to propose likely garment-to-product links.',
  },
  {
    title: 'Manual confirmation',
    body: 'A human still confirms what should go live. This is the safety layer that keeps brand onboarding trustworthy.',
  },
  {
    title: 'SDK uses confirmed mappings',
    body: 'Only the confirmed pairings should power the live storefront experience. Install comes after trust, not before.',
  },
];

const installChecks = [
  'Create an account and copy the API key from the dashboard.',
  'Save the storefront domain in Settings so DrapixAI knows which brand site you are preparing.',
  'Upload a few garment-only upper-body assets first to validate the visual input quality.',
  'Run catalog discovery through a feed, import, or product list before expecting product suggestions.',
  'Review and confirm product pairings before you expose the storefront SDK publicly.',
  'Use domain verification and SDK install only after internal preview quality is trusted.',
];

const troubleshooting = [
  {
    title: 'Button does not appear',
    body: 'Check that the SDK script is loading, your product node has a stable product identifier, and the page belongs to the verified storefront you expect.',
  },
  {
    title: 'Discovery finds products but matching still feels weak',
    body: 'This usually means the garment assets are not clean enough, the product titles are ambiguous, or the catalog context is too broad. Start with a tiny, high-confidence product set first.',
  },
  {
    title: 'Try-on request returns an error',
    body: 'The most common causes are missing garment validation, unconfirmed product pairings, unauthorized domain, expired plan/quota, or an AI service that is not ready.',
  },
  {
    title: 'Result quality is weak',
    body: 'Use a front-facing person image with visible upper body and a garment-only upper-body asset. Avoid photos of a human already wearing the source garment.',
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[720px] w-full bg-gradient-glow opacity-40" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTQ4IDBIMFY0OCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3N2Zz4=')] opacity-25" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="self-start rounded-3xl border border-white/[0.08] bg-[#0b1120]/85 p-5 backdrop-blur-xl lg:sticky lg:top-24">
            <p className="mb-2 text-xl font-semibold text-white">Brand Docs</p>
            <p className="mb-6 text-sm text-gray-400">
              The onboarding, matching, and SDK contract brands should actually understand.
            </p>
            <nav className="space-y-2">
              {[
                ['overview', 'Overview'],
                ['onboarding-flow', 'Onboarding Flow'],
                ['before-install', 'Before Install'],
                ['confirmed-mappings', 'Confirmed Mappings'],
                ['single-product', 'Single Product'],
                ['auto-attach', 'Auto Attach'],
                ['api', 'API Flow'],
                ['troubleshooting', 'Troubleshooting'],
                ['launch-checklist', 'Launch Checklist'],
              ].map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="block rounded-xl px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="space-y-8">
            <section id="overview" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <p className="mb-4 text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80">DrapixAI Docs</p>
              <h1 className="mb-5 text-4xl font-bold tracking-tight md:text-5xl">Onboard a brand without making them think like an integration engineer.</h1>
              <p className="max-w-4xl text-lg leading-8 text-gray-300">
                DrapixAI should feel simple for brands: upload garments, discover products, review suggested matches, confirm the right pairings, then let the storefront SDK use only those confirmed mappings.
              </p>

              <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <Upload className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">Validation first</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">Weak garment inputs should be blocked early so brands never build on bad assets.</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <SearchCheck className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">Discovery before install</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">Product discovery and suggested matches should happen before brands touch live storefront install.</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <PlugZap className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">SDK after confirmation</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">The SDK should rely only on confirmed mappings once the brand trusts the preview path.</p>
                </div>
              </div>
            </section>

            <section id="onboarding-flow" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Onboarding Flow</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                {onboardingSteps.map((step) => (
                  <div key={step.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <p className="font-semibold text-white">{step.title}</p>
                    <p className="mt-3 text-sm leading-7 text-gray-300">{step.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="before-install" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Before Install</h2>
              </div>
              <div className="space-y-4 text-gray-300">
                {installChecks.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-green-400" />
                    <p className="leading-7">{item}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                <p className="font-semibold text-amber-200">Important scope note</p>
                <p className="mt-2 leading-7 text-gray-200">
                  The current public product is upper-body only. Do not wire the SDK onto bottoms or full-body products, and do not upload model-worn catalog photos as garments. The launch path expects isolated garment assets.
                </p>
              </div>
            </section>

            <section id="confirmed-mappings" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <Layers3 className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Confirmed Mappings</h2>
              </div>
              <p className="mb-4 leading-7 text-gray-300">
                Brands should think in terms of confirmed pairings, not raw IDs. Underneath, DrapixAI still needs a stable product identifier, but the storefront experience should be explained as a confirmed mapping between a garment asset and a discovered product.
              </p>
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5 text-gray-300">
                <p className="leading-7">
                  <span className="font-semibold text-white">Discovery layer:</span> DrapixAI sees a product like <code className="font-mono text-cyan-300">shirt-001</code>.
                </p>
                <p className="leading-7">
                  <span className="font-semibold text-white">Garment layer:</span> DrapixAI validates an uploaded garment asset that represents that shirt.
                </p>
                <p className="leading-7">
                  <span className="font-semibold text-white">Confirmation layer:</span> A human approves that this garment should power that product.
                </p>
                <p className="leading-7">
                  <span className="font-semibold text-white">Storefront layer:</span> The SDK uses the confirmed product identifier on the live page.
                </p>
              </div>
            </section>

            <section id="single-product" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <Store className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Single Product Install</h2>
              </div>
              <p className="mb-4 leading-7 text-gray-300">
                Use single-product mode when the storefront is ready to rely on one confirmed product mapping on a specific product detail page.
              </p>
              <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-5 text-sm text-gray-200">
{singleProductSnippet}
              </pre>
            </section>

            <section id="auto-attach" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <Code2 className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Auto Attach Install</h2>
              </div>
              <p className="mb-4 leading-7 text-gray-300">
                Use auto-attach mode when product cards or detail blocks already render stable product IDs and you want DrapixAI to attach the launcher only for those confirmed products.
              </p>
              <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-5 text-sm text-gray-200">
{autoAttachSnippet}
              </pre>
            </section>

            <section id="api" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <h2 className="mb-5 text-3xl font-semibold">Direct API Flow</h2>
              <p className="mb-4 leading-7 text-gray-300">
                The REST API remains useful for custom storefronts and backend testing. The same rule still applies: send only identifiers that belong to confirmed product pairings.
              </p>
              <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-5 text-sm text-gray-200 whitespace-pre-wrap">
{apiTryOnSnippet}
              </pre>
            </section>

            <section id="troubleshooting" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <h2 className="mb-5 text-3xl font-semibold">Troubleshooting</h2>
              <div className="space-y-4">
                {troubleshooting.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <h3 className="mb-2 text-lg font-semibold text-white">{item.title}</h3>
                    <p className="leading-7 text-gray-300">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="launch-checklist" className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 p-8 md:p-10">
              <h2 className="mb-5 text-3xl font-semibold">Launch Checklist</h2>
              <div className="space-y-3 text-gray-200">
                {[
                  'Validated upper-body garment assets uploaded successfully',
                  'Catalog discovery completed for the products you actually want to launch first',
                  'Suggested matches reviewed and final pairings confirmed by a human',
                  'Verified storefront domain saved in Settings',
                  'At least one real staging try-on completed successfully',
                  'Support inbox and escalation path ready before public traffic',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-green-400" />
                    <p>{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/help" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-5 py-3 transition-colors hover:bg-white/[0.05]">
                  Open Help Center
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-3 transition-colors hover:bg-white/[0.05]">
                  Contact Support
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
