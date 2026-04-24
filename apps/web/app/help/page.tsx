import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Code2, Info, LifeBuoy, Lock, Search, Settings2, Sparkles, Upload, Wand2 } from 'lucide-react';
import { getSdkScriptUrl, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Help center, setup guidance, and troubleshooting for DrapixAI.',
};

const sidebarSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'before-support', label: 'Before Support' },
  { id: 'account-access', label: 'Account & Access' },
  { id: 'garments-images', label: 'Garments & Images' },
  { id: 'tryon-results', label: 'Try-On Results' },
  { id: 'integration-help', label: 'Integration Help' },
  { id: 'limits-billing', label: 'Limits & Billing' },
  { id: 'contact-support', label: 'Contact Support' },
];

const quickChecks = [
  'Confirm you are using the correct API key for the same DrapixAI account.',
  'Make sure your store domain was saved in Settings and verified with the DrapixAI meta tag before calling the storefront flow production-ready.',
  'Check that your upper-body catalog was synced before uploading garment images.',
  'Check that at least one garment was uploaded and cached successfully before running try-on.',
  'Verify the uploaded person image is front-facing, clear, and not too dark or cropped.',
  'If results suddenly fail, confirm the AI service, Redis, and storage are all reachable.',
];

const accountHelp = [
  {
    title: 'Login is failing',
    body: 'Re-check the email spelling, password, and whether the account was created in the same environment you are using. If Google login is not configured yet, use the email/password path only.',
  },
  {
    title: 'Admin panel is not opening',
    body: 'Use the admin access page with the configured admin email and password. If the page loads but data is empty, verify the API is reachable and the admin session cookie is being set correctly.',
  },
  {
    title: 'API key looks valid but requests fail',
    body: 'Your API key can still fail if the domain is not authorized, the subscription state is expired, or the account quota has been consumed.',
  },
];

const garmentHelp = [
  {
    title: 'Garment upload is rejected',
    body: 'Use one upper-body garment only, centered in frame, preferably on a clean background. Avoid folded garments, mannequins, multiple products in one image, or heavy blur.',
  },
  {
    title: 'Garment stays pending',
    body: 'If garment approval is enabled, pending means the item is waiting for admin review. Check the admin dashboard for approval status and thumbnail generation.',
  },
  {
    title: 'Thumbnail or cached garment is missing',
    body: 'This usually points to AI preprocessing failure, storage misconfiguration, or a stale cache reference. Re-upload the garment after verifying S3 and AI health.',
  },
  {
    title: 'Bulk upload says the product is not synced',
    body: 'That means the filename does not match a synced upper-body product ID yet. Sync the catalog first, then upload files named exactly like those product IDs.',
  },
];

const tryOnHelp = [
  {
    title: 'Try-on result looks weak or unrealistic',
    body: 'Use a clean, front-facing person image with visible upper body and better lighting. Also confirm the garment image is isolated well and belongs to the same upper-body category.',
  },
  {
    title: 'Try-on fails immediately',
    body: 'Immediate failure usually means one of these: invalid API key, unauthorized domain, missing garment cache, unsupported image, or AI service not reachable.',
  },
  {
    title: 'Try-on starts but times out',
    body: 'That usually points to AI worker pressure, Redis issues, model readiness problems, or an underpowered GPU environment. For public launch, validate this on the Runpod A100 first.',
  },
];

const integrationTips = [
  'The browser SDK is the fastest way to embed DrapixAI into a product page.',
  'The REST API is language-agnostic and can be called from JavaScript, Python, PHP, Laravel, Django, Node, Go, Java, or any stack that supports HTTP and multipart uploads.',
  'Use stable `productId` or `garment_id` values. If these identifiers keep changing, your garment cache reuse will break.',
  'For store verification, use the meta tag from Settings only as proof of domain ownership. Use a product feed URL or platform connector to sync catalog data.',
  'CSV, JSON, or XML feed sync should always map `productId` to the same value you use later for garment upload filenames and storefront SDK product IDs.',
  'Keep the public web app pointed at the API service, and keep the API pointed at the live AI service only after A100 staging succeeds.',
];

const quickStartEmbed = `<script src="${getSdkScriptUrl()}"></script>
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: 'your-api-key',
    productId: 'sku-12345',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`;

const curlTryOn = `curl -X POST '${PUBLIC_API_BASE_URL}/sdk/tryon' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'garment_id=sku-12345' \\
  -F 'person_image=@./person.jpg' \\
  -F 'garment_type=upper' \\
  -F 'quality=enhanced' \\
  --output tryon-result.png`;

const pythonExample = `import requests

with open("person.jpg", "rb") as person_image:
    response = requests.post(
        "${PUBLIC_API_BASE_URL}/sdk/tryon",
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        data={
            "garment_id": "sku-12345",
            "garment_type": "upper",
            "quality": "enhanced",
        },
        files={"person_image": person_image},
        timeout=180,
    )

response.raise_for_status()
with open("tryon-result.png", "wb") as output:
    output.write(response.content)`;

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[700px] bg-gradient-glow opacity-40" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTQ4IDBIMFY0OCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3N2Zz4=')] opacity-30" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-16 lg:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8">
          <aside className="lg:sticky lg:top-24 self-start rounded-3xl border border-white/[0.08] bg-[#0b1120]/85 backdrop-blur-xl p-5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 mb-6">
              <Search className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">Browse help topics by section</span>
            </div>

            <div className="mb-6">
              <p className="text-xl font-semibold text-white">DrapixAI Help Center</p>
              <p className="text-sm text-gray-400 mt-2">
                Start here before opening a support request.
              </p>
            </div>

            <nav className="space-y-2">
              {sidebarSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-xl px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="space-y-8">
            <section id="overview" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Help Center</p>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Everything customers should check before asking for support.</h1>
              <p className="text-lg text-gray-300 leading-8 max-w-4xl">
                This help page is written for storefront teams, operators, and evaluators using DrapixAI. It covers setup, self-serve troubleshooting, image quality guidance, API usage, and the most common issues customers can resolve themselves.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-300" />
                    <p className="font-semibold text-amber-200">Warning</p>
                  </div>
                  <p className="text-gray-200 leading-7">
                    Most failed try-ons are caused by missing garment cache, wrong API/domain setup, weak source images, or an AI environment that is not actually ready.
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Info className="w-5 h-5 text-blue-300" />
                    <p className="font-semibold text-blue-200">Info</p>
                  </div>
                  <p className="text-gray-200 leading-7">
                    For serious rollout testing, finish one full staging pass with the Runpod A100 stack before exposing DrapixAI publicly on a production storefront.
                  </p>
                </div>
              </div>
            </section>

            <section id="getting-started" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Sparkles className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Getting Started</h2>
              </div>

              <div className="space-y-4 text-gray-300">
                <p>Use this order for the cleanest setup:</p>
                {[
                  'Create an account and copy your API key from the dashboard.',
                  'Open Settings and save your store domain, sync source, and verification meta tag.',
                  'Add the verification meta tag to your storefront homepage, then run Store Verification.',
                  'Sync your upper-body catalog by feed URL or manual dashboard import.',
                  'Upload garment images only after those product IDs exist in the synced catalog.',
                  'Embed the browser SDK or call the REST API directly.',
                  'Run one real try-on on staging before pushing traffic to production.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                    <p className="leading-7">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <p className="text-sm font-semibold text-white mb-3">Web SDK quick start</p>
                <pre className="overflow-x-auto rounded-2xl bg-black/30 border border-white/[0.08] p-5 text-sm text-gray-200">
{quickStartEmbed}
                </pre>
                <div className="mt-4">
                  <Link href="/docs" className="inline-flex items-center gap-2 text-sm text-cyan-300 hover:text-cyan-200">
                    Open full SDK installation docs
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </section>

            <section id="before-support" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <CircleHelp className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Before You Contact Support</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {quickChecks.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <p className="text-gray-300 leading-7">{item}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="account-access" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Lock className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Account &amp; Access</h2>
              </div>
              <div className="space-y-4">
                {accountHelp.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="text-gray-300 leading-7">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="garments-images" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Upload className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Garments &amp; Images</h2>
              </div>
              <div className="space-y-4">
                {garmentHelp.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="text-gray-300 leading-7">{item.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                <h3 className="text-lg font-semibold mb-3">Upper-body catalog workflow</h3>
                <div className="space-y-2 text-gray-300">
                  <p>1. Sync product IDs first from CSV, JSON, XML, or manual import.</p>
                  <p>2. DrapixAI filters only upper-body rows server-side.</p>
                  <p>3. Upload garment files after sync, using filenames that exactly match those product IDs.</p>
                  <p>4. The storefront SDK should use the same product ID when it renders the try-on entry point.</p>
                </div>
              </div>
            </section>

            <section id="tryon-results" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Wand2 className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Try-On Results</h2>
              </div>
              <div className="space-y-4">
                {tryOnHelp.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="text-gray-300 leading-7">{item.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <p className="text-sm font-semibold text-white mb-3">Direct API try-on example</p>
                <pre className="overflow-x-auto rounded-2xl bg-black/30 border border-white/[0.08] p-5 text-sm text-gray-200 whitespace-pre-wrap">
{curlTryOn}
                </pre>
              </div>
            </section>

            <section id="integration-help" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Code2 className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Integration Help</h2>
              </div>
              <div className="space-y-4 mb-8">
                {integrationTips.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                    <p className="text-gray-300 leading-7">{item}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5 mb-8">
                <h3 className="text-lg font-semibold mb-3">Store connection order</h3>
                <div className="space-y-2 text-gray-300">
                  <p>1. Save the store domain and generate the verification meta tag in Settings.</p>
                  <p>2. Add the meta tag to the storefront homepage.</p>
                  <p>3. Run verification from Settings.</p>
                  <p>4. Choose a sync source: manual import or feed URL today, platform connector later.</p>
                  <p>5. Re-sync upper-body catalog items whenever the store assortment changes.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                <h3 className="text-lg font-semibold mb-3">Python example</h3>
                <pre className="overflow-x-auto rounded-2xl bg-black/30 border border-white/[0.08] p-5 text-sm text-gray-200 whitespace-pre-wrap">
{pythonExample}
                </pre>
              </div>
            </section>

            <section id="limits-billing" className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <Settings2 className="w-6 h-6 text-cyan-400" />
                <h2 className="text-3xl font-semibold">Limits &amp; Billing</h2>
              </div>
              <div className="space-y-4 text-gray-300">
                <p>Trial, Starter, Growth, and Pro plans have different monthly try-on limits. Requests can fail even with a valid API key if the account has already consumed its quota.</p>
                <p>If a customer believes the limit is wrong, first check the dashboard usage counts and the admin analytics panel before assuming a billing issue.</p>
                <p>Upgrade links should point customers to the pricing page until the live billing flow is finalized, and enterprise requests should go through the sales contact path.</p>
              </div>
            </section>

            <section id="contact-support" className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 p-8 md:p-10">
              <div className="flex items-center gap-3 mb-5">
                <LifeBuoy className="w-6 h-6 text-cyan-300" />
                <h2 className="text-3xl font-semibold">When To Contact Support</h2>
              </div>
              <div className="space-y-4 text-gray-200">
                <p>Contact support only after you have already checked domain validation, garment cache status, source image quality, AI readiness, and plan/quota status.</p>
                <p>When opening a support request, include:</p>
                <div className="space-y-2">
                  {[
                    'the account email or brand name',
                    'the affected domain',
                    'the garment ID or product ID',
                    'the exact endpoint that failed',
                    'the error message or screenshot',
                    'whether the issue happened on demo, staging, or production',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                      <p>{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-8">
                <Link href="/contact" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-cyan-400/30 hover:bg-white/[0.05] transition-colors">
                  Contact Support
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/demo" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-white/[0.12] hover:bg-white/[0.05] transition-colors">
                  Open Live Demo
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
