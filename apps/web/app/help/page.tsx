import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Code2,
  Info,
  LifeBuoy,
  Lock,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';
import { getSdkScriptUrl, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Unified onboarding, integration, troubleshooting, and support help for DrapixAI.',
};

const sidebarSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'before-support', label: 'Before Support' },
  { id: 'account-access', label: 'Account & Access' },
  { id: 'garments-images', label: 'Garments & Images' },
  { id: 'matches-confirmation', label: 'Matches & Confirmation' },
  { id: 'tryon-results', label: 'Try-On Results' },
  { id: 'integration-help', label: 'Integration Help' },
  { id: 'limits-billing', label: 'Limits & Billing' },
  { id: 'contact-support', label: 'Contact Support' },
];

const quickChecks = [
  'Confirm your backend token route uses the correct DrapixAI server key and returns a fresh five-minute shopper token.',
  'Check that the garment asset is isolated, upper-body only, and not a model-worn product photo.',
  'Check that catalog discovery has already run before expecting suggested matches.',
  'Confirm the final product pairing was manually reviewed before testing the storefront flow.',
  'Verify the person image is front-facing, clear, and not too dark or cropped.',
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
    title: 'Shopper token looks valid but requests fail',
    body: 'A shopper token can still fail if it expired, targets another product, came from another verified domain, the subscription is inactive, or the account quota has been consumed.',
  },
];

const garmentHelp = [
  {
    title: 'Garment upload is rejected',
    body: 'Use one isolated upper-body garment only, centered in frame, preferably on a clean background. DrapixAI rejects model-worn product photos, visible body parts, multiple products in one image, and heavy blur.',
  },
  {
    title: 'Which upper-body categories are strongest right now?',
    body: 'Launch-ready categories are shirts, t-shirts, polos, blouses, and clean tops. Beta categories are short kurtis, hoodies, and sweatshirts. Long kurtas, jackets, blazers, coats, cardigans, and layered outerwear are currently blocked because they still weaken realism.',
  },
  {
    title: 'Garment validation passes but the brand is still confused',
    body: 'That usually means the onboarding story is still too technical. Brands should think in terms of garment upload, product discovery, suggested matches, manual confirmation, then preview. They should not have to manage raw identifiers first.',
  },
  {
    title: 'Thumbnail or cached garment is missing',
    body: 'This usually points to AI preprocessing failure, storage misconfiguration, or a stale cache reference. Re-upload the garment after verifying S3 and AI health.',
  },
  {
    title: 'A brand uploaded garments before products were discovered',
    body: 'That is acceptable for onboarding, but product suggestions and confirmation should only happen after catalog discovery has provided product context.',
  },
];

const mappingHelp = [
  {
    title: 'What is a suggested match?',
    body: 'It is DrapixAI proposing which discovered product a validated garment likely belongs to. Suggestions should be assistive, not final.',
  },
  {
    title: 'Why do we still need manual confirmation?',
    body: 'Because a wrong garment-to-product link breaks trust immediately. A human should approve the final pairing before the storefront uses it.',
  },
  {
    title: 'What should the SDK use?',
    body: 'The SDK should use only confirmed mappings. Discovery and suggestion help reduce manual work, but live shopper traffic should depend on approved pairings only.',
  },
];

const tryOnHelp = [
  {
    title: 'Try-on result looks weak or unrealistic',
    body: 'Use a clean, front-facing person image with visible upper body and better lighting. Also confirm the garment image is garment-only, color-accurate, and belongs to a launch-ready or carefully reviewed beta upper-body category.',
  },
  {
    title: 'Try-on fails immediately',
    body: 'Immediate failure usually means one of these: missing or expired shopper token, unauthorized domain, wrong product scope, unconfirmed mapping, unsupported image, or AI service not reachable.',
  },
  {
    title: 'Try-on starts but times out',
    body: 'That usually points to AI worker pressure, Redis issues, model readiness problems, or an underpowered GPU environment. For public launch, validate this on the Runpod A100 first.',
  },
];

const integrationTips = [
  'The browser SDK is the fastest way to embed DrapixAI into a product page.',
  'The REST API is language-agnostic and can be called from JavaScript, Python, PHP, Laravel, Django, Node, Go, Java, or any stack that supports HTTP and multipart uploads.',
  'Brands should understand the public workflow as confirmed mappings, even if stable product IDs still exist behind the scenes.',
  'Use the Settings meta tag only as proof of domain ownership, not as the first onboarding step.',
  'Run product discovery before asking a team to review suggested matches.',
  'Keep the public web app pointed at the API service, and keep the API pointed at the live AI service only after A100 staging succeeds.',
];

const quickStartEmbed = `<script src="${getSdkScriptUrl()}"></script>
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token?productId=' + encodeURIComponent(productId));
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    productId: 'sku-12345',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`;

const autoAttachSnippet = `<script src="${getSdkScriptUrl()}"></script>

<div data-drapix-product-id="shirt-001">
  <div data-drapix-button-slot></div>
</div>

<script>
  DrapixAI.init({
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token?productId=' + encodeURIComponent(productId));
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    autoAttach: true,
    productSelector: '[data-drapix-product-id]',
    productIdAttribute: 'data-drapix-product-id',
    buttonTargetSelector: '[data-drapix-button-slot]',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`;

const curlTryOn = `# Run this token exchange on your backend, never in shopper JavaScript.
TOKEN=$(curl -sS -X POST '${PUBLIC_API_BASE_URL}/sdk/storefront-token' \\
  -H "Authorization: Bearer $DRAPIXAI_SERVER_KEY" \\
  -H 'Content-Type: application/json' \\
  --data '{"channel":"web","productIds":["sku-12345"]}' | jq -r '.token')

curl -X POST '${PUBLIC_API_BASE_URL}/sdk/tryon' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Origin: https://store.example.com' \\
  -F 'productId=sku-12345' \\
  -F 'person_image=@./person.jpg' \\
  -F 'garment_type=upper' \\
  -F 'quality=standard' \\
  --output tryon-result.png`;

const pythonExample = `import os
import requests

api_base = "${PUBLIC_API_BASE_URL}"
store_origin = "https://store.example.com"
token_response = requests.post(
    f"{api_base}/sdk/storefront-token",
    headers={"Authorization": f"Bearer {os.environ['DRAPIXAI_SERVER_KEY']}"},
    json={"channel": "web", "productIds": ["sku-12345"]},
    timeout=10,
)
token_response.raise_for_status()
shopper_token = token_response.json()["token"]

with open("person.jpg", "rb") as person_image:
    response = requests.post(
        f"{api_base}/sdk/tryon",
        headers={"Authorization": f"Bearer {shopper_token}", "Origin": store_origin},
        data={
            "productId": "sku-12345",
            "garment_type": "upper",
            "quality": "standard",
        },
        files={"person_image": person_image},
        timeout=180,
    )

response.raise_for_status()
with open("tryon-result.png", "wb") as output:
    output.write(response.content)`;

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav active="help" />
      <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12 lg:py-16">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="self-start border-t border-black/10 pt-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <div className="mb-7 border-b border-black/10 pb-5">
              <div className="flex min-w-0 items-start gap-3">
                <Search className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#667169]" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">Browse help topics</p>
                  <p className="mt-1 text-xs leading-5 text-[#748078]">
                    Use the section list below for setup help, troubleshooting, and support questions.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-xl font-semibold">DrapixAI Help</p>
              <p className="mt-2 text-sm text-[#68736b]">
                One place for onboarding, SDK setup, troubleshooting, rollout guidance, and support-first answers.
              </p>
            </div>

            <nav className="space-y-1">
              {sidebarSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block border-l-2 border-transparent px-3 py-2 text-sm text-[#5d6961] hover:border-[#31725b] hover:bg-[#edf2ed] hover:text-[#172019]"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 self-start">
            <section id="overview" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <p className="mb-4 text-xs font-bold uppercase text-[#31725b]">Help Center</p>
              <h1 className="mb-5 max-w-4xl break-words font-serif text-4xl leading-[1.05] text-[#101712] sm:text-5xl md:text-6xl">Setup, troubleshooting, and rollout answers.</h1>
              <p className="max-w-4xl text-lg leading-8 text-[#5d6961]">
                DrapixAI guidance is organized around the confirmed mapping flow: garment upload and validation, catalog discovery, suggested matches, manual confirmation, then SDK install on confirmed pairings only.
              </p>

              <div className="mt-10 grid grid-cols-1 border-y border-black/10 md:grid-cols-2 md:divide-x md:divide-black/10">
                <div className="py-6 md:pr-7">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-300" />
                    <p className="font-semibold text-[#7c5620]">Common failure</p>
                  </div>
                  <p className="leading-7 text-[#5d6961]">
                    Most failed try-ons are still caused by weak garment inputs, missing product context, or storefront logic being turned on before the preview path is trustworthy.
                  </p>
                </div>

                <div className="border-t border-black/10 py-6 md:border-t-0 md:pl-7">
                  <div className="flex items-center gap-3 mb-3">
                    <Info className="h-5 w-5 text-[#31725b]" />
                    <p className="font-semibold text-[#183f32]">Production note</p>
                  </div>
                  <p className="leading-7 text-[#5d6961]">
                    For serious rollout testing, finish one full staging pass with the Runpod A100 stack before exposing DrapixAI publicly on a production storefront.
                  </p>
                </div>
              </div>
            </section>

            <section id="getting-started" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Sparkles className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Getting Started</h2>
              </div>

              <div className="space-y-4 text-[#5d6961]">
                <p>Use this order for the cleanest setup:</p>
                {[
                  'Create an account and generate a server key that stays only in your backend secret manager.',
                  'Open Settings and save your store domain, but do not rush live verification yet.',
                  'Upload a few garment-only upper-body assets and let DrapixAI validate them first.',
                  'Run product discovery with a feed, import, or product list to create product context.',
                  'Review the suggested matches and confirm the correct pairings manually.',
                  'Run one internal try-on preview before you expose the SDK publicly.',
                  'Install the browser SDK or call the REST API only after those pairings feel trusted.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-[#31725b]" />
                    <p className="leading-7">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <p className="mb-3 text-sm font-semibold">Web SDK quick start</p>
                <pre className="overflow-x-auto border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
{quickStartEmbed}
                </pre>
                <div className="mt-4">
                  <Link href="#integration-help" className="inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]">
                    Jump to full integration guidance
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </section>

            <section id="before-support" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <CircleHelp className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Before You Contact Support</h2>
              </div>
              <div className="grid grid-cols-1 border-y border-black/10 md:grid-cols-2">
                {quickChecks.map((item) => (
                  <div key={item} className="border-b border-black/10 p-5 odd:md:border-r">
                    <p className="leading-7 text-[#5d6961]">{item}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="account-access" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Lock className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Account &amp; Access</h2>
              </div>
              <div className="space-y-4">
                {accountHelp.map((item) => (
                  <div key={item.title} className="border-b border-black/10 py-5 first:border-t">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="leading-7 text-[#5d6961]">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="garments-images" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Upload className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Garments &amp; Images</h2>
              </div>
              <div className="space-y-4">
                {garmentHelp.map((item) => (
                  <div key={item.title} className="border-b border-black/10 py-5 first:border-t">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="leading-7 text-[#5d6961]">{item.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 border-l-4 border-[#31725b] bg-[#eaf0e9] p-5">
                <h3 className="text-lg font-semibold mb-3">Brand onboarding language to use</h3>
                <div className="space-y-2 text-[#5d6961]">
                  <p>1. Upload garments first and let DrapixAI validate the image quality.</p>
                  <p>2. Discover products next so the system has catalog context.</p>
                  <p>3. Review suggested matches instead of forcing the brand to manage IDs manually.</p>
                  <p>4. Confirm the right pairings before the storefront goes live.</p>
                </div>
              </div>
            </section>

            <section id="matches-confirmation" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Code2 className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Matches &amp; Confirmation</h2>
              </div>
              <div className="space-y-4">
                {mappingHelp.map((item) => (
                  <div key={item.title} className="border-b border-black/10 py-5 first:border-t">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="leading-7 text-[#5d6961]">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="tryon-results" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Wand2 className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Try-On Results</h2>
              </div>
              <div className="space-y-4">
                {tryOnHelp.map((item) => (
                  <div key={item.title} className="border-b border-black/10 py-5 first:border-t">
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="leading-7 text-[#5d6961]">{item.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <p className="mb-3 text-sm font-semibold">Direct API try-on example</p>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
{curlTryOn}
                </pre>
              </div>
            </section>

            <section id="integration-help" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Code2 className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Integration Help</h2>
              </div>
              <div className="space-y-4 mb-8">
                {integrationTips.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-[#31725b]" />
                    <p className="leading-7 text-[#5d6961]">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mb-8 border-l-4 border-[#31725b] bg-[#eaf0e9] p-5">
                <h3 className="text-lg font-semibold mb-3">Store connection order</h3>
                <div className="space-y-2 text-[#5d6961]">
                  <p>1. Save the store domain and generate the verification meta tag in Settings.</p>
                  <p>2. Upload garments and run product discovery before you worry about live storefront behavior.</p>
                  <p>3. Review the suggested matches and confirm the right pairings.</p>
                  <p>4. Verify the live domain and install the SDK only after preview quality is trusted.</p>
                  <p>5. Re-sync upper-body catalog items whenever the store assortment changes.</p>
                </div>
              </div>

              <div className="mb-8 border-t border-black/10 pt-6">
                <h3 className="text-lg font-semibold mb-3">Browser SDK single-product install</h3>
                <pre className="overflow-x-auto border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
{quickStartEmbed}
                </pre>
              </div>

              <div className="mb-8 border-t border-black/10 pt-6">
                <h3 className="text-lg font-semibold mb-3">Browser SDK auto-attach install</h3>
                <pre className="overflow-x-auto border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
{autoAttachSnippet}
                </pre>
              </div>

              <div className="border-t border-black/10 pt-6">
                <h3 className="text-lg font-semibold mb-3">Python example</h3>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-black/10 bg-[#101712] p-5 text-sm leading-7 text-[#d3ddd5]">
{pythonExample}
                </pre>
              </div>
            </section>

            <section id="limits-billing" className="scroll-mt-6 border-t border-black/10 py-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <Settings2 className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">Limits &amp; Billing</h2>
              </div>
              <div className="space-y-4 text-[#5d6961]">
                <p>Trial, Starter, and Growth are the current public plans. Requests can fail even with a valid shopper token if the account has already consumed its quota.</p>
                <p>Pro should currently be explained as coming soon and tied to future full-body try-ons, not as a plan brands can activate today.</p>
                <p>If a customer believes the limit is wrong, first check the dashboard usage counts and the admin analytics panel before assuming a billing issue.</p>
                <p>Upgrade links should point customers to the pricing page until the live billing flow is finalized, and enterprise requests should go through the sales contact path.</p>
              </div>
            </section>

            <section id="contact-support" className="scroll-mt-6 border-t border-black/10 bg-[#eaf0e9] px-5 py-10 md:px-10 md:py-14">
              <div className="flex items-center gap-3 mb-5">
                <LifeBuoy className="h-6 w-6 text-[#31725b]" />
                <h2 className="text-3xl font-semibold">When To Contact Support</h2>
              </div>
              <div className="space-y-4 text-[#536057]">
                <p>Contact support only after you have already checked garment validation, catalog discovery, suggested matches, confirmation status, domain validation, AI readiness, and plan/quota status.</p>
                <p>When opening a support request, include:</p>
                <div className="space-y-2">
                  {[
                    'the account email or brand name',
                    'the affected domain',
                    'the garment asset or product identifier',
                    'whether discovery and confirmation already happened',
                    'the exact endpoint that failed',
                    'the error message or screenshot',
                    'whether the issue happened on demo, staging, or production',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-[#31725b]" />
                      <p>{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-8">
                <Link href="/contact" className="inline-flex h-12 items-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
                  Contact Support
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/demo" className="inline-flex h-12 items-center gap-2 border border-black/15 bg-white px-5 text-sm font-bold hover:bg-[#f1f4f0]">
                  Open Live Demo
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
      <MarketingFooter />
    </main>
  );
}
