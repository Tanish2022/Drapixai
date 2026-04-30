'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, Gauge, ShieldCheck, Store, UserCircle2 } from 'lucide-react';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import { useThemePreference } from '@/app/lib/theme-client';

type UsageData = {
  planType: string;
  planName: string;
  selectedPlanName?: string | null;
  subscriptionPlanName?: string | null;
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEndsAt?: string | null;
  trialDaysLeft: number;
  rendersUsed: number;
  quota: number;
  quotaRemaining: number;
  domain?: string;
  storeConnected?: boolean;
  companyName?: string | null;
  email?: string | null;
};

export default function SubscriptionPage() {
  const router = useRouter();
  const themePreference = useThemePreference();
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const sessionResponse = await fetch('/api/dashboard/session', { cache: 'no-store' }).catch(() => null);
      if (!sessionResponse?.ok) {
        router.push('/auth/login');
        return;
      }

      const sessionPayload = (await sessionResponse.json().catch(() => null)) as { apiKey?: string } | null;
      const nextApiKey = sessionPayload?.apiKey?.trim() || '';
      if (!nextApiKey) {
        router.push('/auth/login');
        return;
      }

      const summaryResponse = await fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, {
        headers: { Authorization: `Bearer ${nextApiKey}` },
      }).catch(() => null);

      const summaryPayload = (await summaryResponse?.json().catch(() => null)) as UsageData | null;
      if (active) {
        setUsage(summaryPayload);
      }
    };

    bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#edf4ff] text-slate-950' : 'min-h-screen bg-[#050816] text-white';
  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-[28px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,249,255,0.96)_100%)] p-6 shadow-[0_28px_90px_rgba(71,85,105,0.12)] backdrop-blur'
        : 'rounded-3xl border border-white/[0.08] bg-[#0b1120]/75 p-6',
    [themePreference]
  );
  const panelClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'rounded-2xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]'
        : 'rounded-2xl border border-white/[0.08] bg-black/20 p-4',
    [themePreference]
  );
  const mutedTextClass = themePreference === 'light' ? 'text-slate-600' : 'text-gray-400';
  const strongTextClass = themePreference === 'light' ? 'text-slate-900' : 'text-gray-100';

  if (!usage) {
    return (
      <main className="min-h-screen bg-[#050816] text-white flex items-center justify-center px-6">
        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/80 p-8">
          <p className="text-gray-400">Loading subscription details...</p>
        </div>
      </main>
    );
  }

  const isQuotaExhausted = usage.quotaRemaining <= 0;
  const isQuotaLow = !isQuotaExhausted && usage.quotaRemaining <= Math.max(50, Math.ceil(usage.quota * 0.1));

  return (
    <main className={pageClass}>
      {themePreference === 'light' ? (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_85%_18%,rgba(59,130,246,0.14),transparent_24%),linear-gradient(180deg,#f6fbff_0%,#edf4ff_100%)]" />
          <div className="absolute inset-0 opacity-[0.35] bg-[linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] bg-[size:42px_42px]" />
        </div>
      ) : (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[640px] bg-gradient-glow opacity-40" />
          <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full bg-blue-500/10 blur-[120px]" />
        </div>
      )}

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-10">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-cyan-400/80 mb-3">Subscription</p>
            <h1 className="text-4xl font-bold">Manage rollout, usage, and commercial access</h1>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" className="inline-flex items-center justify-center rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
              Open Dashboard
            </Link>
            <Link href="/pricing" className="inline-flex items-center justify-center rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
              View Pricing
            </Link>
          </div>
        </div>

        {isQuotaExhausted ? (
          <div className={`mb-8 rounded-[28px] border p-6 ${themePreference === 'light' ? 'border-rose-200 bg-rose-50/90' : 'border-rose-400/30 bg-rose-500/10'}`}>
            <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${themePreference === 'light' ? 'text-rose-700' : 'text-rose-200'}`}>Usage limit reached</p>
            <h2 className={`mt-2 text-2xl font-bold ${themePreference === 'light' ? 'text-rose-950' : 'text-white'}`}>This plan has no try-ons remaining for the current period.</h2>
            <p className={`mt-3 max-w-3xl text-sm leading-7 ${themePreference === 'light' ? 'text-rose-900/80' : 'text-rose-100/80'}`}>
              Internal previews, storefront rollout, and production traffic should pause here. Move to a higher-volume plan or contact sales if your team needs immediate headroom before renewal.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/pricing" className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium ${themePreference === 'light' ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-rose-500 text-white hover:bg-rose-400'} transition-colors`}>
                Upgrade plan
              </Link>
              <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Quota%20Upgrade" className={`inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium ${themePreference === 'light' ? 'border-rose-200 text-rose-800 hover:bg-rose-100' : 'border-rose-300/30 text-rose-100 hover:bg-white/[0.05]'} transition-colors`}>
                Contact sales
              </a>
            </div>
          </div>
        ) : isQuotaLow ? (
          <div className={`mb-8 rounded-[28px] border p-6 ${themePreference === 'light' ? 'border-amber-200 bg-amber-50/90' : 'border-amber-400/30 bg-amber-500/10'}`}>
            <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${themePreference === 'light' ? 'text-amber-700' : 'text-amber-200'}`}>Quota running low</p>
            <p className={`mt-2 text-sm leading-7 ${themePreference === 'light' ? 'text-amber-900/80' : 'text-amber-100/80'}`}>
              You only have {usage.quotaRemaining} try-ons left this period. If you expect more previews or live traffic before renewal, upgrade early so rollout does not stall.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <div className={cardClass}>
            <CreditCard className="w-8 h-8 text-cyan-400 mb-4" />
            <p className={`text-sm mb-2 ${mutedTextClass}`}>Current Plan</p>
            <p className="text-2xl font-bold">{usage.planName}</p>
            {usage.planType === 'trial' && usage.selectedPlanName ? (
              <p className={`text-xs mt-2 ${mutedTextClass}`}>Selected paid plan after trial: {usage.selectedPlanName}</p>
            ) : null}
          </div>

          <div className={cardClass}>
            <Gauge className="w-8 h-8 text-blue-400 mb-4" />
            <p className={`text-sm mb-2 ${mutedTextClass}`}>Usage This Period</p>
            <p className="text-2xl font-bold">{usage.rendersUsed} / {usage.quota}</p>
            <p className={`text-xs mt-2 ${isQuotaExhausted ? (themePreference === 'light' ? 'text-rose-700' : 'text-rose-300') : isQuotaLow ? (themePreference === 'light' ? 'text-amber-700' : 'text-amber-300') : mutedTextClass}`}>
              {isQuotaExhausted ? 'No try-ons remaining this period' : `${usage.quotaRemaining} try-ons remaining`}
            </p>
          </div>

          <div className={cardClass}>
            <ShieldCheck className="w-8 h-8 text-emerald-400 mb-4" />
            <p className={`text-sm mb-2 ${mutedTextClass}`}>Subscription Status</p>
            <p className="text-2xl font-bold capitalize">{usage.subscriptionStatus || 'active'}</p>
            <p className={`text-xs mt-2 ${mutedTextClass}`}>
              {usage.planType === 'trial'
                ? `${usage.trialDaysLeft} day(s) left in trial`
                : usage.subscriptionCurrentPeriodEndsAt
                  ? `Renews around ${new Date(usage.subscriptionCurrentPeriodEndsAt).toLocaleDateString()}`
                  : 'Renewal date not set'}
            </p>
          </div>

          <div className={cardClass}>
            <Store className={`w-8 h-8 mb-4 ${usage.storeConnected ? 'text-emerald-400' : 'text-amber-300'}`} />
            <p className={`text-sm mb-2 ${mutedTextClass}`}>Web Store Status</p>
            <p className="text-2xl font-bold">{usage.storeConnected ? 'Connected' : 'Not Connected'}</p>
            <p className={`text-xs mt-2 ${mutedTextClass}`}>{usage.domain && usage.domain !== '*' ? usage.domain : 'No authorized domain set yet'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-4">
              <UserCircle2 className="w-6 h-6 text-cyan-400" />
              <h2 className="text-2xl font-semibold">Account Summary</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className={panelClass}>
                <p className={`mb-1 ${mutedTextClass}`}>Account Email</p>
                <p className={`${strongTextClass} break-all`}>{usage.email || 'Not available'}</p>
              </div>
              <div className={panelClass}>
                <p className={`mb-1 ${mutedTextClass}`}>Company / Brand</p>
                <p className={strongTextClass}>{usage.companyName || 'Not set yet'}</p>
              </div>
              <div className={panelClass}>
                <p className={`mb-1 ${mutedTextClass}`}>Public Plan Path</p>
                <p className={strongTextClass}>{usage.subscriptionPlanName || usage.selectedPlanName || usage.planName}</p>
              </div>
              <div className={panelClass}>
                <p className={`mb-1 ${mutedTextClass}`}>Connected Domain</p>
                <p className={strongTextClass}>{usage.domain && usage.domain !== '*' ? usage.domain : 'Not connected yet'}</p>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-2xl font-semibold mb-4">Next Best Actions</h2>
            <div className="space-y-3 text-sm">
              <div className={panelClass}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>1. Finish storefront verification</p>
                <p className={mutedTextClass}>
                  {usage.storeConnected
                    ? 'Your storefront is already linked and ready for SDK rollout.'
                    : 'Save the domain in settings, add the verification tag, and confirm that DrapixAI can trust the storefront before launch.'}
                </p>
              </div>
              <div className={panelClass}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>2. Validate products and onboarding flow</p>
                <p className={mutedTextClass}>Sync your upper-body catalog, upload matching garments, and run internal try-ons before you send live traffic to the widget.</p>
              </div>
              <div className={panelClass}>
                <p className={`font-medium mb-2 ${strongTextClass}`}>3. Increase volume only after validation</p>
                <p className={mutedTextClass}>
                  {isQuotaExhausted
                    ? 'You have already consumed the plan limit for this period. Upgrade now or contact sales before trying to continue rollout.'
                    : 'Use the trial or current plan to confirm quality, catalog readiness, and traffic fit before increasing monthly volume or moving into a sales-led rollout.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link href="/settings" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                Open Settings
              </Link>
              <Link href="/help" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                Integration Help
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                {isQuotaExhausted ? 'Upgrade now' : 'Upgrade Plan'}
                <ExternalLink className="w-4 h-4" />
              </Link>
              {isQuotaExhausted ? (
                <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Quota%20Upgrade" className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                  Contact Sales
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
