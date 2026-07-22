import type { Metadata } from 'next';
import ShopifyConnectClient from './ShopifyConnectClient';

export const metadata: Metadata = {
  title: 'Connect Shopify',
  description: 'Securely attach an authorized Shopify store to a DrapixAI brand workspace.',
};

export default async function ShopifyConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ installation?: string; token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <ShopifyConnectClient installation={params.installation || ''} token={params.token || ''} error={params.error || ''} />;
}
