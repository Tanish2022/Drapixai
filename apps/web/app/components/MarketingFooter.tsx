import Link from 'next/link';

export default function MarketingFooter() {
  return (
    <footer className="bg-[#101712] py-12 text-white">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex flex-col justify-between gap-8 border-b border-white/15 pb-10 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-3">
              <img src="/drapixai_emblem_64.webp" alt="" width={42} height={42} className="rounded-md" />
              <span className="text-xl font-bold">DrapixAI</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#9fac9f]">Standard upper-body AI try-on infrastructure for fashion commerce.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#bdc7bf]">
            <Link href="/help" className="inline-flex min-h-10 items-center hover:text-white">Help</Link>
            <Link href="/docs" className="inline-flex min-h-10 items-center hover:text-white">Developers</Link>
            <Link href="/status" className="inline-flex min-h-10 items-center hover:text-white">Status</Link>
            <Link href="/changelog" className="inline-flex min-h-10 items-center hover:text-white">Changelog</Link>
            <Link href="/pricing" className="inline-flex min-h-10 items-center hover:text-white">Pricing</Link>
            <Link href="/contact" className="inline-flex min-h-10 items-center hover:text-white">Contact</Link>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-5 pt-8 text-xs text-[#7f8d82] sm:flex-row">
          <p>Copyright 2026 DrapixAI. All rights reserved.</p>
          <div className="flex flex-wrap gap-5">
              <Link href="/privacy" className="inline-flex min-h-10 items-center hover:text-white">Privacy</Link>
              <Link href="/terms" className="inline-flex min-h-10 items-center hover:text-white">Terms</Link>
              <Link href="/refund-policy" className="inline-flex min-h-10 items-center hover:text-white">Refunds</Link>
              <Link href="/cookies" className="inline-flex min-h-10 items-center hover:text-white">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
