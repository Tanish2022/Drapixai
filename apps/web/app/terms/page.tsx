import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';
import terms from '../../../api/src/legal/terms-2026-10-19.json';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing access to and use of DrapixAI.',
};

export default function TermsPage() {
  return <LegalPage eyebrow="Terms of Service" title={terms.title}
    summary={terms.summary} updatedLabel={`Terms version: ${terms.version}`}
    sections={terms.sections} />;
}
