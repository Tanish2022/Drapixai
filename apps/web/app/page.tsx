'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import {
  Check, Shield, BarChart3, Code2, Eye, ArrowRight,
  Globe, Gauge, CreditCard, X, Play, Layers3, Sparkles, ChevronDown, LogOut, Settings2, UserCircle2
} from 'lucide-react';
import { signOut } from 'next-auth/react';

export default function Home() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [hasDashboardAccess, setHasDashboardAccess] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('Profile');
  const [profileSubtitle, setProfileSubtitle] = useState('Manage your account, plan, and dashboard access.');
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sessionApiKey = ((session as any)?.apiKey || '').trim();
    const sessionUserName = ((session as any)?.user?.name || '').trim();
    const sessionUserEmail = ((session as any)?.user?.email || '').trim();

    const loadProfileSummary = async (apiKey: string) => {
      try {
        const response = await fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const payload = (await response.json().catch(() => null)) as { companyName?: string | null; email?: string | null } | null;
        const preferredName = payload?.companyName?.trim()
          || sessionUserName
          || payload?.email?.split('@')[0]
          || sessionUserEmail.split('@')[0]
          || 'Profile';
        const subtitle = payload?.email?.trim() || sessionUserEmail || 'Signed in to DrapixAI';
        setProfileName(preferredName);
        setProfileSubtitle(subtitle);
      } catch {
        const fallbackName = sessionUserName || sessionUserEmail.split('@')[0] || 'Profile';
        const fallbackSubtitle = sessionUserEmail || 'Signed in to DrapixAI';
        setProfileName(fallbackName);
        setProfileSubtitle(fallbackSubtitle);
      }
    };

    if (sessionApiKey) {
      setHasDashboardAccess(true);
      void loadProfileSummary(sessionApiKey);
      return;
    }

    if (sessionStatus === 'loading') {
      return;
    }

    let active = true;
    fetch('/api/dashboard/session', { cache: 'no-store' })
      .then(async (response) => {
        if (active) {
          setHasDashboardAccess(response.ok);
          if (response.ok) {
            const payload = (await response.json().catch(() => null)) as { apiKey?: string } | null;
            const apiKey = payload?.apiKey?.trim();
            if (apiKey) {
              void loadProfileSummary(apiKey);
            }
          } else {
            setProfileName('Profile');
            setProfileSubtitle('Manage your account, plan, and dashboard access.');
          }
        }
      })
      .catch(() => {
        if (active) {
          setHasDashboardAccess(false);
          setProfileName('Profile');
          setProfileSubtitle('Manage your account, plan, and dashboard access.');
        }
      });

    return () => {
      active = false;
    };
  }, [session, sessionStatus]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const handleLogout = () => {
    fetch('/api/dashboard/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        localStorage.removeItem('apiKey');
        setHasDashboardAccess(false);
        setProfileOpen(false);
        signOut({ redirect: false }).catch(() => undefined).finally(() => {
          router.push('/');
        });
      });
  };

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
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between gap-4">
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
            <div className="flex items-center gap-3 md:gap-6">
              <Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors hidden md:block">Pricing</Link>
              <Link href="/help" className="text-sm text-gray-400 hover:text-white transition-colors hidden md:block">Help</Link>
              {hasDashboardAccess ? (
                <div className="relative" ref={profileMenuRef}>
                  <button
                    type="button"
                    onClick={() => setProfileOpen((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#0b1120]/80 px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.05] transition-colors"
                  >
                    <UserCircle2 className="w-4 h-4 text-cyan-300" />
                    Profile
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {profileOpen ? (
                    <div className="absolute right-0 mt-3 w-64 rounded-2xl border border-white/[0.08] bg-[#0b1120]/95 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                      <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 mb-3">
                        <p className="text-sm font-medium text-white">{profileName}</p>
                        <p className="text-xs text-gray-400 mt-1 break-all">{profileSubtitle}</p>
                      </div>
                      <div className="space-y-1">
                        <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.05]" onClick={() => setProfileOpen(false)}>
                          <BarChart3 className="w-4 h-4 text-cyan-300" />
                          Dashboard
                        </Link>
                        <Link href="/subscription" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.05]" onClick={() => setProfileOpen(false)}>
                          <CreditCard className="w-4 h-4 text-cyan-300" />
                          Manage Subscription
                        </Link>
                        <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.05]" onClick={() => setProfileOpen(false)}>
                          <Settings2 className="w-4 h-4 text-cyan-300" />
                          Settings
                        </Link>
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-rose-100 hover:bg-rose-400/10"
                        >
                          <LogOut className="w-4 h-4 text-rose-300" />
                          Log Out
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <Link href="/auth/login" className="text-sm text-gray-300 hover:text-white transition-colors">Sign In</Link>
                  <Link href="/auth/register" className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity">Start 300 Try-On Trial</Link>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-sm text-gray-400 md:hidden">
            <Link href="/demo" className="hover:text-white transition-colors">Demo</Link>
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/help" className="hover:text-white transition-colors">Help</Link>
            {hasDashboardAccess ? <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link> : null}
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative min-h-screen flex items-center justify-center pt-28 md:pt-20 overflow-hidden z-10">
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
            <Link href={hasDashboardAccess ? '/dashboard' : '/auth/register'} className="px-8 py-4 text-lg font-semibold rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity shadow-[0_0_20px_rgba(6,182,212,0.2)]">{hasDashboardAccess ? 'Open Dashboard' : 'Start 300 Try-On Trial'}</Link>
            <Link href="/demo" className="px-8 py-4 text-lg font-medium rounded-xl border border-white/[0.1] hover:bg-white/[0.05] transition-colors flex items-center gap-2"><Play className="w-5 h-5" />See Live Demo</Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Setup in under 5 minutes</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Cancel anytime</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" />Enterprise-ready</span>
          </div>
        </div>
      </section>

      {/* POSITIONING */}
      <section className="py-20 px-6 border-y border-white/[0.06] relative z-10">
        <div className="max-w-7xl mx-auto">
          <p className="text-center text-gray-500 mb-8">Built for fashion teams evaluating AI try-on seriously before rollout.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap mb-14">
            {['Fashion brands', 'Storefront teams', 'Growth operators', 'Developers'].map((label) => (
              <span key={label} className="rounded-full border border-white/[0.08] bg-[#0b1120]/60 px-4 py-2 text-sm text-gray-300">
                {label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm">
              <Layers3 className="w-8 h-8 text-cyan-400 mb-4" />
              <p className="text-xl font-semibold text-white mb-2">Faster evaluation cycles</p>
              <p className="text-gray-400">Validate image quality, garment prep, and rollout readiness before committing your whole storefront.</p>
            </div>
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm">
              <Sparkles className="w-8 h-8 text-blue-400 mb-4" />
              <p className="text-xl font-semibold text-white mb-2">Cleaner customer experience</p>
              <p className="text-gray-400">Guide buyers from garment selection to try-on without forcing a heavy platform rebuild.</p>
            </div>
            <div className="p-6 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm">
              <Shield className="w-8 h-8 text-green-400 mb-4" />
              <p className="text-xl font-semibold text-white mb-2">Launch with more control</p>
              <p className="text-gray-400">Use domain validation, garment caching, analytics, and admin review before opening traffic fully.</p>
            </div>
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

      {/* ROLLOUT OUTCOMES */}
      <section className="py-24 px-6 relative z-10">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">What a strong rollout should improve</h2>
          <p className="text-xl text-gray-400 mb-12">The first goal is not hype. It is better buyer confidence, cleaner evaluation, and a more usable product page experience.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><BarChart3 className="w-8 h-8 text-cyan-400 mx-auto mb-4" /><p className="text-2xl font-bold text-white mb-2">More product-page engagement</p><p className="text-gray-400">Give visitors a stronger reason to interact before they leave the page.</p></div>
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><CreditCard className="w-8 h-8 text-blue-400 mx-auto mb-4" /><p className="text-2xl font-bold text-white mb-2">Better purchase confidence</p><p className="text-gray-400">Help buyers picture fit and styling earlier in the decision process.</p></div>
            <div className="p-8 rounded-2xl bg-[#0b1120]/50 border border-white/[0.06] backdrop-blur-sm"><ArrowRight className="w-8 h-8 text-green-400 mx-auto mb-4" /><p className="text-2xl font-bold text-white mb-2">Lower rollout friction</p><p className="text-gray-400">Launch in stages, measure usage, and improve quality before pushing traffic harder.</p></div>
          </div>
          <p className="text-gray-400">Use the free trial and live demo to decide whether DrapixAI is strong enough for your catalog and brand quality bar.</p>
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
            <p className="text-xl text-gray-400">Every public plan starts with the same free trial: up to 300 try-ons over 12 days.</p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr_320px] gap-6">
            {[
              {
                name: 'Starter',
                price: '$49',
                tryons: '1,000 upper-body try-ons/month',
                description: 'For smaller brands validating demand on live product pages with upper-body try-ons only.',
                features: ['Standard support', '1 production domain', 'SDK + REST API access'],
                cta: '/auth/register?plan=starter',
              },
              {
                name: 'Growth',
                price: '$149',
                tryons: '5,000 upper-body try-ons/month',
                description: 'For growing stores that need better unit economics and real usage headroom for upper-body try-ons only.',
                features: ['Priority email support', 'Advanced analytics', 'Best value per try-on'],
                cta: '/auth/register?plan=growth',
                featured: true,
              },
              {
                name: 'Pro',
                price: 'Coming soon',
                tryons: 'Full-body try-ons',
                description: 'Reserved for the future full-body DrapixAI rollout once the broader try-on experience is ready.',
                features: ['Full-body try-ons', 'Higher-volume rollout path', 'Commercial details announced at launch'],
                cta: null,
                comingSoon: true,
              },
            ].map((plan) => (
              <div key={plan.name} className={`p-8 rounded-2xl backdrop-blur-sm transition-all duration-300 ${plan.featured ? 'bg-gradient-to-b from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 md:-translate-y-4' : 'bg-[#0b1120]/50 border border-white/[0.06] hover:border-white/[0.1]'}`}>
                {plan.featured ? (
                  <div className="inline-flex px-4 py-1 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-xs font-medium text-white mb-5">
                    Recommended
                  </div>
                ) : null}
                <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                <p className="text-gray-400 text-sm mb-6">{plan.description}</p>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  {!plan.comingSoon ? <span className="text-gray-500"> / month</span> : null}
                  <p className="text-cyan-300 text-sm mt-2">{plan.tryons}</p>
                </div>
                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <Check className="w-4 h-4 text-cyan-400" /> {feature}
                    </li>
                  ))}
                </ul>
                {plan.comingSoon ? (
                  <div className="block w-full py-3 px-4 text-center rounded-xl font-semibold border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                    Coming Soon
                  </div>
                ) : (
                  <Link href={plan.cta} className={`block w-full py-3 px-4 text-center rounded-xl font-semibold transition-colors ${plan.featured ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white hover:opacity-90' : 'border border-white/[0.1] text-white hover:bg-white/[0.05]'}`}>
                    Start Trial
                  </Link>
                )}
              </div>
            ))}

            <div className="p-8 rounded-2xl bg-[#0b1120]/60 border border-amber-400/20 backdrop-blur-sm">
              <h3 className="text-xl font-semibold mb-2">Enterprise</h3>
              <p className="text-gray-400 text-sm mb-6">Custom volume, onboarding, and commercial support for larger teams.</p>
              <div className="mb-6">
                <span className="text-3xl font-bold text-white">Custom</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['Custom usage allocation', 'Priority commercial onboarding', 'Private support workflow'].map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-amber-300" /> {feature}
                  </li>
                ))}
              </ul>
              <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Enterprise%20Sales%20Inquiry" className="block w-full py-3 px-4 text-center rounded-xl border border-amber-300/30 text-white font-semibold hover:bg-white/[0.05] transition-colors">
                Contact Sales
              </a>
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
              <Check className="w-4 h-4 text-green-500" /> 300 try-on trial
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-500">
              <Check className="w-4 h-4 text-green-500" /> Upgrade when your volume is proven
            </span>
          </div>
          <div className="text-center mt-8">
            <Link href="/pricing" className="inline-flex items-center gap-2 text-cyan-300 hover:text-cyan-200 transition-colors">
              View full pricing breakdown
              <ArrowRight className="w-4 h-4" />
            </Link>
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
          <p className="text-xl text-gray-400 mb-8">Start with a 300 try-on trial, validate quality on your own products, then roll out with the plan that fits your traffic.</p>

          <Link href={hasDashboardAccess ? '/dashboard' : '/auth/register'} className="inline-block px-10 py-4 text-xl font-semibold rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-90 transition-opacity shadow-[0_0_15px_rgba(6,182,212,0.15)]">
          {hasDashboardAccess ? 'Open Dashboard' : 'Start 300 Try-On Trial'}
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
            <Link href="/help" className="text-sm text-gray-500 hover:text-white transition-colors">Help</Link>
            <Link href="/pricing" className="text-sm text-gray-500 hover:text-white transition-colors">Pricing</Link>
            {hasDashboardAccess ? (
              <Link href="/dashboard" className="text-sm text-gray-500 hover:text-white transition-colors">Dashboard</Link>
            ) : null}
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
