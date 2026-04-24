import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach DrapixAI for support, sales, and privacy requests.',
};

export default function ContactPage() {
  return (
    <LegalPage
      eyebrow="Contact"
      title="Contact DrapixAI"
      summary="Use this page for product support, launch questions, sales conversations, and privacy-related requests. Include your account email, store domain, and a short description of the issue so we can help faster."
      sections={[
        {
          heading: 'General Support',
          body: [
            'For product support, account access issues, and general inquiries, contact support@drapixai.com.',
            'When contacting support, include your account email, verified domain, garment or product ID if relevant, and whether the issue happened in demo, staging, or production.',
          ],
        },
        {
          heading: 'Sales and Partnerships',
          body: [
            'For demos, pricing discussions, and brand partnerships, contact sales@drapixai.com.',
            'If you are evaluating DrapixAI for a live rollout, tell us your storefront platform, expected monthly volume, and whether you need a guided onboarding call.',
          ],
        },
        {
          heading: 'Privacy, Legal, and Billing',
          body: [
            'Privacy requests and legal notices can be sent to privacy@drapixai.com.',
            'Billing questions, invoice requests, trial extensions, and launch-access requests should be sent to support@drapixai.com so they can be triaged with the related account context.',
          ],
        },
      ]}
    />
  );
}
