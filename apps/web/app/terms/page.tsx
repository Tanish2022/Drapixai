import type { Metadata } from 'next';
import { DISCOVERY_PAGES } from '@/app/lib/discovery-pages';
import LegalPage from '@/app/components/LegalPage';
import terms from '../../../api/src/legal/terms-2026-10-21.json';

export const metadata: Metadata = DISCOVERY_PAGES['/terms'];

export default function TermsPage() {
  return <LegalPage eyebrow="Terms of Service" title={terms.title}
    summary={terms.summary} updatedLabel={`Terms version: ${terms.version}`}
    sections={terms.sections} />;
}
