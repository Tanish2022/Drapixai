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
      summary="Use this page as the basic public contact page for sales, support, privacy, and billing questions. Replace the placeholder operational details with your final support process before launch."
      sections={[
        {
          heading: 'General Support',
          body: [
            'For product support, account access issues, and general inquiries, contact support@drapixai.com.',
            'If you plan to offer support windows, live chat, or ticket SLAs, add those details here before launch.',
          ],
        },
        {
          heading: 'Sales and Partnerships',
          body: [
            'For demos, pricing discussions, and brand partnerships, contact sales@drapixai.com.',
            'This page should also be updated later with your preferred response time and any customer success contact channels.',
          ],
        },
        {
          heading: 'Privacy, Legal, and Billing',
          body: [
            'Privacy requests and legal notices can be sent to privacy@drapixai.com or your designated legal inbox once finalized.',
            'Billing questions, invoice requests, and subscription changes should be routed to billing@drapixai.com if you plan to use separate operational mailboxes.',
          ],
        },
      ]}
    />
  );
}
