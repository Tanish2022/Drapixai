import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import MarketingFooter from './components/MarketingFooter';
import MarketingNav from './components/MarketingNav';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav />
      <main className="border-b border-black/10">
        <div className="mx-auto grid min-h-[620px] max-w-[1440px] items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-12">
          <div>
            <p className="text-xs font-bold uppercase text-[#31725b]">Error 404</p>
            <p className="mt-5 font-serif text-8xl leading-none text-[#183f32] sm:text-9xl">404</p>
          </div>
          <div className="border-l border-black/15 pl-7 sm:pl-10">
            <Search className="h-6 w-6 text-[#31725b]" />
            <h1 className="mt-6 max-w-2xl font-serif text-4xl leading-tight sm:text-6xl">This page is not part of the current DrapixAI workspace.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#59645c]">The address may have changed, or the page may require a different account route.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/" className="inline-flex h-12 items-center justify-center gap-2 bg-[#183f32] px-5 font-semibold text-white hover:bg-[#245a48]"><ArrowLeft className="h-4 w-4" />Return home</Link>
              <Link href="/help" className="inline-flex h-12 items-center justify-center border border-black/15 bg-white px-5 font-semibold hover:bg-[#eef2ec]">Open Help Center</Link>
            </div>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
