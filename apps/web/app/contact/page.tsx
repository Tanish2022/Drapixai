import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';
import { BUSINESS_DETAILS, businessIdentitySections } from '@/app/lib/business-details';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach DrapixAI for support, sales, and privacy requests.',
};

export default function ContactPage() {
  return (
    <LegalPage
      eyebrow="Contact"
      title="Contact DrapixAI"
      summary="Contact us about support, sales, billing or privacy. Describe your request briefly and include an account reference only when needed. Do not send passwords, API keys, payment-card details or shopper photos."
      sections={[
        ...businessIdentitySections(),
        {
          heading: 'General Support',
          body: [
            <>For support, account access and general enquiries, email <a href={`mailto:${BUSINESS_DETAILS.email}`} className="font-semibold underline">{BUSINESS_DETAILS.email}</a> or call <a href={BUSINESS_DETAILS.phoneHref} className="font-semibold underline">{BUSINESS_DETAILS.phone}</a>.</>,
            'For an account-specific issue, include only the account email or product reference needed to investigate. Do not attach shopper photos or identity documents unless a proportionate, secure process has been agreed.',
          ],
        },
        {
          heading: 'Sales and Partnerships',
          body: [
            'For demos, pricing discussions, and brand partnerships, contact contact@drapixai.com.',
            'If you are evaluating DrapixAI for a live rollout, tell us your storefront platform, expected monthly volume, and whether you need a guided onboarding call.',
          ],
        },
        {
          heading: 'Privacy, Legal, and Billing',
          body: [
            'Privacy requests and legal notices can be sent to contact@drapixai.com.',
            'Billing questions, invoice requests, trial extensions, and launch-access requests should be sent to contact@drapixai.com so they can be triaged with the related account context.',
          ],
        },
      ]}
    />
  );
}
