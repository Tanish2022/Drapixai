'use client';

import Link from 'next/link';
import { ArrowRight, Check, Lock, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GOOGLE_AUTH_ENABLED, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import { trackEvent } from '@/app/lib/analytics';

const formatSelectedPlan = (value: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getSafeNextPath = (value: string | null) =>
  value?.startsWith('/') && !value.startsWith('//') ? value : '/';

const fieldClass = 'h-12 w-full border border-black/15 bg-white pl-12 pr-4 text-[#172019] outline-none placeholder:text-[#9ca49e] focus:border-[#31725b] disabled:bg-[#eef1ed] disabled:text-[#78837b]';

function RegisterPageContent() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedPlan = searchParams.get('plan');
  const nextPath = getSafeNextPath(searchParams.get('next'));
  const selectedPlanLabel = formatSelectedPlan(selectedPlan);

  const requestOtp = async () => {
    const response = await fetch(`${PUBLIC_API_BASE_URL}/auth/register/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Unable to send verification code.');
    setStatus(data?.debugOtp
      ? `Local dev verification code: ${data.debugOtp}`
      : 'We sent a 6-digit verification code to your email. Enter it below to finish creating the account.');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agreeTerms) {
      setStatus('Please accept the terms to continue.');
      return;
    }

    setStatus('');
    setIsSubmitting(true);
    try {
      if (!otpRequested) {
        await requestOtp();
        setOtpRequested(true);
        return;
      }

      const response = await fetch('/api/dashboard/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'register', email, password, otp, mobileNumber, companyName: name.trim(), selectedPlan }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data?.error || 'Unable to create account.');
        return;
      }

      router.push(nextPath);
      trackEvent('trial_signup', { metadata: { source: 'password' } });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendOtp = async () => {
    setIsSubmitting(true);
    try {
      await requestOtp();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to resend verification code.');
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
          <p className="text-sm text-[#68736b]"><span className="hidden sm:inline">Already registered? </span><Link href={`/auth/login?next=${encodeURIComponent(nextPath)}`} className="font-bold text-[#183f32] hover:text-[#31725b]">Sign in</Link></p>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="px-5 py-14 sm:px-8 lg:px-12 lg:py-20">
          <div className="w-full max-w-xl">
            <p className="text-xs font-bold uppercase text-[#31725b]">Brand workspace</p>
            <h1 className="mt-4 font-serif text-5xl leading-none text-[#101712]">Start with real products.</h1>
            <p className="mt-4 max-w-lg leading-7 text-[#68736b]">Create a trial workspace with up to 300 try-ons over 12 days. No credit card required.</p>

            {selectedPlanLabel ? (
              <div className="mt-6 border-l-4 border-[#31725b] bg-[#eaf0e9] px-5 py-4 text-sm leading-6">
                <strong>{selectedPlanLabel} selected.</strong> You will begin on the shared trial and can confirm this plan after measuring real usage.
              </div>
            ) : null}

            <form className="mt-10 grid gap-6 sm:grid-cols-2" onSubmit={handleSubmit}>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-bold">Brand or company name</span>
                <span className="relative block"><User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" /><input type="text" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your brand" className={fieldClass} /></span>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-bold">Work email</span>
                <span className="relative block"><Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" /><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" disabled={otpRequested} className={fieldClass} /></span>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-bold">Mobile number <span className="font-normal text-[#7f8982]">(optional)</span></span>
                <span className="relative block"><Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" /><input type="tel" autoComplete="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} placeholder="+91 98765 43210" className={fieldClass} /></span>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-bold">Password</span>
                <span className="relative block">
                  <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                  <input type={showPassword ? 'text' : 'password'} required autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a strong password" disabled={otpRequested} className={`${fieldClass} pr-16`} />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 inline-flex h-10 min-w-10 -translate-y-1/2 items-center justify-center px-2 text-xs font-bold text-[#667169] hover:text-[#183f32]">{showPassword ? 'Hide' : 'Show'}</button>
                </span>
                <span className="mt-2 grid grid-cols-3 gap-1" aria-label="Password strength">
                  <span className={`h-1 ${password.length >= 1 ? 'bg-[#b8584f]' : 'bg-[#dce1dc]'}`} />
                  <span className={`h-1 ${password.length >= 8 ? 'bg-[#c29b3b]' : 'bg-[#dce1dc]'}`} />
                  <span className={`h-1 ${password.length >= 12 ? 'bg-[#31725b]' : 'bg-[#dce1dc]'}`} />
                </span>
              </label>

              {otpRequested ? (
                <div className="border border-[#a8bbae] bg-[#edf3ee] p-5 sm:col-span-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-[#183f32]">Email verification code</span>
                    <span className="relative block"><ShieldCheck className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#31725b]" /><input type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="Enter the 6-digit code" className={fieldClass} /></span>
                  </label>
                  <button type="button" onClick={resendOtp} disabled={isSubmitting} className="mt-3 text-sm font-bold text-[#183f32] hover:text-[#31725b] disabled:opacity-50">Resend verification code</button>
                </div>
              ) : null}

              <label className="flex items-start gap-3 text-sm leading-6 text-[#68736b] sm:col-span-2">
                <input type="checkbox" checked={agreeTerms} onChange={(event) => setAgreeTerms(event.target.checked)} className="mt-1 h-4 w-4 accent-[#183f32]" />
                <span>I agree to the <Link href="/terms" className="font-bold text-[#183f32]">Terms of Service</Link> and <Link href="/privacy" className="font-bold text-[#183f32]">Privacy Policy</Link>.</span>
              </label>

              <button type="submit" disabled={!agreeTerms || isSubmitting} className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2">
                {isSubmitting ? (otpRequested ? 'Verifying...' : 'Sending code...') : (otpRequested ? 'Verify and create workspace' : 'Send verification code')}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            {status ? <p role="status" className="mt-4 border border-[#b7c4ba] bg-[#f0f3ef] p-3 text-sm text-[#415047]">{status}</p> : null}

            {GOOGLE_AUTH_ENABLED ? (
              <div className="mt-8 border-t border-black/10 pt-8">
                <button type="button" onClick={() => signIn('google', { callbackUrl: nextPath })} onMouseDown={() => trackEvent('cta_click', { metadata: { target: 'google_signup' } })} className="flex h-12 w-full items-center justify-center gap-3 border border-black/15 bg-white text-sm font-bold hover:bg-[#f1f4f0]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 0 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="bg-[#eaf0e9] px-5 py-14 sm:px-8 lg:px-14 lg:py-20">
          <div className="sticky top-10">
            <p className="text-xs font-bold uppercase text-[#31725b]">The trial is operational</p>
            <h2 className="mt-5 font-serif text-4xl leading-tight text-[#101712]">Prepare, review, then publish.</h2>
            <p className="mt-5 leading-7 text-[#5d6961]">DrapixAI does not put an unreviewed garment directly in front of shoppers. Each product follows a visible readiness path.</p>
            <ol className="mt-10 border-t border-black/10">
              {['Import products', 'Prepare garment cache', 'Approve product quality', 'Install storefront block'].map((item, index) => (
                <li key={item} className="grid grid-cols-[3rem_1fr] border-b border-black/10 py-5 text-sm font-semibold"><span className="text-[#8d9890]">0{index + 1}</span>{item}</li>
              ))}
            </ol>
            <div className="mt-10 border-l-4 border-[#183f32] bg-white px-5 py-5">
              <p className="flex items-center gap-2 text-sm font-bold"><Check className="h-4 w-4 text-[#31725b]" /> 300 try-ons over 12 days</p>
              <p className="mt-2 text-sm text-[#68736b]">No credit card. Standard upper-body generation. Help center included.</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#fbfcf9] text-[#68736b]">Loading registration...</div>}>
      <RegisterPageContent />
    </Suspense>
  );
}
