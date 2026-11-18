import { notFound } from 'next/navigation';
import LegalPage from '@/app/components/LegalPage';
import previousTerms from '../../../../api/src/legal/terms-2026-10-19.json';
import currentTerms from '../../../../api/src/legal/terms-2026-10-21.json';

export default async function TermsVersionPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const terms = [previousTerms, currentTerms].find(document => document.version === version);
  if (!terms) notFound();
  return <LegalPage eyebrow="Terms of Service" title={terms.title}
    summary={terms.summary} updatedLabel={`Terms version: ${terms.version}`}
    sections={terms.sections} />;
}
