import type { Metadata } from 'next';
import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Forgot Password',
  description: 'Self-serve password reset for DrapixAI dashboard accounts.',
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-[#050816] text-white flex items-center justify-center px-6 py-12">
      <ForgotPasswordForm />
    </main>
  );
}