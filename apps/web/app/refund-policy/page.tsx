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
      summary="This policy explains cancellation and refund requests for DrapixAI software subscriptions. It does not govern garment purchases from a merchant. Mandatory legal rights take priority; a signed agreement applies only where lawful."
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
            'DrapixAI may review refund requests on a case-by-case basis where there is verified duplicate billing, a platform outage that materially prevented use of the service, or another issue directly caused by us.',
            'Nothing in this policy removes a refund, cancellation, warranty or other remedy that applicable law requires. Contact us if a charge was unauthorized, duplicated or for a service that was not supplied.',
          ],
        },
        {
          heading: 'Trial and Promotional Offers',
          body: [
            'Free trials, coupons, credits, and launch promotions may be limited by time, account, usage, geography, or eligibility. Abuse of promotions may lead to suspension or cancellation.',
            'Creating a no-card trial does not by itself authorize a paid subscription. Review the price, billing frequency, renewal and cancellation details before accepting a paid checkout or order form.',
          ],
        },
        {
          heading: 'How to Request Cancellation or a Refund',
          body: [
            'Use the billing portal linked from your subscription page when available, or email contact@drapixai.com with the account email, invoice or transaction reference and a brief explanation. Do not send a full payment-card number, password, API key or shopper photo.',
            'Ask for confirmation of when cancellation takes effect and whether another charge is due. Refund eligibility and any expected processing period will be explained after the request is reviewed; no fixed processing deadline is promised on this page.',
          ],
        },
      ]}
    />
  );
}
