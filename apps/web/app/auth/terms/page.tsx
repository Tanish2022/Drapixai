'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import metadata from '../../../../api/src/legal/terms-metadata.json';

function TermsAcceptance() {
  const params = useSearchParams();
  const router = useRouter();
  const operator = params.get('scope') === 'admin';
  const endpoint = `/api/dashboard/terms${operator ? '?scope=admin' : ''}`;
  const requested = params.get('next') || '';
  const next = /^\/(?!\/)/.test(requested) && !/[\\\u0000-\u0020]/.test(requested)
    && !/^\/(auth|api)(\/|\?|$)/.test(requested) ? requested : operator ? '/admin' : '/onboarding';
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Checking your account…');
  const [signInRequired, setSignInRequired] = useState(false);

  const check = useCallback(async () => {
    setReady(false); setAccepted(false); setSignInRequired(false);
    setStatus('Checking your account…');
    const response = await fetch(endpoint, { cache: 'no-store' }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (response?.status === 401) { setSignInRequired(true); setStatus('Please sign in again to continue.'); return; }
    if (!response?.ok) { setStatus('We could not check your account. Please try again.'); return; }
    if (data?.version !== metadata.version || data?.documentHash !== metadata.documentHash) {
      setStatus('The terms have changed. Reload this page before accepting.'); return;
    }
    if (data.accepted) { router.replace(next); return; }
    setReady(true); setStatus('Review the terms and choose whether to accept.');
  }, [endpoint, next, router]);
  useEffect(() => { void check(); }, [check]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !accepted || busy) return;
    setBusy(true); setStatus('Saving your acceptance…');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, ...metadata }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) { setSignInRequired(true); setReady(false); }
        if (data?.error === 'TERMS_VERSION_CHANGED') {
          setReady(false); setAccepted(false); setStatus('The terms have changed. Reload this page before accepting.');
        } else setStatus(response.status === 401 ? 'Please sign in again to continue.' : 'Your acceptance was not saved. Please try again.');
        return;
      }
      router.replace(next); router.refresh();
    } catch { setStatus('Your acceptance was not saved. Check your connection and try again.'); }
    finally { setBusy(false); }
  };

  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-[#fbfcf9] px-5 py-16 text-[#172019]">
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Review and accept the terms</h1>
      <p>Before continuing with your account, please review our Terms of Service, version {metadata.version}.</p>
      <p><Link href={`/terms/${metadata.version}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">Read the Terms of Service (opens a new tab)</Link></p>
      <p>Our <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-bold underline">Privacy Policy (opens a new tab)</Link> explains how we handle personal data. Accepting the terms does not enable optional analytics or give permission to use someone else’s photos.</p>
      <form onSubmit={submit} className="space-y-6">
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input type="checkbox" required checked={accepted} disabled={!ready || busy} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-5 w-5 accent-[#183f32]" />
          <span>I accept the Terms of Service, version {metadata.version}.</span>
        </label>
        <button type="submit" disabled={!ready || !accepted || busy} className="min-h-11 bg-[#183f32] px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Saving acceptance…' : 'Accept terms and continue'}</button>
      </form>
      <p role="status" aria-live="polite">{status}</p>
      {signInRequired ? <Link href={operator ? '/admin-access' : `/auth/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center font-bold underline">Sign in again</Link>
        : !ready && !busy && <button type="button" onClick={() => void check()} className="min-h-11 px-3 font-bold underline">Check again</button>}
      <p>You can leave without accepting. <Link href="/" className="inline-flex min-h-11 items-center underline">Return to the homepage</Link> or <Link href="/contact" className="inline-flex min-h-11 items-center underline">contact us</Link>.</p>
    </div>
  </main>;
}

export default function TermsPage() {
  return <Suspense fallback={<main id="main-content" className="p-8">Loading account terms…</main>}><TermsAcceptance /></Suspense>;
}
