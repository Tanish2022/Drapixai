import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Code2, ExternalLink, Layers3, PlugZap, ShieldCheck, Store, Upload } from 'lucide-react';
import { getSdkScriptUrl, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'SDK installation, product ID mapping, and launch guidance for DrapixAI storefront integrations.',
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

const installChecks = [
  'Create an account, complete email verification, and copy the API key from the dashboard.',
  'Open Settings and save the storefront domain that will host the try-on button.',
  'Add the verification meta tag to the storefront homepage and verify the store before production traffic.',
  'Sync the upper-body catalog before uploading garment images.',
  'Upload garment files only after product IDs exist in the synced catalog.',
  'Keep one stable product ID across catalog sync, garment upload, and storefront rendering.',
];

const troubleshooting = [
  {
    title: 'Button does not appear',
    body: 'Check that the SDK script is loading, the product node actually has a product ID attribute, and your selector configuration matches the storefront markup.',
  },
  {
    title: 'Domain validation fails',
    body: 'The SDK calls /sdk/validate before it renders the flow. Make sure the API key belongs to the same account that verified the domain, and that the verified hostname matches the live page.',
  },
  {
    title: 'Try-on request returns an error',
    body: 'The most common causes are: unsynced product ID, missing garment cache, unauthorized domain, expired subscription state, or AI service not being ready.',
  },
  {
    title: 'Result quality is weak',
    body: 'Use a front-facing person image with visible upper body, good lighting, and minimal cropping. The garment image should be a clean upper-body item on a simple background.',
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
            <p className="mb-2 text-xl font-semibold text-white">SDK Docs</p>
            <p className="mb-6 text-sm text-gray-400">
              Installation, product ID mapping, and launch guidance for storefront teams.
            </p>
            <nav className="space-y-2">
              {[
                ['overview', 'Overview'],
                ['before-install', 'Before Install'],
                ['single-product', 'Single Product'],
                ['auto-attach', 'Auto Attach'],
                ['product-id', 'Product IDs'],
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
              <h1 className="mb-5 text-4xl font-bold tracking-tight md:text-5xl">Install DrapixAI on a storefront without guessing the integration contract.</h1>
              <p className="max-w-4xl text-lg leading-8 text-gray-300">
                DrapixAI currently supports upper-body garment try-on. The storefront SDK validates the domain, checks the API key, opens the customer try-on modal, and sends the try-on request using the same stable product ID you synced and uploaded in the dashboard.
              </p>

              <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <Store className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">Store verification first</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">Use the Settings meta tag to verify domain ownership before you expose the SDK publicly.</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <Upload className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">Catalog before garments</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">Sync upper-body product IDs first, then upload garments whose filenames or IDs match exactly.</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                  <PlugZap className="mb-3 h-6 w-6 text-cyan-400" />
                  <p className="font-semibold text-white">Two integration modes</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">Use single-product mode for one product detail page or auto-attach mode for product grids and dynamic storefront markup.</p>
                </div>
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
                  The current public product is upper-body only. Do not wire the SDK onto bottoms or full-body products until the product scope changes and the docs are updated to match.
                </p>
              </div>
            </section>

            <section id="single-product" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <div className="mb-5 flex items-center gap-3">
                <Layers3 className="h-6 w-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Single Product Install</h2>
              </div>
              <p className="mb-4 leading-7 text-gray-300">
                Use single-product mode when you want to place one DrapixAI launcher on a specific product detail page or inside a single reserved container.
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
                Use auto-attach mode when product cards or product detail blocks already render a stable product ID in the DOM. The SDK watches for new nodes and attaches buttons as content loads.
              </p>
              <pre className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-5 text-sm text-gray-200">
{autoAttachSnippet}
              </pre>
            </section>

            <section id="product-id" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <h2 className="mb-5 text-3xl font-semibold">Product ID Mapping</h2>
              <p className="mb-4 leading-7 text-gray-300">
                The same product ID must be used across the entire DrapixAI workflow. This is the most important rule in the integration.
              </p>
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5 text-gray-300">
                <p className="leading-7"><span className="font-semibold text-white">Catalog sync:</span> <code className="font-mono text-cyan-300">shirt-001</code></p>
                <p className="leading-7"><span className="font-semibold text-white">Garment upload filename or garment ID:</span> <code className="font-mono text-cyan-300">shirt-001.png</code></p>
                <p className="leading-7"><span className="font-semibold text-white">Storefront attribute:</span> <code className="font-mono text-cyan-300">data-drapix-product-id="shirt-001"</code></p>
                <p className="leading-7"><span className="font-semibold text-white">Try-on request:</span> <code className="font-mono text-cyan-300">productId=shirt-001</code> or <code className="font-mono text-cyan-300">garment_id=shirt-001</code></p>
              </div>
            </section>

            <section id="api" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8 md:p-10 backdrop-blur-xl">
              <h2 className="mb-5 text-3xl font-semibold">Direct API Flow</h2>
              <p className="mb-4 leading-7 text-gray-300">
                The SDK uses the same API route your backend or technical team can call directly. This is useful for custom storefronts or server-to-server integration testing.
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
                  'Verified storefront domain saved in Settings',
                  'Upper-body catalog synced successfully',
                  'Garment cache populated for live product IDs',
                  'At least one real staging try-on completed successfully',
                  'AI service, Redis, and storage all reachable on production infrastructure',
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
