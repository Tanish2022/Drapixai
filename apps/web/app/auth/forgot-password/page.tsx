import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Forgot Password',
  description: 'Password reset support information for DrapixAI.',
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-[#050816] text-white flex items-center justify-center px-6">
      <div className="max-w-xl w-full rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-10">
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Account Recovery</p>
        <h1 className="text-3xl font-bold mb-4">Password reset is not self-serve yet.</h1>
        <p className="text-gray-300 leading-8 mb-6">
          For now, contact support@drapixai.com from your registered email address and include your company name. This page should be replaced with a real reset flow before public scale.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/auth/login" className="px-4 py-2 rounded-xl border border-cyan-400/30 hover:bg-white/[0.05] transition-colors">
            Back to Login
          </Link>
          <Link href="/contact" className="px-4 py-2 rounded-xl border border-white/[0.12] hover:bg-white/[0.05] transition-colors">
            Contact Support
          </Link>
        </div>
      </div>
    </main>
  );
}
