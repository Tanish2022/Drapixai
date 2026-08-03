import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Code2, ExternalLink, Store, Upload } from 'lucide-react';
import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Developer Quickstart',
  description: 'Prepare one product and complete your first DrapixAI storefront try-on.',
};

const curlSnippet = `# Run this exchange on your backend. Never expose SERVER_API_KEY to a browser or app.
TOKEN=$(curl -s -X POST '${PUBLIC_API_BASE_URL}/v1/tokens' \\
  -H 'Authorization: Bearer SERVER_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{"scopes":["api:tryon"],"product_ids":["YOUR_CONFIRMED_PRODUCT_ID"]}' | jq -r .access_token)

curl -X POST '${PUBLIC_API_BASE_URL}/v1/tryons' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -F 'productId=YOUR_CONFIRMED_PRODUCT_ID' \\
  -F 'person_image=@./person.jpg' \\
  -F 'garment_type=upper' \\
  -F 'quality=standard' \\
  --output tryon-result.png`;

const steps = [
  {
    icon: Store,
    title: 'Connect the catalog',
    body: 'Install the Shopify app or register a web workspace. Shopify imports products and variants with read-only catalog access.',
    action: 'Open dashboard',
    href: '/dashboard',
  },
  {
    icon: Upload,
    title: 'Approve one garment',
    body: 'DrapixAI prepares an eligible product image once. Review the cache and confirm the product mapping before it reaches shoppers.',
    action: 'Prepare a product',
    href: '/dashboard#garment-onboarding',
  },
  {
    icon: Code2,
    title: 'Install and verify',
    body: 'Add the Theme App Extension block, test in theme preview, and publish only after the product returns an approved result.',
    action: 'Open installation',
    href: '/sdk-install',
  },
];

const apiPlans = [
  { name: 'Starter', price: '$49', quota: '1,000', effective: '$0.0490 / result' },
  { name: 'Growth', price: '$199', quota: '7,500', effective: '$0.0265 / result' },
  { name: 'Pro', price: '$499', quota: '25,000', effective: '$0.0200 / result' },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav active="developers" />

      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:px-12">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase text-[#31725b]">Developer quickstart</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.02] text-[#101712] sm:text-6xl">One approved product. One working try-on.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#5b665e]">
              DrapixAI prepares a garment once, connects it to the product ID, and serves that approved asset through Shopify or the REST API.
            </p>
          </div>

          <div className="border-l border-black/10 lg:pl-10">
            <p className="text-sm font-semibold text-[#172019]">Expected first integration</p>
            <p className="mt-2 text-3xl font-semibold text-[#183f32]">About one afternoon</p>
            <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-7 border-t border-black/10 pt-7 text-sm">
              <div><dt className="text-[#748078]">Generation mode</dt><dd className="mt-1 font-semibold">Standard</dd></div>
              <div><dt className="text-[#748078]">Garment source</dt><dd className="mt-1 font-semibold">Approved cache</dd></div>
              <div><dt className="text-[#748078]">Storefront install</dt><dd className="mt-1 font-semibold">Theme block</dd></div>
              <div><dt className="text-[#748078]">API response</dt><dd className="mt-1 font-semibold">Image bytes</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="grid border-y border-black/10 lg:grid-cols-3 lg:divide-x lg:divide-black/10">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="border-b border-black/10 py-8 last:border-b-0 lg:border-b-0 lg:px-8 lg:first:pl-0 lg:last:pr-0">
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-[#31725b]" />
                  <span className="text-xs font-bold text-[#9aa39c]">0{index + 1}</span>
                </div>
                <h2 className="mt-8 text-xl font-semibold">{step.title}</h2>
                <p className="mt-3 min-h-24 leading-7 text-[#637068]">{step.body}</p>
                <Link href={step.href} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]">
                  {step.action} <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bg-[#eaf0e9]">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:px-12">
          <div>
            <p className="text-xs font-bold uppercase text-[#31725b]">Release gate</p>
            <h2 className="mt-4 font-serif text-4xl text-[#101712]">Before the block goes live</h2>
            <div className="mt-8 space-y-4 text-sm">
              {['Store domain verified', 'Garment preprocessing complete', 'Product mapping confirmed', 'Internal preview approved'].map((item) => (
                <p key={item} className="flex items-center gap-3 border-b border-black/10 pb-4">
                  <span className="flex h-6 w-6 items-center justify-center bg-[#183f32] text-white"><Check className="h-4 w-4" /></span>{item}
                </p>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 sm:p-10">
            <div className="flex flex-col justify-between gap-4 border-b border-black/10 pb-6 sm:flex-row sm:items-start">
              <div>
                <p className="text-xl font-semibold">Shopify-native installation</p>
                <p className="mt-2 text-sm text-[#68736b]">No Liquid edit or product-ID copying is required.</p>
              </div>
              <span className="w-fit border border-[#9bb6a8] px-3 py-1 text-xs font-bold text-[#183f32]">Recommended</span>
            </div>
            <ol className="mt-7 space-y-5 text-sm leading-7 text-[#536057]">
              <li><strong className="mr-2 text-[#172019]">01</strong> Install DrapixAI and approve read-only product access.</li>
              <li><strong className="mr-2 text-[#172019]">02</strong> Review the prepared garment and confirm the product mapping.</li>
              <li><strong className="mr-2 text-[#172019]">03</strong> Add the try-on block, preview the product template, then save the theme.</li>
            </ol>
            <Link href="/sdk-install" className="mt-8 inline-flex h-12 items-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
              Open Shopify setup <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white">
        <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="text-xs font-bold uppercase text-[#31725b]">API usage pricing</p>
              <h2 className="mt-4 font-serif text-4xl text-[#101712]">Successful results consume quota.</h2>
              <p className="mt-5 max-w-md leading-7 text-[#68736b]">SDK and REST API usage share the same monthly allowance. Quality-gate rejections and idempotent retries do not consume another unit.</p>
              <Link href="/pricing" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]">
                Full billing rules <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid border-y border-black/10 sm:grid-cols-3 sm:divide-x sm:divide-black/10">
              {apiPlans.map((plan) => (
                <div key={plan.name} className="border-b border-black/10 py-7 last:border-b-0 sm:border-b-0 sm:px-7">
                  <p className="text-sm font-bold text-[#31725b]">{plan.name}</p>
                  <p className="mt-4 font-serif text-4xl">{plan.price}<span className="ml-1 font-sans text-xs text-[#748078]">/ month</span></p>
                  <p className="mt-5 font-semibold">{plan.quota} successful try-ons</p>
                  <p className="mt-1 text-sm text-[#748078]">{plan.effective}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-8 border-t border-black/10 pt-5 text-sm leading-6 text-[#68736b]">No automatic overages at launch. HTTP 422 quality rejections, validation failures, token exchange, usage reads, webhook operations, and OpenAPI access are not counted.</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.35fr_0.65fr] lg:px-12">
        <div className="min-w-0 border border-black/10 bg-[#101712] text-white">
          <div className="border-b border-white/15 px-5 py-4">
            <p className="font-semibold">Versioned REST API smoke test</p>
            <p className="mt-1 text-sm text-[#9fac9f]">Uses a short-lived token, product scope, and an idempotency key.</p>
          </div>
          <pre className="overflow-x-auto p-5 text-sm leading-7 text-[#d3ddd5]"><code>{curlSnippet}</code></pre>
        </div>
        <div className="flex flex-col justify-between border-t border-black/10 pt-7">
          <div>
            <p className="text-xs font-bold uppercase text-[#31725b]">Need a hand?</p>
            <h2 className="mt-4 text-2xl font-semibold">Errors, image rules, and rollout checks</h2>
            <p className="mt-3 leading-7 text-[#68736b]">The Help Center documents the states your team will see during onboarding and launch.</p>
          </div>
          <Link href="/help" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]">
            Open Help Center <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
