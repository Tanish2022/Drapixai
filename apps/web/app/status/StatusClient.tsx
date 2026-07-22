'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, TriangleAlert } from 'lucide-react';
import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';

type ServiceState = 'checking' | 'operational' | 'degraded';

type PublicReadiness = {
  checkedAt?: string;
  services?: { storefront?: boolean; api?: boolean; data?: boolean; ai?: boolean };
};

export default function StatusClient() {
  const [states, setStates] = useState<Record<string, ServiceState>>({ storefront: 'checking', api: 'checking', data: 'checking', ai: 'checking' });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(true);

  const checkServices = useCallback(async () => {
    setChecking(true);
    const next: Record<string, ServiceState> = { storefront: 'degraded', api: 'degraded', data: 'degraded', ai: 'degraded' };
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as PublicReadiness | null;
      next.storefront = response.ok && payload?.services?.storefront === true ? 'operational' : 'degraded';
      next.api = payload?.services?.api === true ? 'operational' : 'degraded';
      next.data = payload?.services?.data === true ? 'operational' : 'degraded';
      next.ai = payload?.services?.ai === true ? 'operational' : 'degraded';
      setCheckedAt(payload?.checkedAt ? new Date(payload.checkedAt) : new Date());
    } catch {
      next.storefront = 'degraded';
      setCheckedAt(new Date());
    }
    setStates(next);
    setChecking(false);
  }, []);

  useEffect(() => { void checkServices(); }, [checkServices]);

  const services = [
    ['storefront', 'Storefront and dashboard', 'Public pages, account experience, and SDK delivery'],
    ['api', 'Public API', 'Authentication, product mapping, try-on requests, and result delivery'],
    ['data', 'Data and queue', 'PostgreSQL and Redis readiness exposed by the API'],
    ['ai', 'Try-on engine', 'GPU worker and model readiness exposed by the API'],
  ] as const;
  const allOperational = services.every(([key]) => states[key] === 'operational');

  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav />
      <section className="border-b border-black/10">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-end md:py-24 lg:px-12">
          <div>
            <p className="text-xs font-bold uppercase text-[#31725b]">Live readiness</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.02] text-[#101712] sm:text-6xl">DrapixAI service status.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5d6961]">A direct readiness check of the storefront and API-managed data, queue, and AI services.</p>
          </div>
          <button type="button" onClick={() => void checkServices()} disabled={checking} className="inline-flex h-12 w-fit items-center justify-center gap-2 border border-black/15 bg-white px-5 text-sm font-bold hover:bg-[#eef2ed] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className={`border-l-4 p-6 ${allOperational ? 'border-[#31725b] bg-[#eaf0e9]' : 'border-[#b7832f] bg-[#fbf5e9]'}`}>
          <div className="flex items-center gap-3">{allOperational ? <CheckCircle2 className="h-6 w-6 text-[#31725b]" /> : <TriangleAlert className="h-6 w-6 text-[#9a6a1d]" />}<h2 className="text-xl font-semibold">{allOperational ? 'All checked services operational' : checking ? 'Checking services' : 'One or more services need attention'}</h2></div>
          <p className="mt-2 text-sm text-[#68736b]">{checkedAt ? `Last checked ${checkedAt.toLocaleString()}` : 'Waiting for the first readiness check.'}</p>
        </div>

        <div className="mt-8 border-y border-black/10">
          {services.map(([key, name, description]) => {
            const state = states[key];
            return (
              <div key={key} className="flex flex-col justify-between gap-4 border-b border-black/10 py-6 last:border-b-0 sm:flex-row sm:items-center">
                <div><h2 className="font-semibold">{name}</h2><p className="mt-1 text-sm text-[#68736b]">{description}</p></div>
                <span className={`inline-flex w-fit items-center gap-2 border px-3 py-2 text-sm font-semibold ${state === 'operational' ? 'border-[#9bb6a8] bg-[#eaf0e9] text-[#183f32]' : state === 'checking' ? 'border-black/15 bg-white text-[#68736b]' : 'border-[#d5b77d] bg-[#fbf5e9] text-[#7c5620]'}`}><Activity className="h-4 w-4" />{state === 'operational' ? 'Operational' : state === 'checking' ? 'Checking' : 'Degraded'}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-8 max-w-3xl text-sm leading-6 text-[#748078]">This page reports technical readiness, not generation quality. Production launch quality remains governed separately by product certification and result rejection controls.</p>
      </section>
      <MarketingFooter />
    </main>
  );
}
