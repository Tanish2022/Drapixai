import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Refund and Cancellation Policy',
  description: 'Basic cancellation and refund terms for DrapixAI subscriptions.',
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      eyebrow="Refund and Cancellation"
      title="Refund and Cancellation Policy"
      summary="This page outlines the basic cancellation and refund expectations for DrapixAI subscriptions. Replace it with your final commercial terms if you introduce annual contracts, onboarding fees, or custom enterprise agreements."
      sections={[
        {
          heading: 'Subscription Cancellation',
          body: [
            'Customers may request cancellation of recurring subscriptions before the next billing cycle to avoid future charges, unless otherwise stated in a signed order form or enterprise agreement.',
            'Cancellation does not automatically erase historical account records, invoices, or compliance-related logs that must be retained for operational or legal reasons.',
          ],
        },
        {
          heading: 'Refunds',
          body: [
            'Unless required by law or explicitly stated in writing, fees already paid are generally non-refundable. Promotional credits, trial periods, and discounted plans may have separate rules.',
            'DrapixAI may review refund requests on a case-by-case basis where there is a verified platform outage, duplicate billing, or another service issue directly caused by us.',
          ],
        },
        {
          heading: 'Trial and Promotional Offers',
          body: [
            'Free trials, coupons, credits, and launch promotions may be limited by time, account, usage, geography, or eligibility. Abuse of promotions may lead to suspension or cancellation.',
            'When a promotional period ends, the applicable standard plan pricing will apply unless a different written offer was accepted.',
          ],
        },
      ]}
    />
  );
}
