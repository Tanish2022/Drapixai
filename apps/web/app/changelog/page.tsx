import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, FileCode2, ShieldCheck } from 'lucide-react';
import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'DrapixAI product, SDK, quality, and platform updates.',
};

const releases = [
  {
    date: 'July 2026',
    title: 'Controlled try-on launch foundation',
    status: 'Current',
    items: [
      'Standard-only shopper generation with direct and SDK quality metadata.',
      'DrapixAI Ready garment certification and cache-readiness gates.',
      'Excellent, Review, and Not publishable confidence decisions.',
      'Automatic rejection for blocking pose, identity, color, structure, and artifact risks.',
      'Product accuracy reporting for color, print/logo, sleeve, hem, collar, and texture.',
      'Brand-adaptive SDK UI with download, purchase, feedback, and customer-safe failure states.',
      'Five-minute developer quickstart and public service-readiness page.',
      'Shopify authorization, automatic product synchronization, and authenticated lifecycle webhooks.',
      'Theme App Extension with one-click activation and review-gated garment preparation.',
    ],
  },
  {
    date: 'Next',
    title: 'Shopify conversion attribution',
    status: 'Planned',
    items: [
      'Try-on to add-to-cart and order attribution.',
      'Variant-aware conversion reporting and merchant cohort analytics.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav />
      <section className="border-b border-black/10">
        <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 md:py-24 lg:px-12">
          <p className="text-xs font-bold uppercase text-[#31725b]">Product updates</p>
          <h1 className="mt-5 max-w-3xl font-serif text-5xl leading-[1.02] text-[#101712] sm:text-6xl">What changed, and why it matters.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5d6961]">A plain-language record of shipped quality, SDK, onboarding, and platform changes.</p>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="space-y-14">
          {releases.map((release) => (
            <article key={release.title} className="grid gap-8 border-t border-black/10 pt-8 lg:grid-cols-[220px_1fr]">
              <div>
                <p className="text-sm font-semibold text-[#68736b]">{release.date}</p>
                <span className={`mt-4 inline-flex border px-3 py-1 text-xs font-bold ${release.status === 'Current' ? 'border-[#9bb6a8] bg-[#eaf0e9] text-[#183f32]' : 'border-black/15 text-[#68736b]'}`}>{release.status}</span>
              </div>
              <div>
                <h2 className="text-3xl font-semibold">{release.title}</h2>
                <ul className="mt-7 grid gap-x-10 gap-y-4 md:grid-cols-2">
                  {release.items.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-[#5d6961]"><Check className="mt-1 h-4 w-4 flex-shrink-0 text-[#31725b]" /><span>{item}</span></li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-16 grid border-y border-black/10 sm:grid-cols-2 sm:divide-x sm:divide-black/10">
          <Link href="/docs" className="flex items-center justify-between gap-3 border-b border-black/10 py-6 font-bold hover:text-[#31725b] sm:border-b-0 sm:pr-8"><span className="flex items-center gap-3"><FileCode2 className="h-5 w-5 text-[#31725b]" />Developer quickstart</span><ArrowRight className="h-4 w-4" /></Link>
          <Link href="/status" className="flex items-center justify-between gap-3 py-6 font-bold hover:text-[#31725b] sm:pl-8"><span className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-[#31725b]" />Service status</span><ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
