import type { Metadata } from 'next';
import DemoClient from './DemoClient';

export const metadata: Metadata = {
  title: 'Live Demo',
  description: 'Run a few free try-ons against the DrapixAI stack before signing up.',
};

export default function DemoPage() {
  return <DemoClient />;
}
