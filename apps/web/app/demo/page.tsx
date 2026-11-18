import type { Metadata } from 'next';
import DemoClient from './DemoClient';

export const metadata: Metadata = {
  title: 'Virtual Try-On Demo',
  description: 'Explore the DrapixAI evaluation interface. Try-on availability depends on the current environment and launch approval.',
};

export default function DemoPage() {
  return <DemoClient />;
}
