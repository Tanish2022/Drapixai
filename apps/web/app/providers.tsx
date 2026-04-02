'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import SiteAnalytics from './components/SiteAnalytics';

function SessionSync() {
  const { data: session } = useSession();
  useEffect(() => {
    const apiKey = (session as any)?.apiKey;
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
    }
  }, [session]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SiteAnalytics />
      <SessionSync />
      {children}
    </SessionProvider>
  );
}
