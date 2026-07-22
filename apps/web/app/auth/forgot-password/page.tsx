import type { Metadata } from 'next';
import Link from 'next/link';
import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Forgot Password',
  description: 'Self-serve password reset for DrapixAI dashboard accounts.',
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <header className="border-b border-black/10">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-3" aria-label="DrapixAI home">
            <img src="/drapixai_emblem_64.webp" alt="" width={42} height={42} className="rounded-md" />
            <span className="text-lg font-bold">DrapixAI</span>
          </Link>
          <Link href="/auth/login" className="text-sm font-bold text-[#183f32] hover:text-[#31725b]">Back to sign in</Link>
        </div>
      </header>
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex items-center px-5 py-14 sm:px-8 lg:px-12 lg:py-20"><ForgotPasswordForm /></section>
        <aside className="flex items-center bg-[#eaf0e9] px-5 py-14 sm:px-8 lg:px-16">
          <div className="max-w-lg"><p className="text-xs font-bold uppercase text-[#31725b]">Secure recovery</p><h2 className="mt-5 font-serif text-4xl leading-tight">A short-lived code. No account disclosure.</h2><p className="mt-5 leading-7 text-[#5d6961]">Password recovery uses a time-limited email verification code and returns the same public response whether an account exists or not.</p></div>
        </aside>
      </div>
    </main>
  );
}
