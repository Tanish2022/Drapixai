'use client';

import Link from 'next/link';
import { ArrowRight, Check, Lock, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GOOGLE_AUTH_ENABLED } from '@/app/lib/public-env';
import { trackEvent } from '@/app/lib/analytics';

function getSafeNextPath() {
  if (typeof window === 'undefined') return '/';
  const requested = new URLSearchParams(window.location.search).get('next');
  return requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState('/');
  const router = useRouter();

  useEffect(() => setNextPath(getSafeNextPath()), []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/dashboard/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'login', email, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(data?.error || 'Unable to sign in.');
        return;
      }

      router.push(nextPath);
      trackEvent('user_login', { metadata: { source: 'password' } });
    } catch {
      setStatus('Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <header className="border-b border-black/10">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-3" aria-label="DrapixAI home">
            <img src="/drapixai_emblem_64.webp" alt="" width={42} height={42} className="rounded-md" />
            <span className="text-lg font-bold">DrapixAI</span>
          </Link>
          <p className="text-sm text-[#68736b]"><span className="hidden sm:inline">New to DrapixAI? </span><Link href={`/auth/register?next=${encodeURIComponent(nextPath)}`} className="font-bold text-[#183f32] hover:text-[#31725b]">Start a trial</Link></p>
        </div>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] lg:grid-cols-[0.88fr_1.12fr]">
        <section className="flex items-center px-5 py-14 sm:px-8 lg:px-12 lg:py-20">
          <div className="w-full max-w-md">
            <p className="text-xs font-bold uppercase text-[#31725b]">Workspace access</p>
            <h1 className="mt-4 font-serif text-5xl leading-none text-[#101712]">Welcome back.</h1>
            <p className="mt-4 leading-7 text-[#68736b]">Sign in to manage products, review try-on quality, and monitor storefront activity.</p>

            <form className="mt-10 space-y-6" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Email</span>
                <span className="relative block">
                  <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                  <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className="h-12 w-full border border-black/15 bg-white pl-12 pr-4 text-[#172019] outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]" />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold">Password</span>
                <span className="relative block">
                  <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                  <input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 w-full border border-black/15 bg-white pl-12 pr-16 text-[#172019] outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 inline-flex h-10 min-w-10 -translate-y-1/2 items-center justify-center px-2 text-xs font-bold text-[#667169] hover:text-[#183f32]">{showPassword ? 'Hide' : 'Show'}</button>
                </span>
              </label>

              <div className="flex items-center justify-between gap-4 text-sm">
                <label className="flex items-center gap-2 text-[#68736b]"><input type="checkbox" className="h-4 w-4 accent-[#183f32]" />Remember me</label>
                <Link href="/auth/forgot-password" className="font-bold text-[#183f32] hover:text-[#31725b]">Forgot password?</Link>
              </div>

              <button type="submit" disabled={isSubmitting} className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? 'Signing in...' : 'Sign in'} <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            {status ? <p role="alert" className="mt-4 border border-[#d6a29c] bg-[#fbefed] p-3 text-sm text-[#7c2d27]">{status}</p> : null}

            {GOOGLE_AUTH_ENABLED ? (
              <div className="mt-8 border-t border-black/10 pt-8">
                <button type="button" onClick={() => signIn('google', { callbackUrl: nextPath })} onMouseDown={() => trackEvent('cta_click', { metadata: { target: 'google_login' } })} className="flex h-12 w-full items-center justify-center gap-3 border border-black/15 bg-white text-sm font-bold hover:bg-[#f1f4f0]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="flex items-center bg-[#eaf0e9] px-5 py-14 sm:px-8 lg:px-16 lg:py-20">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase text-[#31725b]">Inside your workspace</p>
            <h2 className="mt-5 font-serif text-4xl leading-tight text-[#101712] sm:text-5xl">Product readiness at a glance.</h2>
            <p className="mt-5 max-w-lg leading-7 text-[#5d6961]">Review every garment from upload through preparation, approval, storefront mapping, and live performance.</p>
            <div className="mt-10 border-y border-black/10">
              {['Garment cache and mapping status', 'Quality and latency review', 'Storefront usage and launch checks'].map((item) => (
                <p key={item} className="flex items-center gap-3 border-b border-black/10 py-5 text-sm font-semibold last:border-b-0"><Check className="h-4 w-4 text-[#31725b]" />{item}</p>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
