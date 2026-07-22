import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import SupportAssistant from './components/SupportAssistant';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000'),
  title: {
    default: 'DrapixAI - Product-Faithful Virtual Try-On',
    template: '%s | DrapixAI',
  },
  description: 'Product-faithful virtual try-on for fashion brands, with garment certification, quality-gated results, and native storefront experiences.',
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
    title: 'DrapixAI - Product-Faithful Virtual Try-On',
    description: 'Certify every product, preserve the real garment, and keep weak try-on results away from shoppers.',
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
    title: 'DrapixAI - Product-Faithful Virtual Try-On',
    description: 'Certify every product, preserve the real garment, and keep weak try-on results away from shoppers.',
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
    <html lang="en" className={`${inter.variable}`} data-scroll-behavior="smooth">
      <body className="bg-background text-foreground antialiased">
        <Providers>
          <SupportAssistant />
          {children}
        </Providers>
      </body>
    </html>
  );
}
