import type { Metadata } from 'next';
import StatusClient from './StatusClient';

export const metadata: Metadata = {
  title: 'Service Status',
  description: 'Current DrapixAI storefront, API, data, queue, and try-on engine readiness.',
};

export default function StatusPage() {
  return <StatusClient />;
}
