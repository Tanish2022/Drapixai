import Link from 'next/link';
import { ArrowRight, Check, Mail } from 'lucide-react';
import MarketingFooter from '../components/MarketingFooter';
import MarketingNav from '../components/MarketingNav';

const TRIAL_TRYONS = 300;

const paidPlans = [
  {
    name: 'Starter',
    price: '$49',
    volume: '1,000 upper-body try-ons / month',
    unitPrice: '$0.049 per try-on',
    description: 'For small brands validating demand on a focused group of live product pages.',
    features: ['1 production domain', 'Standard quality mode', 'Dashboard analytics', 'SDK + REST API access', 'Email support'],
    href: '/auth/register?plan=starter',
  },
  {
    name: 'Growth',
    price: '$149',
    volume: '5,000 upper-body try-ons / month',
    unitPrice: '$0.0298 per try-on',
    description: 'For growing stores that have proven shopper usage and need stronger unit economics.',
    features: ['1 production domain', 'Standard quality mode', 'Advanced analytics', 'SDK + REST API access', 'Priority email support'],
    href: '/auth/register?plan=growth',
    recommended: true,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#172019]">
      <MarketingNav active="pricing" />

      <main>
        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[1.15fr_0.85fr]">
            <div className="px-5 py-16 sm:px-8 lg:border-r lg:border-black/10 lg:px-12 lg:py-24">
              <p className="text-xs font-bold uppercase text-[#2b654f]">Pricing</p>
              <h1 className="mt-5 max-w-4xl font-serif text-5xl font-normal leading-[1.02] sm:text-6xl lg:text-7xl">Prove the workflow before you pay for scale.</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-[#59645c]">Every public plan starts with the same evaluation path. Test DrapixAI on your own upper-body products, review the evidence, and upgrade only when your team is comfortable publishing it.</p>
            </div>
            <div className="flex flex-col justify-between border-t border-black/10 bg-[#b8d8c7] px-5 py-10 sm:px-8 lg:border-t-0 lg:px-12 lg:py-16">
              <p className="text-sm font-bold uppercase text-[#1e5b44]">Included with every plan</p>
              <div className="mt-12">
                <p className="font-serif text-7xl leading-none text-[#102018]">{TRIAL_TRYONS}</p>
                <p className="mt-3 text-xl font-bold">trial try-ons</p>
                <p className="mt-4 max-w-md leading-7 text-[#385345]">No credit card required. Use the trial for product preparation, internal previews, and quality review before storefront rollout.</p>
              </div>
              <Link href="/auth/register" className="mt-10 inline-flex h-14 w-fit items-center gap-2 bg-[#172019] px-6 py-4 font-semibold text-white hover:bg-[#26352a]">Start the trial <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 py-16 lg:py-24">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="flex flex-col justify-between gap-5 border-b border-black/15 pb-8 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-bold uppercase text-[#2b654f]">Public plans</p>
                <h2 className="mt-4 font-serif text-4xl font-normal sm:text-5xl">Upper-body launch pricing</h2>
              </div>
              <p className="max-w-lg text-sm leading-6 text-[#667168]">Both plans use the same Standard generation quality. You choose by monthly volume, not by accepting a weaker output mode.</p>
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {paidPlans.map((plan) => (
                <article key={plan.name} className={`border bg-white ${plan.recommended ? 'border-[#2b745a]' : 'border-black/12'}`}>
                  <div className="flex items-center justify-between border-b border-black/10 px-6 py-5 sm:px-8">
                    <div>
                      <h3 className="text-2xl font-bold">{plan.name}</h3>
                      <p className="mt-1 text-sm text-[#68736b]">{plan.description}</p>
                    </div>
                    {plan.recommended ? <span className="bg-[#d9ecdf] px-3 py-2 text-xs font-bold uppercase text-[#1c6047]">Best value</span> : null}
                  </div>
                  <div className="grid sm:grid-cols-[0.9fr_1.1fr]">
                    <div className="border-b border-black/10 p-6 sm:border-b-0 sm:border-r sm:p-8">
                      <p className="font-serif text-6xl leading-none">{plan.price}</p>
                      <p className="mt-2 text-sm text-[#68736b]">per month</p>
                      <p className="mt-8 font-bold text-[#1f684e]">{plan.volume}</p>
                      <p className="mt-1 text-sm text-[#68736b]">{plan.unitPrice}</p>
                    </div>
                    <div className="flex flex-col p-6 sm:p-8">
                      <ul className="flex-1 space-y-4">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-3 text-sm leading-6 text-[#4e5a51]"><Check className="mt-1 h-4 w-4 flex-none text-[#26725a]" />{feature}</li>
                        ))}
                      </ul>
                      <Link href={plan.href} className={`mt-8 inline-flex h-12 items-center justify-center gap-2 px-5 font-semibold ${plan.recommended ? 'bg-[#183f32] text-white hover:bg-[#245a48]' : 'border border-black/20 hover:bg-[#f1f4ef]'}`}>Start trial <ArrowRight className="h-4 w-4" /></Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
            <div className="border-b border-black/10 px-5 py-14 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-20">
              <p className="text-xs font-bold uppercase text-[#2b654f]">Coming later</p>
              <h2 className="mt-5 font-serif text-4xl font-normal">Pro / full-body</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-[#59645c]">Full-body try-on remains outside the current public launch promise. Pricing will be published only after quality, latency, and garment coverage meet the same release bar.</p>
              <span className="mt-8 inline-flex border border-black/15 px-4 py-3 text-sm font-bold uppercase text-[#5f6b62]">Coming soon</span>
            </div>
            <div className="bg-[#172019] px-5 py-14 text-white sm:px-8 lg:px-12 lg:py-20">
              <p className="text-xs font-bold uppercase text-[#8cd3b3]">Enterprise</p>
              <h2 className="mt-5 font-serif text-4xl font-normal">Custom volume and onboarding.</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-[#bdc7bf]">For larger brands, multi-store teams, negotiated usage, private rollout planning, or direct commercial support.</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {['Custom usage allocation', 'Commercial onboarding', 'Priority solution design', 'Private support workflow'].map((feature) => (
                  <span key={feature} className="flex items-center gap-2 border-t border-white/15 py-3 text-sm text-[#d4ddd6]"><Check className="h-4 w-4 text-[#8cd3b3]" />{feature}</span>
                ))}
              </div>
              <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Enterprise%20Sales%20Inquiry" className="mt-8 inline-flex h-12 items-center gap-2 border border-white/30 px-5 font-semibold hover:bg-white/10"><Mail className="h-4 w-4" />Contact sales</a>
            </div>
          </div>
        </section>

        <section className="bg-[#eef2ec] py-16 lg:py-20">
          <div className="mx-auto grid max-w-[1440px] gap-px border border-black/10 bg-black/10 sm:grid-cols-3">
            {[
              ['Trial before billing', `Validate quality with ${TRIAL_TRYONS} try-ons before monthly usage begins.`],
              ['One quality mode', 'Starter and Growth both use Standard. Volume does not change garment realism.'],
              ['Controlled upgrade', 'Move into paid usage only after product preparation and internal review are complete.'],
            ].map(([title, body]) => (
              <div key={title} className="bg-[#eef2ec] p-6 sm:p-8"><h3 className="text-lg font-bold">{title}</h3><p className="mt-3 leading-7 text-[#647068]">{body}</p></div>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
