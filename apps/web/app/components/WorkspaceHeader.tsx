'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';

type WorkspacePage = 'dashboard' | 'sdk' | 'subscription' | 'settings';

type WorkspaceHeaderProps = {
  active: WorkspacePage;
  onLogout?: () => void | Promise<void>;
};

const links: Array<{ href: string; label: string; id: WorkspacePage }> = [
  { href: '/dashboard', label: 'Workspace', id: 'dashboard' },
  { href: '/sdk-install', label: 'Install', id: 'sdk' },
  { href: '/subscription', label: 'Usage', id: 'subscription' },
  { href: '/settings', label: 'Settings', id: 'settings' },
];

export default function WorkspaceHeader({ active, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="border-b border-black/10 bg-[#fbfcf9] text-[#172019]">
      <div className="mx-auto flex min-h-20 max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-12">
        <Link href="/dashboard" className="flex items-center gap-3" aria-label="DrapixAI workspace">
          <img src="/drapixai_emblem_64.webp" alt="" width={40} height={40} className="rounded-md" />
          <div>
            <span className="block text-lg font-bold leading-none">DrapixAI</span>
            <span className="mt-1 block text-[11px] font-semibold uppercase text-[#748078]">Brand workspace</span>
          </div>
        </Link>

        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto border-t border-black/10 pt-3 sm:order-none sm:w-auto sm:border-0 sm:pt-0" aria-label="Workspace navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active === link.id ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${active === link.id ? 'border-[#31725b] text-[#183f32]' : 'border-transparent text-[#667169] hover:text-[#172019]'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/" className="hidden px-3 py-2 text-sm font-semibold text-[#667169] hover:text-[#172019] md:inline-flex">View site</Link>
          {onLogout ? (
            <button type="button" onClick={() => void onLogout()} className="inline-flex h-10 w-10 items-center justify-center border border-black/15 bg-white text-[#536057] hover:bg-[#eef2ed] hover:text-[#172019]" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
