'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, Gauge, Loader2, ShieldCheck, Store, UserCircle2 } from 'lucide-react';
import { useThemePreference } from '@/app/lib/theme-client';
import WorkspaceHeader from '@/app/components/WorkspaceHeader';

type UsageData = {
  planType: string;
  planName: string;
  selectedPlanName?: string | null;
  subscriptionPlanName?: string | null;
  subscriptionStatus?: string | null;
  subscriptionProvider?: string | null;
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
  const [billingAction, setBillingAction] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingNotice, setBillingNotice] = useState<'success' | 'canceled' | null>(null);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const sessionResponse = await fetch('/api/dashboard/session', { cache: 'no-store' }).catch(() => null);
      if (!sessionResponse?.ok) {
        router.push('/auth/login');
        return;
      }

      const summaryResponse = await fetch('/api/dashboard/proxy/analytics/summary', { cache: 'no-store' }).catch(() => null);

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

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('billing');
    setBillingNotice(value === 'success' || value === 'canceled' ? value : null);
  }, []);

  const pageClass = themePreference === 'light' ? 'min-h-screen bg-[#f4f6f2] text-[#172019]' : 'min-h-screen bg-[#0f1511] text-[#edf2ed]';
  const cardClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'border border-black/10 bg-white p-6'
        : 'border border-white/10 bg-[#151c17] p-6',
    [themePreference]
  );
  const panelClass = useMemo(
    () =>
      themePreference === 'light'
        ? 'border border-black/10 bg-[#f4f6f2] p-4'
        : 'border border-white/10 bg-[#101712] p-4',
    [themePreference]
  );
  const mutedTextClass = themePreference === 'light' ? 'text-[#68736b]' : 'text-[#aab6ac]';
  const strongTextClass = themePreference === 'light' ? 'text-[#172019]' : 'text-[#edf2ed]';

  const openHostedBilling = async (action: 'checkout' | 'portal', plan?: 'starter' | 'growth' | 'pro') => {
    setBillingAction(plan || action);
    setBillingError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (action === 'checkout') headers['Idempotency-Key'] = crypto.randomUUID();
      const response = await fetch(`/api/dashboard/proxy/billing/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(plan ? { plan } : {}),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
      if (!response.ok || typeof payload?.url !== 'string') {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'BILLING_REQUEST_FAILED');
      }
      const hostedUrl = new URL(payload.url);
      const allowedHost = action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
      if (hostedUrl.protocol !== 'https:' || hostedUrl.hostname !== allowedHost) {
        throw new Error('BILLING_REDIRECT_REJECTED');
      }
      window.location.assign(hostedUrl.toString());
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'BILLING_REQUEST_FAILED');
      setBillingAction(null);
    }
  };

  if (!usage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f6f2] px-6 text-[#172019]">
        <div className="border-t border-black/10 p-8">
          <p className="text-[#68736b]">Loading subscription details...</p>
        </div>
      </main>
    );
  }

  const isQuotaExhausted = usage.quotaRemaining <= 0;
  const isQuotaLow = !isQuotaExhausted && usage.quotaRemaining <= Math.max(50, Math.ceil(usage.quota * 0.1));

  return (
    <main className={pageClass}>
      <WorkspaceHeader active="subscription" />
      <div className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-10">
          <div>
            <p className={`mb-3 text-xs font-bold uppercase ${themePreference === 'light' ? 'text-[#31725b]' : 'text-[#7fb29a]'}`}>Usage and plan</p>
            <h1 className="font-serif text-4xl leading-tight">Manage rollout capacity and commercial access.</h1>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" className="inline-flex items-center justify-center border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-[#172019] hover:bg-[#eef2ed]">
              Open Dashboard
            </Link>
            <Link href="/pricing" className="inline-flex items-center justify-center bg-[#183f32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245a48]">
              View Pricing
            </Link>
          </div>
        </div>

        {billingNotice === 'success' ? (
          <div className={`mb-8 border p-5 ${themePreference === 'light' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`}>
            Payment received. Your plan will update after the signed billing webhook confirms the subscription.
          </div>
        ) : billingNotice === 'canceled' ? (
          <div className={`mb-8 border p-5 ${themePreference === 'light' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'}`}>
            Checkout was canceled. No plan change was applied.
          </div>
        ) : null}

        {billingError ? (
          <div role="alert" className={`mb-8 border p-5 ${themePreference === 'light' ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-rose-400/30 bg-rose-500/10 text-rose-100'}`}>
            Billing could not be opened safely. Please retry or contact support with code {billingError}.
          </div>
        ) : null}

        {isQuotaExhausted ? (
          <div className={`mb-8 rounded-[28px] border p-6 ${themePreference === 'light' ? 'border-rose-200 bg-rose-50/90' : 'border-rose-400/30 bg-rose-500/10'}`}>
            <p className={`text-xs font-bold uppercase ${themePreference === 'light' ? 'text-rose-700' : 'text-rose-200'}`}>Usage limit reached</p>
            <h2 className={`mt-2 text-2xl font-bold ${themePreference === 'light' ? 'text-rose-950' : 'text-white'}`}>This plan has no try-ons remaining for the current period.</h2>
            <p className={`mt-3 max-w-3xl text-sm leading-7 ${themePreference === 'light' ? 'text-rose-900/80' : 'text-rose-100/80'}`}>
              Internal previews, storefront rollout, and production traffic should pause here. Move to a higher-volume plan or contact sales if your team needs immediate headroom before renewal.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/pricing" className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${themePreference === 'light' ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-rose-500 text-white hover:bg-rose-400'} transition-colors`}>
                Upgrade plan
              </Link>
              <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Quota%20Upgrade" className={`inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium ${themePreference === 'light' ? 'border-rose-200 text-rose-800 hover:bg-rose-100' : 'border-rose-300/30 text-rose-100 hover:bg-white/[0.05]'} transition-colors`}>
                Contact sales
              </a>
            </div>
          </div>
        ) : isQuotaLow ? (
          <div className={`mb-8 rounded-[28px] border p-6 ${themePreference === 'light' ? 'border-amber-200 bg-amber-50/90' : 'border-amber-400/30 bg-amber-500/10'}`}>
            <p className={`text-xs font-bold uppercase ${themePreference === 'light' ? 'text-amber-700' : 'text-amber-200'}`}>Quota running low</p>
            <p className={`mt-2 text-sm leading-7 ${themePreference === 'light' ? 'text-amber-900/80' : 'text-amber-100/80'}`}>
              You only have {usage.quotaRemaining} try-ons left this period. If you expect more previews or live traffic before renewal, upgrade early so rollout does not stall.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <div className={cardClass}>
            <CreditCard className="w-8 h-8 text-[#31725b] mb-4" />
            <p className={`text-sm mb-2 ${mutedTextClass}`}>Current Plan</p>
            <p className="text-2xl font-bold">{usage.planName}</p>
            {usage.planType === 'trial' && usage.selectedPlanName ? (
              <p className={`text-xs mt-2 ${mutedTextClass}`}>Selected paid plan after trial: {usage.selectedPlanName}</p>
            ) : null}
          </div>

          <div className={cardClass}>
            <Gauge className="w-8 h-8 text-[#31725b] mb-4" />
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
              <UserCircle2 className="w-6 h-6 text-[#31725b]" />
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
              <Link href="/settings" className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--elevated)]">
                Open Settings
              </Link>
              <Link href="/help" className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border-soft)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--elevated)]">
                Integration Help
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-md border border-[#77a08b] px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                {isQuotaExhausted ? 'Upgrade now' : 'Upgrade Plan'}
                <ExternalLink className="w-4 h-4" />
              </Link>
              {isQuotaExhausted ? (
                <a href="mailto:sales@drapixai.com?subject=DrapixAI%20Quota%20Upgrade" className="inline-flex items-center gap-2 rounded-md border border-rose-400/30 px-4 py-2 text-sm hover:bg-white/[0.05] transition-colors">
                  Contact Sales
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <section className={`${cardClass} mt-6`} aria-labelledby="secure-billing-heading">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className={`mb-2 text-xs font-bold uppercase ${themePreference === 'light' ? 'text-[#31725b]' : 'text-[#7fb29a]'}`}>Secure hosted billing</p>
              <h2 id="secure-billing-heading" className="text-2xl font-semibold">Choose capacity without sharing card details with DrapixAI.</h2>
              <p className={`mt-2 max-w-3xl text-sm leading-7 ${mutedTextClass}`}>
                Payment and tax details are collected by Stripe. DrapixAI enables a paid plan only after a signed provider event is verified and processed.
              </p>
            </div>
            {usage.subscriptionProvider === 'stripe' ? (
              <button
                type="button"
                onClick={() => openHostedBilling('portal')}
                disabled={billingAction !== null}
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-[#172019] transition-colors hover:bg-[#eef2ed] disabled:cursor-wait disabled:opacity-60"
              >
                {billingAction === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Manage billing
              </button>
            ) : null}
          </div>
          {usage.subscriptionProvider === 'stripe' ? (
            <p className={`mt-6 border-t pt-5 text-sm ${themePreference === 'light' ? 'border-black/10' : 'border-white/10'} ${mutedTextClass}`}>
              Use Manage billing to change plan, update payment details, review invoices, or cancel renewal without creating a duplicate subscription.
            </p>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {(['starter', 'growth', 'pro'] as const).map((plan) => (
                <button
                  key={plan}
                  type="button"
                  onClick={() => openHostedBilling('checkout', plan)}
                  disabled={billingAction !== null}
                  className={`flex min-h-12 items-center justify-between border px-4 py-3 text-left text-sm font-semibold capitalize transition-colors disabled:cursor-wait disabled:opacity-60 ${themePreference === 'light' ? 'border-black/15 bg-[#f4f6f2] hover:bg-[#e7ede7]' : 'border-white/15 bg-[#101712] hover:bg-white/[0.06]'}`}
                >
                  {plan}
                  {billingAction === plan ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
