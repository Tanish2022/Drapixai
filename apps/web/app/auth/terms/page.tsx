'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import metadata from '../../../../api/src/legal/terms-metadata.json';
import { requestJson, userError, WebsiteError } from '@/app/lib/user-feedback';

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
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    setReady(false); setAccepted(false); setSignInRequired(false); setFailed(false);
    setStatus('Checking your account…');
    try {
    // This same-origin read is origin-checked by the BFF. The site's default
    // no-referrer policy otherwise removes its only browser provenance header.
    const data = await requestJson(endpoint, { cache: 'no-store', referrerPolicy: 'same-origin' });
    if (data?.version !== metadata.version || data?.documentHash !== metadata.documentHash) {
      setFailed(true); setStatus('The terms have changed. Reload this page before accepting.'); return;
    }
    if (data.accepted) { router.replace(next); return; }
    setReady(true); setStatus('Review the terms and choose whether to accept.');
    } catch (error) {
      setFailed(true);
      setSignInRequired(error instanceof WebsiteError && error.status === 401);
      setStatus(userError(error, 'We could not check your account. Please try again.'));
    }
  }, [endpoint, next, router]);
  useEffect(() => { void check(); }, [check]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !accepted || busy) return;
    setBusy(true); setFailed(false); setStatus('Saving your acceptance…');
    try {
      const data = await requestJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, ...metadata }) });
      if (data.ok !== true) throw new WebsiteError('We could not confirm your acceptance. Choose Check again before retrying.');
      router.replace(next); router.refresh();
    } catch (error) {
        setFailed(true); setReady(false); setAccepted(false);
        if (error instanceof WebsiteError && error.status === 401) setSignInRequired(true);
        if (error instanceof WebsiteError && error.code === 'TERMS_VERSION_CHANGED') {
          setReady(false); setAccepted(false); setStatus('The terms have changed. Reload this page before accepting.');
        } else setStatus(userError(error, 'We could not confirm your acceptance. Check your connection and choose Check again before retrying.'));
    }
    finally { setBusy(false); }
  };

  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-[#fbfcf9] px-5 py-16 text-[#172019]">
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Review and accept the terms</h1>
      <p>Before continuing with your account, please review our Terms of Service, version {metadata.version}.</p>
      <p><Link href={`/terms/${metadata.version}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">Read the Terms of Service (opens a new tab)</Link></p>
      <p>Our <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-bold underline">Privacy Policy (opens a new tab)</Link> explains how we handle personal data. Accepting the terms does not enable optional analytics or give permission to use someone else’s photos.</p>
      <form onSubmit={submit} aria-busy={busy} aria-describedby="terms-feedback" className="space-y-6">
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input type="checkbox" required checked={accepted} disabled={!ready || busy} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-5 w-5 accent-[#183f32]" />
          <span>I accept the Terms of Service, version {metadata.version}.</span>
        </label>
        <button type="submit" disabled={!ready || !accepted || busy} className="min-h-11 bg-[#183f32] px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Saving acceptance…' : 'Accept terms and continue'}</button>
      </form>
      <p id="terms-feedback" role={failed ? 'alert' : 'status'} aria-atomic="true">{status}</p>
      {signInRequired ? <Link href={operator ? '/admin-access' : `/auth/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-11 items-center font-bold underline">Sign in again</Link>
        : !ready && !busy && <button type="button" onClick={() => void check()} className="min-h-11 px-3 font-bold underline">Check again</button>}
      <p>You can leave without accepting. <Link href="/" className="inline-flex min-h-11 items-center underline">Return to the homepage</Link> or <Link href="/contact" className="inline-flex min-h-11 items-center underline">contact us</Link>.</p>
    </div>
  </main>;
}

export default function TermsPage() {
  return <Suspense fallback={<main id="main-content" className="p-8">Loading account terms…</main>}><TermsAcceptance /></Suspense>;
}
