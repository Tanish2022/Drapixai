'use client';

import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f2] px-5 py-16 text-[#172019]">
      <div className="w-full max-w-3xl border-y border-black/15 py-12">
        <AlertTriangle className="h-7 w-7 text-[#8a5b20]" />
        <p className="mt-6 text-xs font-bold uppercase text-[#31725b]">Something interrupted this view</p>
        <h1 className="mt-4 max-w-2xl font-serif text-4xl leading-tight sm:text-6xl">The page could not finish loading.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[#59645c]">Retry the current view. If the problem continues, return to the homepage or check service status.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 font-semibold text-white hover:bg-[#245a48]"><RotateCcw className="h-4 w-4" />Retry</button>
          <Link href="/" className="inline-flex h-12 items-center justify-center border border-black/15 bg-white px-5 font-semibold hover:bg-[#eef2ec]">Return home</Link>
          <Link href="/status" className="inline-flex h-12 items-center justify-center border border-black/15 px-5 font-semibold hover:bg-white">Service status</Link>
        </div>
      </div>
    </main>
  );
}
