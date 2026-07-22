'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

export default function AdminAccess() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, mfaCode }),
      });
      if (!response.ok) {
        setStatus('Access denied. Check your credentials and try again.');
        return;
      }
      router.push('/admin');
    } catch {
      setStatus('Admin access is temporarily unavailable.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-[#172019]">
      <header className="border-b border-black/10 bg-[#fbfcf9]">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-3" aria-label="DrapixAI home">
            <img src="/drapixai_emblem_64.webp" alt="" width={40} height={40} className="rounded-md" />
            <div><span className="block text-lg font-bold leading-none">DrapixAI</span><span className="mt-1 block text-[11px] font-semibold uppercase text-[#748078]">Restricted operations</span></div>
          </Link>
          <Link href="/" className="text-sm font-semibold text-[#667169] hover:text-[#172019]">Return to site</Link>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex items-center px-5 py-14 sm:px-8 lg:px-12 lg:py-20">
          <form onSubmit={submit} className="w-full max-w-md">
            <p className="text-xs font-bold uppercase text-[#31725b]">Admin authentication</p>
            <h1 className="mt-4 font-serif text-5xl leading-none">Control panel access.</h1>
            <p className="mt-4 leading-7 text-[#68736b]">Use the separately issued administrator credentials. Brand workspace credentials are not accepted here.</p>

            <div className="mt-10 space-y-6">
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Administrator email</span>
                <span className="relative block">
                  <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                  <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Administrator email" className="h-12 w-full border border-black/15 bg-white pl-12 pr-4 outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]" />
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Authenticator code</span>
                <input type="text" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="h-12 w-full border border-black/15 bg-white px-4 tracking-widest outline-none placeholder:tracking-normal placeholder:text-[#9ca49e] focus:border-[#31725b]" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Password</span>
                <span className="relative block">
                  <LockKeyhole className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                  <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Admin password" className="h-12 w-full border border-black/15 bg-white pl-12 pr-4 outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]" />
                </span>
              </label>
              <button type="submit" disabled={isSubmitting} className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? 'Checking access...' : 'Continue'} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {status ? <p role="alert" className="mt-4 border border-[#d6a29c] bg-[#fbefed] p-3 text-sm text-[#7c2d27]">{status}</p> : null}
          </form>
        </section>

        <aside className="flex items-center bg-[#101712] px-5 py-14 text-white sm:px-8 lg:px-16">
          <div className="max-w-lg">
            <ShieldCheck className="h-8 w-8 text-[#8eb8a3]" />
            <h2 className="mt-7 font-serif text-4xl leading-tight">Operational data stays behind a separate trust boundary.</h2>
            <p className="mt-5 leading-7 text-[#aab6ac]">The admin console contains quality review, product approval, customer usage, and launch-readiness controls. Access attempts are rate-limited and should be monitored in production.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
