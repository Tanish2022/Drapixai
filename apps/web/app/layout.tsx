import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import BackButton from './components/BackButton';
import Providers from './providers';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000'),
  title: {
    default: 'DrapixAI - AI Virtual Try-On Infrastructure',
    template: '%s | DrapixAI',
  },
  description: 'Increase eCommerce conversions with AI-powered virtual try-on technology. Enterprise-ready, developer-first, revenue-driven infrastructure for fashion brands.',
  keywords: [
    'AI virtual try-on',
    'eCommerce',
    'fashion technology',
    'AI infrastructure',
    'conversion optimization',
    'product visualization',
    'garment try-on',
    'fashion tech',
  ],
  authors: [{ name: 'DrapixAI' }],
  creator: 'DrapixAI',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://drapixai.com',
    siteName: 'DrapixAI',
    title: 'DrapixAI - AI Virtual Try-On Infrastructure',
    description: 'Increase eCommerce conversions with AI-powered virtual try-on technology.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DrapixAI - AI Virtual Try-On',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DrapixAI - AI Virtual Try-On Infrastructure',
    description: 'Increase eCommerce conversions with AI-powered virtual try-on technology.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <body className="bg-background text-white antialiased">
        <Providers>
          <BackButton />
          {children}
        </Providers>
      </body>
    </html>
  );
}
