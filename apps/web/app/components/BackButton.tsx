'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <button
      onClick={() => {
        if (pathname.startsWith('/auth')) {
          router.push('/');
          return;
        }
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
        } else {
          router.push('/');
        }
      }}
      aria-label="Go back"
      className="fixed top-16 left-4 z-50 p-2 text-white/80 bg-white/5 border border-white/10 rounded-full backdrop-blur hover:text-white hover:bg-white/10 transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  );
}
