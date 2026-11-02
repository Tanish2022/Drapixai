import type { Metadata } from 'next';
import { DISCOVERY_PAGES } from '@/app/lib/discovery-pages';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = DISCOVERY_PAGES['/refund-policy'];

export default function RefundPolicyPage() {
  return (
    <LegalPage
      eyebrow="Refund and Cancellation"
      title="Refund and Cancellation Policy"
      updatedLabel="Notice revision: October 22, 2026"
      summary="This policy explains cancellation and refund requests for DrapixAI software subscriptions. It does not govern garment purchases from a merchant. Mandatory legal rights take priority; a signed agreement applies only where lawful."
      sections={[
        {
          heading: 'Subscription Cancellation',
          body: [
            'Cancel your monthly plan before its next renewal to stop the next monthly automatic payment and subsequent renewals. Cancellation does not itself refund charges for the current or earlier billing periods.',
            'Cancellation does not automatically erase historical account records, invoices, or compliance-related logs that must be retained for operational or legal reasons.',
          ],
        },
        {
          heading: 'Refunds',
          body: [
            'Correctly billed subscription fees are non-refundable, except where applicable law requires otherwise. Cancelling a plan, changing your mind or not using the service does not by itself qualify for a refund.',
            'We refund verified duplicate or mistaken charges. If we charged more than the agreed plan price, we refund the verified excess amount. Contact Support with the transaction reference so we can investigate and correct a billing error.',
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
          heading: 'How to Cancel or Report a Billing Error',
          body: [
            'Use the billing portal linked from your subscription page when available, or email support@drapixai.com with the account email, invoice or transaction reference and a brief explanation. Do not send a full payment-card number, password, API key or shopper photo.',
            'Ask for confirmation of when cancellation takes effect and whether another charge is due. Refund eligibility and any expected processing period will be explained after the request is reviewed; no fixed processing deadline is promised on this page.',
          ],
        },
      ]}
    />
  );
}
