import Link from 'next/link';
import BrandLogo from './BrandLogo';
import { BUSINESS_DETAILS } from '@/app/lib/business-details';

export default function MarketingFooter() {
  return (
    <footer className="bg-[#101712] py-12 text-white">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex flex-col justify-between gap-8 border-b border-white/15 pb-10 md:flex-row md:items-end">
          <div>
            <div className="inline-flex bg-white px-2 py-1">
              <BrandLogo className="h-10 w-auto" />
            </div>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#9fac9f]">Standard upper-body AI try-on infrastructure for fashion commerce.</p>
            <address className="mt-4 max-w-md space-y-1 text-sm not-italic leading-6 text-[#bdc7bf]">
              <p className="font-semibold">{BUSINESS_DETAILS.legalName}</p>
              <p>{BUSINESS_DETAILS.address}</p>
              <p><a href={`mailto:${BUSINESS_DETAILS.email}`} className="inline-flex min-h-10 items-center underline underline-offset-4">{BUSINESS_DETAILS.email}</a></p>
              <p><a href={BUSINESS_DETAILS.phoneHref} className="inline-flex min-h-10 items-center underline underline-offset-4">{BUSINESS_DETAILS.phone}</a></p>
            </address>
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
