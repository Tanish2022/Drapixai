'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import BrandLogo from '@/app/components/BrandLogo';
import MarketingFooter from '@/app/components/MarketingFooter';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronDown,
  Code2,
  CreditCard,
  Fingerprint,
  Gauge,
  Globe2,
  LogOut,
  Menu,
  ScanLine,
  Settings2,
  ShieldCheck,
  UserCircle2,
  X,
} from 'lucide-react';

const supportedDetails = [
  'Structured collars',
  'Folded cuffs',
  'Checks and prints',
  'Logos and embroidery',
  'Short kurtis',
  'Complex sleeves',
  'Dark and white garments',
  'Low-contrast fabrics',
];

export default function Home() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [hasDashboardAccess, setHasDashboardAccess] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileName, setProfileName] = useState('Profile');
  const [profileSubtitle, setProfileSubtitle] = useState('Manage your account, plan, and dashboard access.');
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sessionUserName = ((session as any)?.user?.name || '').trim();
    const sessionUserEmail = ((session as any)?.user?.email || '').trim();

    const loadProfileSummary = async () => {
      try {
        const response = await fetch('/api/dashboard/proxy/analytics/summary', { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as { companyName?: string | null; email?: string | null } | null;
        setProfileName(
          payload?.companyName?.trim()
          || sessionUserName
          || payload?.email?.split('@')[0]
          || sessionUserEmail.split('@')[0]
          || 'Profile'
        );
        setProfileSubtitle(payload?.email?.trim() || sessionUserEmail || 'Signed in to DrapixAI');
      } catch {
        setProfileName(sessionUserName || sessionUserEmail.split('@')[0] || 'Profile');
        setProfileSubtitle(sessionUserEmail || 'Signed in to DrapixAI');
      }
    };

    if (sessionStatus === 'loading') return;

    let active = true;
    fetch('/api/dashboard/session', { cache: 'no-store' })
      .then((response) => {
        if (!active) return;
        setHasDashboardAccess(response.ok);
        if (response.ok) void loadProfileSummary();
      })
      .catch(() => {
        if (active) setHasDashboardAccess(false);
      });

    return () => {
      active = false;
    };
  }, [session, sessionStatus]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleLogout = () => {
    fetch('/api/dashboard/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        setHasDashboardAccess(false);
        setProfileOpen(false);
        signOut({ redirect: false }).catch(() => undefined).finally(() => router.push('/'));
      });
  };

  const showDashboardCta = hasDashboardAccess || sessionStatus === 'authenticated';

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#172019]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[#fbfcf9]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center" aria-label="DrapixAI home">
            <BrandLogo />
          </Link>

          <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary navigation">
            <Link href="/demo" className="text-sm font-medium text-[#4f5a52] hover:text-[#172019]">Demo</Link>
            <Link href="/pricing" className="text-sm font-medium text-[#4f5a52] hover:text-[#172019]">Pricing</Link>
            <Link href="/docs" className="text-sm font-medium text-[#4f5a52] hover:text-[#172019]">Developers</Link>
            <Link href="/help" className="text-sm font-medium text-[#4f5a52] hover:text-[#172019]">Help</Link>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {hasDashboardAccess ? (
              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((current) => !current)}
                  className="inline-flex h-11 items-center gap-2 border border-black/15 bg-white px-4 text-sm font-semibold text-[#172019] hover:border-black/30"
                  aria-expanded={profileOpen} aria-controls="home-profile-links"
                >
                  <UserCircle2 className="h-4 w-4 text-[#21634e]" />
                  {profileName}
                  <ChevronDown className={`h-4 w-4 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
                </button>
                {profileOpen ? (
                  <div id="home-profile-links" className="absolute right-0 mt-2 w-72 border border-black/10 bg-white p-3 shadow-[0_24px_70px_rgba(25,35,28,0.16)]">
                    <div className="border-b border-black/10 px-3 pb-3">
                      <p className="font-semibold text-[#172019]">{profileName}</p>
                      <p className="mt-1 break-all text-xs text-[#6a756c]">{profileSubtitle}</p>
                    </div>
                    <div className="pt-2">
                      {[
                        { href: '/dashboard', label: 'Dashboard', Icon: BarChart3 },
                        { href: '/subscription', label: 'Manage subscription', Icon: CreditCard },
                        { href: '/settings', label: 'Settings', Icon: Settings2 },
                      ].map(({ href, label, Icon }) => (
                        <Link key={href} href={href} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-[#f1f4ef]" onClick={() => setProfileOpen(false)}>
                          <Icon className="h-4 w-4 text-[#21634e]" />
                          {label}
                        </Link>
                      ))}
                      <button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-[#9e2e2e] hover:bg-[#fff1f0]">
                        <LogOut className="h-4 w-4" /> Log out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Link href="/auth/login" className="px-3 py-2 text-sm font-semibold text-[#344038]">Sign in</Link>
                <Link href="/auth/register" className="inline-flex h-11 items-center bg-[#183f32] px-5 text-sm font-semibold text-white hover:bg-[#245a48]">Start free trial</Link>
              </>
            )}
          </div>

          <button type="button" onClick={() => setMobileOpen((current) => !current)} className="flex h-11 w-11 items-center justify-center border border-black/15 lg:hidden" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="home-mobile-navigation">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen ? (
          <nav id="home-mobile-navigation" className="border-t border-black/10 bg-[#fbfcf9] px-5 py-5 lg:hidden" aria-label="Mobile navigation">
            <div className="mx-auto grid max-w-[1440px] gap-1">
              {[
                ['/demo', 'Demo'], ['/pricing', 'Pricing'], ['/docs', 'Developers'], ['/help', 'Help'], ['/status', 'Status'],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="border-b border-black/5 px-2 py-3 text-base font-medium" onClick={() => setMobileOpen(false)}>{label}</Link>
              ))}
              <Link href={showDashboardCta ? '/dashboard' : '/auth/register'} className="mt-3 inline-flex h-12 items-center justify-center bg-[#183f32] px-5 font-semibold text-white" onClick={() => setMobileOpen(false)}>
                {showDashboardCta ? 'Open dashboard' : 'Start free trial'}
              </Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-black/10 bg-[#f2f4f1]">
          <div className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-5 pb-32 pt-16 sm:px-8 md:min-h-[620px] md:grid-cols-[1.2fr_0.8fr] md:pb-28 lg:px-12">
            <div className="max-w-[760px]">
              <p className="mb-5 flex items-center gap-3 text-xs font-bold uppercase text-[#2b654f]">
                <span className="h-px w-10 bg-[#2b654f]" />
                Garment-faithful virtual try-on for fashion storefronts
              </p>
              <h1 className="max-w-[620px] font-serif text-5xl font-normal leading-[0.98] text-[#101712] sm:text-6xl lg:text-[86px]">
                DrapixAI virtual try-on
              </h1>
              <p className="mt-7 max-w-[570px] text-lg leading-8 text-[#3f4a42] sm:text-xl">
                Offer shoppers an AI-generated preview of an upper-body garment. Start with one product, compare the details and review the result before publishing.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href={showDashboardCta ? '/dashboard' : '/auth/register'} className="inline-flex h-14 items-center justify-center gap-2 bg-[#183f32] px-7 py-4 font-semibold text-white hover:bg-[#245a48]">
                  {showDashboardCta ? 'Continue setup' : 'Start with one product'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/demo" className="inline-flex h-14 items-center justify-center border border-black/20 bg-white/75 px-7 py-4 font-semibold text-[#172019] hover:bg-white">
                  See a live demo
                </Link>
              </div>
              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-[#4d5a50]">
                {['One-product trial', 'Native storefront UI', 'Quality-gated results'].map((item) => (
                  <span key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-[#26725a]" />{item}</span>
                ))}
              </div>

            </div>
            <div className="border-l border-black/15 py-4 pl-7 sm:pl-10">
              <p className="font-serif text-3xl leading-tight text-[#183f32] sm:text-4xl">&ldquo;Real clothes should still look real.&rdquo;</p>
              <p className="mt-5 text-xs font-bold uppercase text-[#2b654f]">The DrapixAI product principle</p>
              <p className="mt-7 max-w-md leading-7 text-[#59645c]">Every approved result must preserve the product a brand actually sells, not merely generate a convincing replacement.</p>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-black/10 bg-[rgba(247,248,245,0.96)] backdrop-blur-md">
            <div className="mx-auto grid max-w-[1440px] grid-cols-3 divide-x divide-black/10 px-5 sm:px-8 lg:px-12">
              {[
                ['Upper-body', 'Current garment scope'],
                ['Standard', 'One production mode'],
                ['Review', 'Before publishing'],
              ].map(([value, label]) => (
                <div key={label} className="py-4 text-center sm:py-5">
                  <p className="text-lg font-bold text-[#172019] sm:text-2xl">{value}</p>
                  <p className="mt-1 text-[10px] uppercase text-[#5d6961] sm:text-xs">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[0.75fr_1.25fr]">
            <div className="border-b border-black/10 px-5 py-16 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-24">
              <p className="text-xs font-bold uppercase text-[#2b654f]">How it works</p>
              <h2 className="mt-5 max-w-md font-serif text-4xl font-normal leading-tight sm:text-5xl">Protect the product, not just the picture.</h2>
              <p className="mt-6 max-w-lg text-lg leading-8 text-[#59645c]">A try-on is useful only when the shopper still sees the garment the brand is selling.</p>
            </div>
            <div className="grid sm:grid-cols-3">
              {[
                ['01', 'Prepare', 'A clean, reusable garment cache is created during onboarding.'],
                ['02', 'Inspect', 'Color, sleeve, hem, collar, texture, pose, and identity are scored.'],
                ['03', 'Publish', 'Only confirmed products and acceptable results reach the storefront.'],
              ].map(([number, title, body]) => (
                <article key={number} className="border-b border-black/10 px-5 py-10 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-7 lg:py-24">
                  <p className="font-mono text-sm text-[#26725a]">{number}</p>
                  <h3 className="mt-10 text-2xl font-bold">{title}</h3>
                  <p className="mt-4 leading-7 text-[#647068]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#eef2ec] py-16 lg:py-24" aria-labelledby="product-review-heading">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:px-12">
            <div>
              <p className="text-xs font-bold uppercase text-[#2b654f]">Product review</p>
              <h2 id="product-review-heading" className="mt-5 font-serif text-4xl leading-tight">Review the garment before publishing.</h2>
              <p className="mt-6 text-lg leading-8 text-[#59645c]">Compare the original product with its generated preview. Check the face, pose, garment details and background rather than relying on a score alone.</p>
              <p className="mt-4 leading-7 text-[#59645c]">AI previews are illustrations, not measurements or guarantees of sizing, physical fit, fabric behaviour or an exact appearance. Review product details and size charts before buying.</p>
            </div>
            <ul className="divide-y divide-black/10 border-y border-black/10">
              {['Color and fabric texture', 'Print, logo and embroidery', 'Sleeves, collar and hem', 'Face, pose and background'].map((label) => (
                <li key={label} className="flex items-center gap-3 py-5 font-semibold"><ScanLine aria-hidden="true" className="h-5 w-5 shrink-0 text-[#21634e]" />{label}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#172019] py-20 text-white lg:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-[#8cd3b3]">Commerce infrastructure</p>
                <h2 className="mt-5 max-w-lg font-serif text-4xl font-normal leading-tight sm:text-5xl">The model is only one part of the product.</h2>
                <p className="mt-6 max-w-lg text-lg leading-8 text-[#bdc7bf]">DrapixAI controls garment preparation, result quality, shopper privacy, storefront behavior, and review evidence in one operating path.</p>
                <Link href="/docs" className="mt-8 inline-flex items-center gap-2 border-b border-[#8cd3b3] pb-1 font-semibold text-[#a7dfc4]">Read the integration guide <ArrowRight className="h-4 w-4" /></Link>
              </div>
              <div className="grid border-t border-white/15 sm:grid-cols-2">
                {[
                  { Icon: ScanLine, title: 'Product accuracy', body: 'Color, print, sleeve, hem, collar, and texture checks for approved products.' },
                  { Icon: ShieldCheck, title: 'Bad-result rejection', body: 'Unpublishable results are blocked before they can weaken shopper trust.' },
                  { Icon: Gauge, title: 'Quality-preserving speed', body: 'Evaluate performance with your own catalog and storefront before setting shopper expectations. Standard uses one consistent quality mode.' },
                  { Icon: Fingerprint, title: 'Direct and SDK parity', body: 'The same garment, settings, resolution, postprocessing, and quality decision across service paths.' },
                  { Icon: Globe2, title: 'Brand-native SDK', body: 'Theme adaptation, shopper privacy, downloads, and purchase actions stay on the storefront.' },
                  { Icon: BarChart3, title: 'Reviewable operations', body: 'Quality, warnings, latency, approvals, usage, and cache readiness remain visible.' },
                ].map(({ Icon, title, body }, index) => (
                  <article key={title} className={`border-b border-white/15 py-8 sm:px-7 ${index % 2 === 1 ? 'sm:border-l' : ''}`}>
                    <Icon className="h-5 w-5 text-[#8cd3b3]" />
                    <h3 className="mt-5 text-xl font-bold">{title}</h3>
                    <p className="mt-3 leading-7 text-[#aeb9b1]">{body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase text-[#2b654f]">Launch scope</p>
              <h2 className="mt-5 font-serif text-4xl font-normal leading-tight sm:text-5xl">Built for the garment details generic try-on loses.</h2>
              <p className="mt-6 text-lg leading-8 text-[#59645c]">Our launch scope prioritizes difficult upper-body products instead of making an unverified all-garment promise.</p>
            </div>
            <div className="mt-12 grid border-l border-t border-black/10 sm:grid-cols-2 lg:grid-cols-4">
              {supportedDetails.map((detail, index) => (
                <div key={detail} className="flex min-h-28 items-end justify-between border-b border-r border-black/10 p-5">
                  <span className="max-w-[180px] text-lg font-bold">{detail}</span>
                  <span className="font-mono text-xs text-[#5d6961]">{String(index + 1).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#f7f8f5] py-20 lg:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
              <div>
                <p className="text-xs font-bold uppercase text-[#2b654f]">Integration</p>
                <h2 className="mt-5 font-serif text-4xl font-normal leading-tight sm:text-5xl">From product image to live try-on.</h2>
                <p className="mt-6 text-lg leading-8 text-[#59645c]">The dashboard handles preparation. Your storefront only needs the confirmed product ID and DrapixAI widget.</p>
              </div>
              <div className="min-w-0">
                <div className="border-t border-black/15">
                  {[
                    ['01', 'Connect your store', 'Install the Shopify app for automatic product and variant sync, or connect a catalog feed for another platform.'],
                    ['02', 'Approve the garment', 'DrapixAI prepares eligible product images and holds them for review. Confirm the garment and product match.'],
                    ['03', 'Install and test', 'Add the Shopify theme block or web SDK, complete a shopper preview, and publish only after it passes.'],
                  ].map(([number, title, body]) => (
                    <div key={number} className="grid gap-3 border-b border-black/15 py-7 sm:grid-cols-[70px_1fr_1.2fr] sm:gap-6">
                      <span className="font-mono text-sm text-[#26725a]">{number}</span>
                      <h3 className="text-lg font-bold">{title}</h3>
                      <p className="leading-7 text-[#647068]">{body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-8 overflow-x-auto bg-[#111713] p-6 text-sm text-[#d8e2da]">
                  <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                    <span className="flex items-center gap-2 font-semibold text-white"><Code2 className="h-4 w-4 text-[#8cd3b3]" />Storefront SDK</span>
                    <span className="text-xs text-[#8ea095]">Standard mode</span>
                  </div>
                  <pre tabIndex={0} role="region" aria-label="SDK installation example">{`<script src="https://cdn.drapixai.com/sdk.js"></script>

<div id="drapixai-container"></div>

<script>
  DrapixAI.init({
    tokenProvider: async function (productId) {
      const response = await fetch('/api/drapixai-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }), credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.token) throw new Error('TOKEN_UNAVAILABLE');
      return payload.token;
    },
    productId: 'confirmed-product-id',
    quality: 'standard',
    garmentType: 'upper'
  });
</script>`}</pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#b8d8c7] py-20 lg:py-24">
          <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-10 px-5 sm:px-8 lg:flex-row lg:items-end lg:px-12">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase text-[#1f5e46]">Controlled rollout</p>
              <h2 className="mt-5 font-serif text-4xl font-normal leading-tight text-[#102018] sm:text-6xl">Prove one product before you scale the catalog.</h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#385345]">Use the 300 try-on trial to evaluate Standard upper-body quality on your own products. Publish only when the workflow meets your brand bar.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href={showDashboardCta ? '/dashboard' : '/auth/register'} className="inline-flex h-14 min-w-56 items-center justify-center gap-2 bg-[#172019] px-7 font-semibold text-white hover:bg-[#26352a]">
                {showDashboardCta ? 'Open dashboard' : 'Start free trial'} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="inline-flex h-14 min-w-56 items-center justify-center border border-[#172019]/30 px-7 font-semibold text-[#172019] hover:bg-white/30">View pricing</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
