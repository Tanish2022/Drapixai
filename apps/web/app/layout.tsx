import type { Metadata } from 'next';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import './globals.css';
import Providers from './providers';
import SupportAssistant from './components/SupportAssistant';
import SkipToContent from './components/SkipToContent';
import StructuredData from './components/StructuredData';
import discoveryPolicy from './lib/discovery-policy.cjs';
import { discoveryPage } from './lib/discovery-pages';
import { BUSINESS_DETAILS } from './lib/business-details';

export async function generateMetadata(): Promise<Metadata> {
  const pathname = (await headers()).get('x-drapixai-pathname') || '';
  const page = discoveryPage(pathname);
  const index = discoveryPolicy.publicIndexingEnabled() && !!page;
  const title = page ? `${page.title} | DrapixAI` : 'DrapixAI';
  const description = page?.description || 'DrapixAI account and service information.';
  return {
  metadataBase: new URL(discoveryPolicy.PUBLIC_ORIGIN),
  title: {
    default: title,
    template: '%s | DrapixAI',
  },
  description,
  alternates: page ? { canonical: pathname } : undefined,
  authors: [{ name: 'DrapixAI' }],
  creator: 'DrapixAI',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    ...(page ? { url: pathname } : {}),
    siteName: 'DrapixAI',
    title,
    description,
    images: [
      {
        url: '/og-drapixai-20261031-v2.png',
        width: 1200,
        height: 630,
        alt: 'DrapixAI — Virtual try-on for fashion storefronts',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [{ url: '/og-drapixai-20261031-v2.png', alt: 'DrapixAI — Virtual try-on for fashion storefronts' }],
  },
  robots: {
    index,
    follow: index,
    googleBot: {
      index,
      follow: index,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico?v=20261031-source' },
      { url: '/favicon-32x32.png?v=20261031-source', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon-16x16.png?v=20261031-source',
    apple: '/apple-touch-icon.png?v=20261031-source',
  },
  manifest: '/site.webmanifest?v=20261031-source',
};
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The proxy creates a fresh CSP nonce per request. Prerendered HTML cannot
  // attach that nonce to Next.js bootstrap scripts and would block hydration.
  await connection();
  const pathname = (await headers()).get('x-drapixai-pathname');
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="bg-background text-foreground antialiased">
        {pathname === '/' && <StructuredData data={{
          '@context': 'https://schema.org', '@graph': [
            { '@type': 'Organization', '@id': `${discoveryPolicy.PUBLIC_ORIGIN}/#organization`,
              name: 'DrapixAI', legalName: BUSINESS_DETAILS.legalName, url: discoveryPolicy.PUBLIC_ORIGIN,
              email: BUSINESS_DETAILS.email, telephone: '+916351079022', address: BUSINESS_DETAILS.address },
            { '@type': 'WebSite', '@id': `${discoveryPolicy.PUBLIC_ORIGIN}/#website`,
              url: discoveryPolicy.PUBLIC_ORIGIN, name: 'DrapixAI',
              publisher: { '@id': `${discoveryPolicy.PUBLIC_ORIGIN}/#organization` } },
          ],
        }} />}
        <SkipToContent />
        <Providers>
          <SupportAssistant />
          {children}
        </Providers>
      </body>
    </html>
  );
}
