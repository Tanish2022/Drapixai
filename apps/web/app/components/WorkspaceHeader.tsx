'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { useRef, useState } from 'react';
import FeedbackMessage from './FeedbackMessage';

type WorkspacePage = 'onboarding' | 'dashboard' | 'sdk' | 'subscription' | 'settings';

type WorkspaceHeaderProps = {
  active: WorkspacePage;
  onLogout?: () => void | Promise<void>;
};

const links: Array<{ href: string; label: string; id: WorkspacePage }> = [
  { href: '/onboarding', label: 'Get started', id: 'onboarding' },
  { href: '/dashboard', label: 'Workspace', id: 'dashboard' },
  { href: '/sdk-install', label: 'Install', id: 'sdk' },
  { href: '/subscription', label: 'Usage', id: 'subscription' },
  { href: '/settings', label: 'Settings', id: 'settings' },
];

export default function WorkspaceHeader({ active, onLogout }: WorkspaceHeaderProps) {
  const running = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const logout = async () => {
    if (running.current || !onLogout) return;
    running.current = true; setSigningOut(true); setLogoutError('');
    try { await onLogout(); }
    catch { setLogoutError('We could not confirm sign-out. Check your connection and try again. Close this browser before leaving a shared device.'); }
    finally { running.current = false; setSigningOut(false); }
  };
  return (
    <header className="border-b border-black/10 bg-[#fbfcf9] text-[#172019]">
      <div className="mx-auto flex min-h-20 max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-12">
        <Link href="/dashboard" className="flex flex-col items-start gap-1" aria-label="DrapixAI Brand workspace">
          <BrandLogo className="h-9 w-auto" />
          <span className="block text-[10px] font-semibold uppercase text-[#59665e]">Brand workspace</span>
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
            <button type="button" disabled={signingOut} onClick={() => void logout()} className="inline-flex h-10 w-10 items-center justify-center border border-black/15 bg-white text-[#536057] hover:bg-[#eef2ed] hover:text-[#172019]" aria-label={signingOut ? 'Signing out' : 'Sign out'} title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {logoutError && <div className="mx-auto max-w-5xl px-5"><FeedbackMessage feedback={{ message: logoutError, tone: 'error' }} /></div>}
    </header>
  );
}
