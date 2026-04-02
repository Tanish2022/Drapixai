'use client';

import Link from 'next/link';
import { Zap, Mail, Lock, User, ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GOOGLE_AUTH_ENABLED, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import { trackEvent } from '@/app/lib/analytics';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agreeTerms) {
      setStatus('Please accept the terms to continue.');
      return;
    }

    setStatus('');
    setIsSubmitting(true);

    try {
      const response = await fetch(`${PUBLIC_API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          companyName: name.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus(data?.error || 'Unable to create account.');
        return;
      }

      if (data?.apiKey) {
        localStorage.setItem('apiKey', data.apiKey);
      }
      router.push('/dashboard');
      trackEvent('trial_signup', { metadata: { source: 'password' } });
    } catch {
      setStatus('Unable to create account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050816] text-white flex">
      
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mb-12">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={56}
              height={56}
              className="rounded-xl"
            />
            <span className="text-2xl font-bold">DrapixAI</span>
          </Link>

          <h1 className="text-3xl font-bold mb-2">Create your account</h1>
          <p className="text-gray-400 mb-8">Start your 12-day free trial. No credit card required.</p>

          {/* Form */}
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full pl-12 pr-4 py-3 rounded-xl bg-[#0b1120] border border-white/[0.06] text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Work Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-12 pr-4 py-3 rounded-xl bg-[#0b1120] border border-white/[0.06] text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full pl-12 pr-12 py-3 rounded-xl bg-[#0b1120] border border-white/[0.06] text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-sm transition-colors"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {/* Password Strength */}
              <div className="mt-2 flex gap-1">
                <div className={`h-1 flex-1 rounded-full ${password.length >= 1 ? 'bg-red-500' : 'bg-white/[0.06]'}`} />
                <div className={`h-1 flex-1 rounded-full ${password.length >= 8 ? 'bg-yellow-500' : 'bg-white/[0.06]'}`} />
                <div className={`h-1 flex-1 rounded-full ${password.length >= 12 ? 'bg-green-500' : 'bg-white/[0.06]'}`} />
              </div>
            </div>

            {/* Terms */}
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded bg-[#0b1120] border-white/[0.06] text-cyan-400 focus:ring-cyan-400" 
                />
                <span className="text-sm text-gray-400">
                  I agree to the{' '}
                  <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">Terms of Service</Link>
                  {' '}and{' '}
                  <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">Privacy Policy</Link>
                </span>
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!agreeTerms || isSubmitting}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-white font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>
          {status && <p className="mt-4 text-sm text-red-300">{status}</p>}

          {/* Divider */}
          {GOOGLE_AUTH_ENABLED && (
            <>
              <div className="flex items-center gap-4 my-8">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-sm text-gray-500">or continue with</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <button
                  type="button"
                  onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
                  onMouseDown={() => trackEvent('cta_click', { metadata: { target: 'google_signup' } })}
                  className="py-3 px-4 rounded-xl bg-[#0b1120] border border-white/[0.06] text-white font-medium hover:bg-white/[0.05] transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Google
                </button>
              </div>
            </>
          )}

          {/* Sign In Link */}
          <p className="text-center text-gray-400 mt-8">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
              Sign in
            </Link>
          </p>

        </div>
      </div>

      {/* Right Side - Image/Pattern */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-[#0b1120] to-[#050816] relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-30" />
        <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[80px]" />
        
        <div className="relative z-10 text-center p-12">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center mx-auto mb-6">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold mb-4">Start Your Free Trial</h2>
          <p className="text-gray-400 max-w-md mb-8">
            Get instant access to AI-powered virtual try-on technology. No credit card required.
          </p>
          
          {/* Trust Badges */}
          <div className="flex flex-wrap justify-center gap-4">
            {['12-day free trial', 'No credit card', 'Cancel anytime', '24/7 support'].map((badge, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.06]">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm text-gray-300">{badge}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
