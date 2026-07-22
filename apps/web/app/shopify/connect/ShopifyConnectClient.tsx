'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, Store, TriangleAlert } from 'lucide-react';

type Props = { installation: string; token: string; error: string };
type ConnectState = 'checking' | 'linking' | 'complete' | 'error';

const connectionMessageFor = (code: string) => {
  switch (code) {
    case 'SHOPIFY_LINK_MISSING':
      return 'Open this page from the Shopify installation flow or restart the connection from your DrapixAI dashboard.';
    case 'SHOPIFY_AUTH_FAILED':
      return 'Shopify authorization could not be completed. Return to your dashboard and try connecting the store again.';
    case 'SHOPIFY_LINK_EXPIRED':
      return 'This secure connection link has expired. Restart the Shopify connection from your dashboard.';
    case 'SHOPIFY_LINK_INVALID':
      return 'This secure connection link is not valid for the current workspace. Restart the connection from your dashboard.';
    case 'SHOPIFY_STORE_ALREADY_LINKED':
      return 'This Shopify store is already connected to another DrapixAI workspace. Contact support if the store should be transferred.';
    default:
      return 'We could not connect this Shopify store. Return to your dashboard and try again, or contact support if the problem continues.';
  }
};

export default function ShopifyConnectClient({ installation, token, error }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ConnectState>(error ? 'error' : 'checking');
  const [message, setMessage] = useState(error ? connectionMessageFor(error) : 'Checking your DrapixAI workspace...');
  const [sync, setSync] = useState<{ seen?: number; eligible?: number; ready?: number; queued?: number; skipped?: number } | null>(null);
  const [themeEditorUrl, setThemeEditorUrl] = useState('');

  useEffect(() => {
    if (error) return;
    if (!installation || !token) {
      setState('error');
      setMessage(connectionMessageFor('SHOPIFY_LINK_MISSING'));
      return;
    }

    const connect = async () => {
      const session = await fetch('/api/dashboard/session', { cache: 'no-store' });
      if (!session.ok) {
        const next = `/shopify/connect?installation=${encodeURIComponent(installation)}&token=${encodeURIComponent(token)}`;
        router.replace(`/auth/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setState('linking');
      setMessage('Attaching the store and importing supported products...');
      const response = await fetch('/api/dashboard/proxy/shopify/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: Number(installation), token }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; themeEditorUrl?: string | null; sync?: { seen?: number; eligible?: number; ready?: number; queued?: number; skipped?: number } } | null;
      if (!response.ok) {
        setState('error');
        setMessage(connectionMessageFor(payload?.error || 'SHOPIFY_LINK_FAILED'));
        return;
      }
      setSync(payload?.sync || null);
      setThemeEditorUrl(payload?.themeEditorUrl || '');
      setState('complete');
      setMessage('Your Shopify store is connected. Eligible product images are queued for safe garment preparation and review.');
      window.history.replaceState({}, '', '/shopify/connect?connected=1');
    };

    void connect().catch(() => {
      setState('error');
      setMessage(connectionMessageFor('SHOPIFY_LINK_FAILED'));
    });
  }, [error, installation, router, token]);

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-[#172019]">
      <header className="border-b border-black/10 bg-[#fbfcf9]">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/dashboard" className="flex items-center gap-3" aria-label="DrapixAI workspace">
            <img src="/drapixai_emblem_64.webp" alt="" width={40} height={40} className="rounded-md" />
            <div><span className="block text-lg font-bold leading-none">DrapixAI</span><span className="mt-1 block text-[11px] font-semibold uppercase text-[#748078]">Shopify connection</span></div>
          </Link>
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase text-[#31725b]"><ShieldCheck className="h-4 w-4" />Secure handoff</span>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex items-center px-5 py-14 sm:px-8 lg:px-12 lg:py-20">
          <div className="max-w-xl">
            <div className={`flex h-12 w-12 items-center justify-center border ${state === 'complete' ? 'border-[#9bb6a8] bg-[#eaf0e9]' : state === 'error' ? 'border-[#d5b77d] bg-[#fbf5e9]' : 'border-black/15 bg-white'}`}>
              {state === 'complete' ? <CheckCircle2 className="h-6 w-6 text-[#31725b]" /> : state === 'error' ? <TriangleAlert className="h-6 w-6 text-[#9a6a1d]" /> : <LoaderCircle className="h-6 w-6 animate-spin text-[#31725b]" />}
            </div>
            <p className="mt-7 text-xs font-bold uppercase text-[#31725b]">Secure store authorization</p>
            <h1 className="mt-4 font-serif text-5xl leading-[1.02] text-[#101712]">{state === 'complete' ? 'Shopify is connected.' : state === 'error' ? 'Connection needs attention.' : 'Preparing your catalog.'}</h1>
            <p className="mt-5 max-w-lg leading-7 text-[#5d6961]">{message}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {state === 'complete' && themeEditorUrl ? <a href={themeEditorUrl} className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">Add try-on block <ExternalLink className="h-4 w-4" /></a> : null}
              <Link href="/dashboard" className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]"><Store className="h-4 w-4" />Open workspace</Link>
              <Link href="/sdk-install" className="inline-flex h-12 items-center justify-center gap-2 border border-black/15 bg-white px-5 text-sm font-bold hover:bg-[#eef2ed]">Storefront setup <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </section>

        <aside className="bg-[#eaf0e9] px-5 py-14 sm:px-8 lg:px-14 lg:py-20">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase text-[#31725b]">Catalog handoff</p>
            <h2 className="mt-5 font-serif text-4xl leading-tight">Products enter review before shoppers see them.</h2>

            {state === 'complete' && sync ? (
              <dl className="mt-10 grid grid-cols-3 border-y border-black/10">
                <div className="py-6"><dt className="text-xs font-bold uppercase text-[#748078]">Seen</dt><dd className="mt-2 text-3xl font-semibold">{sync.seen || 0}</dd></div>
                <div className="border-x border-black/10 px-5 py-6"><dt className="text-xs font-bold uppercase text-[#31725b]">Eligible</dt><dd className="mt-2 text-3xl font-semibold">{sync.eligible || 0}</dd></div>
                <div className="pl-5 py-6"><dt className="text-xs font-bold uppercase text-[#748078]">Queued</dt><dd className="mt-2 text-3xl font-semibold">{sync.queued || 0}</dd></div>
              </dl>
            ) : (
              <ol className="mt-10 border-t border-black/10">
                {['Verify the secure installation link', 'Attach the store to this workspace', 'Import eligible upper-body products', 'Queue garment preparation for review'].map((item, index) => <li key={item} className="grid grid-cols-[3rem_1fr] border-b border-black/10 py-5 text-sm font-semibold"><span className="text-[#8d9890]">0{index + 1}</span>{item}</li>)}
              </ol>
            )}

            <div className="mt-10 flex gap-3 border-l-4 border-[#31725b] bg-white p-5 text-sm leading-6 text-[#5d6961]"><ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#31725b]" /><p>The Shopify offline token is encrypted. The storefront widget receives a separate domain-bound credential.</p></div>
          </div>
        </aside>
      </div>
    </main>
  );
}
