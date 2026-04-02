'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check, Shield, BarChart3, Code2, Eye, ArrowRight,
  Globe, Gauge, CreditCard, X, Play
} from 'lucide-react';

export default function Home() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  return (
    <div className="min-h-screen bg-[#050816] text-white">

      {/* Background Effects - Applied Globally */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* Main gradient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] bg-gradient-glow opacity-50" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-20" />
        {/* Bottom glow */}
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[100px]" />
      </div>

      {/* NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#050816]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={40}
              height={40}
              className="rounded-xl"
            />
            <span className="text-xl font-bold">DrapixAI</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors hidden md:block">Docs</Link>
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors hidden md:block">Dashboard</Link>
            <Link href="/auth/login" className="text-sm text-gray-300 hover:text-white transition-colors">Sign In</Link>
            <Link href="/auth/register" className="text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity">Start Free Trial</Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden z-10">
        {/* Hero-specific glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-cyan-500/10 rounded-full blur-[120px]" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0b1120]/80 border border-white/[0.08] mb-8">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm text-gray-300">AI Virtual Try-On Infrastructure</span>
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight tracking-tight">
            Increase eCommerce Conversions<br />
            <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">With AI Virtual Try-On</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Boost product page engagement, increase add-to-cart rates, and reduce returns using photorealistic AI try-on technology. Works with any platform via a universal JavaScript SDK.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="/auth/register" className="px-8 py-4 text-lg font-semibold rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(6,182,212,0.2)]">Start 12-Day Free Trial</Link>
            <Link href="/demo" className="px-8 py-4 text-lg font-medium rounded-xl border border-white/[0.1] hover:bg-white/[0.05] transition-colors flex items-center gap-2"><Play className="w-5 h-5" />See Live Demo</Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Setup in under 5 minutes</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Cancel anytime</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Enterprise-ready</span>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="py-20 px-6 border-y border-white/[0.06] relative z-10">
        <div className="max-w-7xl mx-auto">
          <p className="text-center text-gray-500 mb-12">Trusted by 120+ fashion brands globally</p>
          <div className="flex items-center justify-center gap-12 flex-wrap opacity-40 mb-16">
            {['NORDSTROM', 'ZARA', 'H&M', 'UNIQLO', 'MANGO'].map((brand) => (<span key={brand} className="text-xl font-bold text-gray-400 tracking-widest">{brand}</span>))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm text-center"><p className="text-4xl font-bold text-cyan-400 mb-1">+32%</p><p className="text-gray-400">Avg Conversion Increase</p></div>
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm text-center"><p className="text-4xl font-bold text-blue-400 mb-1">+21%</p><p className="text-gray-400">Add-to-Cart Rate</p></div>
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm text-center"><p className="text-4xl font-bold text-green-400 mb-1">-18%</p><p className="text-gray-400">Return Rate</p></div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[{ step: '01', title: 'Upload Product Image', desc: 'Upload your garment images to the dashboard. We process and optimize them automatically.' }, { step: '02', title: 'AI Generates Try-On', desc: 'Our AI detects body pose and generates photorealistic virtual try-on images.' }, { step: '03', title: 'Embed with 1 Line', desc: 'Add a single script tag to your site. Users see try-on right on your product pages.' }].map((item, i) => (<div key={i} className="relative p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm hover:border-white/[0.1] transition-colors"><span className="text-6xl font-bold text-white/[0.04] absolute top-4 right-6">{item.step}</span><h3 className="text-xl font-semibold mb-3">{item.title}</h3><p className="text-gray-400">{item.desc}</p></div>))}
          </div>


          <div className="rounded-2xl bg-[#0a0a0a]/80 border border-white/[0.08] backdrop-blur-sm overflow-hidden">
            <div className="flex gap-2 px-4 py-3 border-b border-white/[0.06]">
              <span className="w-3 h-3 rounded-full bg-red-500/20" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/20" />
              <span className="w-3 h-3 rounded-full bg-green-500/20" />
            </div>
            <div className="p-6 font-mono text-sm overflow-x-auto">
              <pre className="text-gray-300">
                {`<script src="https://cdn.drapixai.com/sdk.js"></script>

<div id="drapixai-container"></div>

<script>
  DrapixAI.init({
    apiKey: 'your-api-key',
    productId: 'your-product-id',
    garmentType: 'upper'
  });
</script>`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ENTERPRISE FEATURES */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16"><h2 className="text-4xl font-bold mb-4">Built for Enterprise Commerce</h2><p className="text-xl text-gray-400">Infrastructure-grade AI that scales with your revenue.</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[{ icon: Globe, title: 'Universal Integration', desc: 'Works with Shopify, WooCommerce, Magento, custom builds.' }, { icon: Gauge, title: 'Sub-10s AI Rendering', desc: 'GPU accelerated pipeline with CDN delivery.' }, { icon: Shield, title: 'Enterprise Security', desc: 'Domain validation, API keys, GDPR compliant, automatic image deletion.' }, { icon: BarChart3, title: 'Revenue Analytics', desc: 'Track conversion uplift and AI-driven sales impact.' }, { icon: Code2, title: 'Developer First', desc: 'Clean APIs, TypeScript SDK, full documentation.' }, { icon: Eye, title: 'Real-Time Monitoring', desc: 'Usage dashboards, quota tracking, webhook support.' }].map((f, i) => (<div key={i} className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm hover:border-cyan-500/20 hover:-translate-y-1 transition-all duration-300"><div className="w-12 h-12 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center mb-4"><f.icon className="w-6 h-6 text-white" /></div><h3 className="text-lg font-semibold mb-2">{f.title}</h3><p className="text-gray-400 text-sm">{f.desc}</p></div>))}
          </div>
        </div>
      </section>

      {/* REVENUE IMPACT */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">Proven Revenue Impact</h2>
          <p className="text-xl text-gray-400 mb-12">AI-powered try-on reduces buyer hesitation and increases purchase confidence.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><BarChart3 className="w-8 h-8 text-cyan-400 mx-auto mb-4" /><p className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">+32%</p><p className="text-gray-400">Product Page Engagement</p></div>
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><CreditCard className="w-8 h-8 text-blue-400 mx-auto mb-4" /><p className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">+21%</p><p className="text-gray-400">Add to Cart</p></div>
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><ArrowRight className="w-8 h-8 text-green-400 mx-auto mb-4" /><p className="text-5xl font-bold bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent mb-2">-18%</p><p className="text-gray-400">Returns</p></div>
          </div>
          <p className="text-gray-400">Join 120+ brands already using DrapixAI to drive more sales.</p>
        </div>
      </section>

      {/* OBJECTION HANDLING */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">Why Teams Choose Us</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="p-8 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 backdrop-blur-sm"><h3 className="text-2xl font-bold mb-6 text-cyan-400">DrapixAI</h3><ul className="space-y-4">{['No platform dependency', '5-minute setup', 'Transparent pricing', 'Developer-friendly APIs', 'Production-ready infrastructure', 'Session-based (no image storage)'].map((item, i) => (<li key={i} className="flex items-center gap-3"><Check className="w-5 h-5 text-cyan-400 flex-shrink-0" /><span>{item}</span></li>))}</ul></div>
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><h3 className="text-2xl font-bold mb-6 text-gray-400">Traditional Solutions</h3><ul className="space-y-4">{['Requires specific platform', 'Weeks of integration', 'Hidden fees', 'Complex APIs', 'Self-hosted required', 'Stores customer photos'].map((item, i) => (<li key={i} className="flex items-center gap-3"><X className="w-5 h-5 text-gray-600 flex-shrink-0" /><span className="text-gray-400">{item}</span></li>))}</ul></div>
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-xl text-gray-400">Start with a 12-day free trial. No credit card required.</p>
          </div>

          {/* Monthly / Annual Toggle */}
          <div className="flex items-center justify-center mb-16">
            <div className="inline-flex items-center bg-[#0b1120]/50 rounded-full p-1 border border-white/[0.06] backdrop-blur-sm">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${billingPeriod === 'monthly' ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod('annual')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${billingPeriod === 'annual' ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Annual <span className="text-cyan-400 text-xs ml-1">Save 15%</span>
              </button>
            </div>
          </div>

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

            {/* Trial Plan */}
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm hover:border-white/[0.1] transition-all duration-300">
              <h3 className="text-xl font-semibold mb-2">Trial</h3>
              <p className="text-gray-400 text-sm mb-6">Perfect for testing our platform</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">Free</span>
                <span className="text-gray-500"> / 12 days</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['300 AI renders', 'Basic support', 'Standard processing', 'Watermarked results'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-cyan-400" /> {feature}
                  </li>
                ))}
              </ul>
              <Link href="/auth/register" className="block w-full py-3 px-4 text-center rounded-xl border border-white/[0.1] text-white font-medium hover:bg-white/[0.05] transition-colors">
                Start Free Trial
              </Link>
            </div>

            {/* Basic Plan */}
            <div className="p-8 rounded-2xl bg-gradient-to-b from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 backdrop-blur-sm relative transform md:-translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-xs font-medium text-white">
                Most Popular
              </div>
              <h3 className="text-xl font-semibold mb-2">Basic</h3>
              <p className="text-gray-400 text-sm mb-6">For growing eCommerce businesses</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">${billingPeriod === 'monthly' ? '49' : '42'}</span>
                <span className="text-gray-500"> / month</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['1,200 AI renders/month', 'Priority support', 'Fast processing', 'No watermark', 'API access'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-cyan-400" /> {feature}
                  </li>
                ))}
              </ul>
              <Link href="/auth/register?plan=basic" className="block w-full py-3 px-4 text-center rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-white font-semibold hover:opacity-90 transition-opacity">
                Get Started
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm hover:border-white/[0.1] transition-all duration-300">
              <h3 className="text-xl font-semibold mb-2">Pro</h3>
              <p className="text-gray-400 text-sm mb-6">For high-volume enterprises</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">${billingPeriod === 'monthly' ? '149' : '127'}</span>
                <span className="text-gray-500"> / month</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['5,000 AI renders/month', '24/7 dedicated support', 'Instant processing', 'No watermark', 'Full API access', 'Custom integrations'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-cyan-400" /> {feature}
                  </li>
                ))}
              </ul>
              <Link href="/auth/register?plan=pro" className="block w-full py-3 px-4 text-center rounded-xl border border-white/[0.1] text-white font-medium hover:bg-white/[0.05] transition-colors">
                Contact Sales
              </Link>
            </div>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap items-center justify-center gap-8 mt-12 pt-12 border-t border-white/[0.06]">
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <Check className="w-4 h-4 text-green-500" /> No credit card required
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <Check className="w-4 h-4 text-green-500" /> Cancel anytime
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <Check className="w-4 h-4 text-green-500" /> 12-day free trial
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <Check className="w-4 h-4 text-green-500" /> Money-back guarantee
            </span>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 px-6 relative z-10 overflow-hidden">
        {/* CTA-specific glow */}
        <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[100px]" />

        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">Ready to Increase Your Conversion Rate?</h2>
          <p className="text-xl text-gray-400 mb-8">Launch AI virtual try-on in minutes. No credit card required.</p>

          <Link href="/auth/register" className="inline-block px-10 py-4 text-xl font-semibold rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity shadow-[0_0_15px_rgba(6,182,212,0.15)]">
          Get Started Free
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 px-6 border-t border-white/[0.06] relative z-10">
        <div className="max-w-7xl mx-auto">

          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">

            <div className="flex items-center gap-2">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={40}
              height={40}
              className="rounded-xl"
            />
              <span className="text-xl font-bold">DrapixAI</span>
            </div>

            <p className="text-gray-500 text-sm">AI Revenue Infrastructure for Fashion Commerce</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 pt-8 border-t border-white/[0.06]">
            <Link href="/docs" className="text-sm text-gray-500 hover:text-white transition-colors">Docs</Link>
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-white transition-colors">Dashboard</Link>
            <Link href="/privacy" className="text-sm text-gray-500 hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="text-sm text-gray-500 hover:text-white transition-colors">Terms</Link>
            <Link href="/refund-policy" className="text-sm text-gray-500 hover:text-white transition-colors">Refunds</Link>
            <Link href="/cookies" className="text-sm text-gray-500 hover:text-white transition-colors">Cookies</Link>
            <Link href="/contact" className="text-sm text-gray-500 hover:text-white transition-colors">Contact</Link>
          </div>

          <div className="text-center mt-8">
            <p className="text-gray-600 text-sm">Copyright 2026 DrapixAI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
