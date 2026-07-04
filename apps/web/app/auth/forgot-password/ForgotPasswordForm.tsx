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
      <div className="max-w-xl w-full rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-10">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Account Recovery</p>
        <h1 className="text-3xl font-bold mb-4">Password reset complete</h1>
        <p className="text-gray-300 leading-8 mb-6">Your dashboard password has been updated. Sign in again to continue managing products, SDK keys, and launch review.</p>
        <Link href="/auth/login" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 font-semibold text-white transition-opacity hover:opacity-90">
          Back to login
          <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl w-full rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-10">
      <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Account Recovery</p>
      <h1 className="text-3xl font-bold mb-4">Reset your password</h1>
      <p className="text-gray-300 leading-8 mb-6">
        Enter your account email. If it matches a DrapixAI account, we will send a short-lived verification code without revealing whether the email is registered.
      </p>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">Work email</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={otpRequested}
              required
              placeholder="you@company.com"
              className="w-full rounded-xl border border-white/[0.06] bg-[#081226] py-3 pl-12 pr-4 text-white placeholder-gray-500 transition-colors focus:border-cyan-500/50 focus:outline-none"
            />
          </div>
        </div>

        {otpRequested ? (
          <>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
              <label className="mb-2 block text-sm font-medium text-cyan-100">Reset code</label>
              <div className="relative">
                <ShieldCheck className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-300" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  required
                  placeholder="Enter the 6-digit code"
                  className="w-full rounded-xl border border-cyan-400/20 bg-[#081226] py-3 pl-12 pr-4 text-white placeholder-gray-500 transition-colors focus:border-cyan-400/60 focus:outline-none"
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
                className="mt-3 text-sm text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-50"
                disabled={isSubmitting}
              >
                Resend reset code
              </button>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">New password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                  placeholder="Create a new password"
                  className="w-full rounded-xl border border-white/[0.06] bg-[#081226] py-3 pl-12 pr-16 text-white placeholder-gray-500 transition-colors focus:border-cyan-500/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 transition-colors hover:text-white"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="mt-2 flex gap-1">
                <div className={`h-1 flex-1 rounded-full ${password.length >= 1 ? 'bg-red-500' : 'bg-white/[0.06]'}`} />
                <div className={`h-1 flex-1 rounded-full ${password.length >= 8 ? 'bg-yellow-500' : 'bg-white/[0.06]'}`} />
                <div className={`h-1 flex-1 rounded-full ${password.length >= 12 ? 'bg-green-500' : 'bg-white/[0.06]'}`} />
              </div>
            </div>
          </>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (otpRequested ? 'Resetting...' : 'Sending code...') : otpRequested ? 'Reset password' : 'Send reset code'}
          <ArrowRight className="h-5 w-5" />
        </button>
      </form>

      {status ? <p className="mt-4 text-sm text-cyan-100">{status}</p> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/auth/login" className="rounded-xl border border-cyan-400/30 px-4 py-2 transition-colors hover:bg-white/[0.05]">
          Back to login
        </Link>
        <Link href="/contact" className="rounded-xl border border-white/[0.12] px-4 py-2 transition-colors hover:bg-white/[0.05]">
          Contact support
        </Link>
      </div>
    </div>
  );
}