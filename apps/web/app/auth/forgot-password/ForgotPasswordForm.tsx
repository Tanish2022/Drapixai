'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [complete, setComplete] = useState(false);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestOtp = async () => {
    const response = await fetch(`${PUBLIC_API_BASE_URL}/auth/password-reset/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Unable to send reset code.');
    }
    setOtpRequested(true);
    setStatus(
      data?.debugOtp
        ? `Local dev reset code: ${data.debugOtp}`
        : 'If an account exists for that email, a 6-digit reset code has been sent.'
    );
  };

  const confirmReset = async () => {
    const response = await fetch(`${PUBLIC_API_BASE_URL}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Unable to reset password.');
    }
    setComplete(true);
    setStatus('Password reset complete. You can sign in with the new password.');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('');
    setIsSubmitting(true);

    try {
      if (!otpRequested) {
        await requestOtp();
      } else {
        await confirmReset();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (complete) {
    return (
      <div className="w-full max-w-xl">
        <div className="mb-5 flex h-12 w-12 items-center justify-center bg-[#eaf0e9] text-[#31725b]">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="mb-4 text-xs font-bold uppercase text-[#31725b]">Account recovery</p>
        <h1 className="mb-4 font-serif text-4xl">Password reset complete</h1>
        <p className="mb-6 leading-8 text-[#5d6961]">Your dashboard password has been updated. Sign in again to continue managing products, SDK keys, and launch review.</p>
        <Link href="/auth/login" className="inline-flex h-12 items-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
          Back to login
          <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <p className="mb-4 text-xs font-bold uppercase text-[#31725b]">Account recovery</p>
      <h1 className="mb-4 font-serif text-5xl leading-none">Reset your password.</h1>
      <p className="mb-8 leading-8 text-[#5d6961]">
        Enter your account email. If it matches a DrapixAI account, we will send a short-lived verification code without revealing whether the email is registered.
      </p>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-bold">Work email</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={otpRequested}
              required
              placeholder="you@company.com"
              className="h-12 w-full border border-black/15 bg-white pl-12 pr-4 outline-none placeholder:text-[#9ca49e] focus:border-[#31725b] disabled:bg-[#eef1ed]"
            />
          </div>
        </div>

        {otpRequested ? (
          <>
            <div className="border border-[#a8bbae] bg-[#edf3ee] p-4">
              <label className="mb-2 block text-sm font-bold text-[#183f32]">Reset code</label>
              <div className="relative">
                <ShieldCheck className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#31725b]" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  required
                  placeholder="Enter the 6-digit code"
                  className="h-12 w-full border border-black/15 bg-white pl-12 pr-4 outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  setIsSubmitting(true);
                  setStatus('');
                  try {
                    await requestOtp();
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : 'Unable to resend reset code.');
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="mt-3 text-sm font-bold text-[#183f32] hover:text-[#31725b] disabled:opacity-50"
                disabled={isSubmitting}
              >
                Resend reset code
              </button>
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold">New password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#849087]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                  placeholder="Create a new password"
                  className="h-12 w-full border border-black/15 bg-white pl-12 pr-16 outline-none placeholder:text-[#9ca49e] focus:border-[#31725b]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 inline-flex h-10 min-w-10 -translate-y-1/2 items-center justify-center px-2 text-xs font-bold text-[#667169] hover:text-[#183f32]"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="mt-2 flex gap-1">
                <div className={`h-1 flex-1 ${password.length >= 1 ? 'bg-[#b8584f]' : 'bg-[#dce1dc]'}`} />
                <div className={`h-1 flex-1 ${password.length >= 8 ? 'bg-[#c29b3b]' : 'bg-[#dce1dc]'}`} />
                <div className={`h-1 flex-1 ${password.length >= 12 ? 'bg-[#31725b]' : 'bg-[#dce1dc]'}`} />
              </div>
            </div>
          </>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#183f32] px-4 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (otpRequested ? 'Resetting...' : 'Sending code...') : otpRequested ? 'Reset password' : 'Send reset code'}
          <ArrowRight className="h-5 w-5" />
        </button>
      </form>

      {status ? <p role="status" className="mt-4 border border-[#b7c4ba] bg-[#f0f3ef] p-3 text-sm text-[#415047]">{status}</p> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/auth/login" className="border border-black/15 px-4 py-2 text-sm font-bold hover:bg-[#f1f4f0]">
          Back to login
        </Link>
        <Link href="/contact" className="border border-black/15 px-4 py-2 text-sm font-bold hover:bg-[#f1f4f0]">
          Contact support
        </Link>
      </div>
    </div>
  );
}
