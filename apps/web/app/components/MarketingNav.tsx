import Link from 'next/link';

type MarketingNavProps = {
  active?: 'demo' | 'pricing' | 'developers' | 'help';
};

const links = [
  { href: '/demo', label: 'Demo', id: 'demo' },
  { href: '/pricing', label: 'Pricing', id: 'pricing' },
  { href: '/docs', label: 'Developers', id: 'developers' },
  { href: '/help', label: 'Help', id: 'help' },
] as const;

export default function MarketingNav({ active }: MarketingNavProps) {
  return (
    <header className="border-b border-black/10 bg-[#fbfcf9]">
      <div className="mx-auto flex min-h-20 max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center" aria-label="DrapixAI home">
          <img src="/drapixai_wordmark.webp" alt="DrapixAI" width={176} height={59} className="h-12 w-auto object-contain" />
        </Link>

        <nav className="order-3 flex w-full items-center justify-between border-t border-black/10 pt-3 sm:order-none sm:w-auto sm:gap-7 sm:border-0 sm:pt-0" aria-label="Primary navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active === link.id ? 'page' : undefined}
              className={`inline-flex min-h-10 items-center px-1 text-sm font-medium ${active === link.id ? 'text-[#172019]' : 'text-[#5a665d] hover:text-[#172019]'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/auth/login" className="hidden px-3 py-2 text-sm font-semibold text-[#344038] sm:inline-flex">Sign in</Link>
          <Link href="/auth/register" className="inline-flex h-11 items-center bg-[#183f32] px-4 text-sm font-semibold text-white hover:bg-[#245a48]">Start free trial</Link>
        </div>
      </div>
    </header>
  );
}
