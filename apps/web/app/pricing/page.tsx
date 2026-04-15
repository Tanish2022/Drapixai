'use client';

import Link from 'next/link';
import { ArrowRight, Check, Mail, Sparkles, Zap } from 'lucide-react';

const TRIAL_TRYONS = 300;

const plans = [
  {
    name: 'Starter',
    price: 49,
    tryons: '1,000',
    perTryOn: '$0.049',
    badge: 'Entry Plan',
    accent: 'from-slate-200/20 to-white/5',
    border: 'border-white/[0.08]',
    cta: '/auth/register?plan=starter',
    description: 'For small brands validating demand and testing AI try-on on live product pages.',
    features: [
      '1,000 try-ons per month',
      'Upper-body garments only',
      '1 production domain',
      'Standard support',
      'Dashboard analytics',
      'SDK + REST API access',
    ],
  },
  {
    name: 'Growth',
    price: 149,
    tryons: '7,500',
    perTryOn: '$0.0199',
    badge: 'Best Value',
    accent: 'from-cyan-400/20 to-blue-500/10',
    border: 'border-cyan-400/30',
    cta: '/auth/register?plan=growth',
    description: 'For growing stores that need stronger unit economics and regular try-on usage.',
    highlights: '59% lower cost per try-on than Starter',
    features: [
      '7,500 try-ons per month',
      'Upper-body garments only',
      '1 production domain',
      'Priority email support',
      'Advanced analytics',
      'Better margin for high-traffic products',
    ],
  },
  {
    name: 'Pro',
    price: 399,
    tryons: '25,000',
    perTryOn: '$0.0160',
    badge: 'Scale Plan',
    accent: 'from-blue-500/20 to-cyan-400/10',
    border: 'border-blue-400/30',
    cta: '/auth/register?plan=pro',
    description: 'For serious brands and higher-volume teams running DrapixAI as a real conversion lever.',
    highlights: 'Best blended value before enterprise support',
    features: [
      '25,000 try-ons per month',
      'Upper-body garments only',
      'Priority support queue',
      'Admin analytics + ops visibility',
      'Best public pricing efficiency',
      'Built for serious staging and launch traffic',
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[720px] bg-gradient-glow opacity-40" />
        <div className="absolute bottom-0 right-0 w-[520px] h-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="max-w-4xl mb-14">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Pricing</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Simple plans, stronger value as usage scales.</h1>
          <p className="text-lg text-gray-300 leading-8 max-w-3xl">
            Every public plan starts with the same free evaluation path: activate your account, use up to {TRIAL_TRYONS} trial try-ons, validate quality on your own products, then continue on the plan that matches your monthly volume.
          </p>
        </div>

        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6 mb-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-emerald-300" />
                <p className="font-semibold text-emerald-200">Free Trial Included On Every Plan</p>
              </div>
              <p className="text-gray-100 leading-7">
                Use the same trial regardless of plan choice, evaluate output quality with your own catalog, and upgrade only once the workflow is proven for your team.
              </p>
            </div>
            <Link
              href="/auth/register"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 px-5 py-3 font-semibold hover:bg-white/[0.05] transition-colors"
            >
              Start {TRIAL_TRYONS} Try-On Trial
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_320px] gap-6 items-stretch">
          {plans.map((plan, index) => (
            <section
              key={plan.name}
              className={`relative overflow-hidden rounded-3xl bg-[#0b1120]/75 backdrop-blur-xl p-8 ${plan.border} ${index === 1 ? 'xl:-translate-y-3 shadow-[0_24px_80px_rgba(34,211,238,0.12)]' : ''}`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${plan.accent} opacity-70`} />
              <div className="relative z-10 h-full flex flex-col">
                <div className="flex items-center justify-between gap-3 mb-6">
                  <div>
                    <p className="text-2xl font-bold">{plan.name}</p>
                    <p className="text-sm text-gray-400 mt-1">{plan.badge}</p>
                  </div>
                  {index === 1 ? (
                    <span className="rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1 text-xs font-semibold text-cyan-100">
                      Recommended
                    </span>
                  ) : null}
                </div>

                <div className="mb-6">
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-bold">${plan.price}</span>
                    <span className="text-lg text-gray-400 mb-1">/mo</span>
                  </div>
                  <p className="mt-2 text-cyan-200 font-medium">{plan.tryons} try-ons per month</p>
                  <p className="text-sm text-gray-400 mt-1">Effective price: {plan.perTryOn} per try-on</p>
                </div>

                <p className="text-gray-300 leading-7 mb-4">{plan.description}</p>

                {plan.highlights ? (
                  <div className="rounded-2xl border border-cyan-300/20 bg-black/20 p-4 mb-6">
                    <p className="text-sm font-medium text-cyan-100">{plan.highlights}</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 mb-6">
                    <p className="text-sm text-gray-300">Includes the same {TRIAL_TRYONS} try-on free trial before you commit.</p>
                  </div>
                )}

                <div className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                      <p className="text-gray-200 leading-7">{feature}</p>
                    </div>
                  ))}
                </div>

                <Link
                  href={plan.cta}
                  className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold transition-colors ${
                    index === 1
                      ? 'bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90'
                      : 'border border-white/[0.12] hover:bg-white/[0.05]'
                  }`}
                >
                  Start Trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </section>
          ))}

          <aside className="rounded-3xl border border-amber-400/25 bg-[#0b1120]/80 backdrop-blur-xl p-8 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-5 h-5 text-amber-300" />
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-200">Enterprise</p>
            </div>

            <h2 className="text-3xl font-bold mb-4">Custom volume, custom support.</h2>
            <p className="text-gray-300 leading-7 mb-6">
              For large brands, multi-store teams, negotiated usage, onboarding support, or custom deployment structure.
            </p>

            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 mb-6">
              <p className="text-sm text-gray-200">Best fit if you expect unusually high try-on volume, custom contract terms, or direct commercial onboarding.</p>
            </div>

            <div className="space-y-3 mb-8 flex-1">
              {[
                'Custom volume allocation',
                'Commercial onboarding path',
                'Priority solution design',
                'Optional private support workflow',
              ].map((feature) => (
                <div key={feature} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                  <p className="text-gray-200 leading-7">{feature}</p>
                </div>
              ))}
            </div>

            <a
              href="mailto:sales@drapixai.com?subject=DrapixAI%20Enterprise%20Sales%20Inquiry"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300/30 px-5 py-3 font-semibold hover:bg-white/[0.05] transition-colors"
            >
              <Mail className="w-4 h-4" />
              Contact Sales
            </a>
            <p className="text-xs text-gray-500 mt-3 break-all">sales@drapixai.com</p>
          </aside>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-12">
          <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/75 p-6">
            <h3 className="text-xl font-semibold mb-3">Trial before billing</h3>
            <p className="text-gray-300 leading-7">
              Validate quality and workflow with the same {TRIAL_TRYONS} try-on trial before your team commits to monthly usage.
            </p>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/75 p-6">
            <h3 className="text-xl font-semibold mb-3">Built around upper-body rollout</h3>
            <p className="text-gray-300 leading-7">
              Public plans are intentionally focused on upper-body try-on so quality, speed, and rollout discipline stay cleaner from day one.
            </p>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/75 p-6">
            <h3 className="text-xl font-semibold mb-3">Upgrade when volume is real</h3>
            <p className="text-gray-300 leading-7">
              Start smaller, prove demand, then move into higher monthly volume once DrapixAI becomes part of your live conversion workflow.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
