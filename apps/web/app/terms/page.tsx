import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Basic terms governing the use of DrapixAI.',
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms of Service"
      title="Terms of Service"
      summary="These terms govern access to and use of DrapixAI. They are a basic launch-ready starting point and should be reviewed and refined before public commercial deployment."
      sections={[
        {
          heading: 'Use of the Service',
          body: [
            'By accessing or using DrapixAI, you agree to use the platform only for lawful business purposes and in compliance with these terms, applicable laws, and third-party rights.',
            'You are responsible for the content you upload, the accuracy of your account information, and the actions taken through your account, API keys, and team members.',
          ],
        },
        {
          heading: 'Accounts, Security, and Access',
          body: [
            'You must protect your credentials, API keys, and any admin or internal access tokens issued to your organization. You are responsible for activity that occurs under your account unless caused directly by DrapixAI.',
            'DrapixAI may suspend or restrict access where necessary to address abuse, fraud, legal risk, security issues, infrastructure misuse, or non-payment.',
          ],
        },
        {
          heading: 'Customer Content and Platform Rights',
          body: [
            'You retain ownership of your uploaded images, brand assets, and other customer content. You grant DrapixAI the limited rights needed to host, process, transform, transmit, and store that content solely to operate and improve the service.',
            'DrapixAI retains ownership of the platform, models, software, APIs, documentation, trademarks, and all related intellectual property, except for rights expressly granted to customers.',
          ],
        },
        {
          heading: 'Billing and Service Changes',
          body: [
            'Paid plans, limits, and billing terms are described on the pricing page or in a separate commercial agreement. Charges, feature availability, and usage limits may change with notice as permitted by law or contract.',
            'Trial access, promotional offers, and discounts may be limited, revoked for misuse, or modified when the promotional period ends.',
          ],
        },
        {
          heading: 'Disclaimers and Liability',
          body: [
            'DrapixAI is provided on an as-available basis. While we work to maintain reliability and output quality, we do not guarantee uninterrupted service, error-free operation, or that every generated output will meet a specific commercial purpose.',
            'To the maximum extent permitted by law, DrapixAI will not be liable for indirect, incidental, special, consequential, or punitive damages. Direct liability should be capped in your final legal version.',
          ],
        },
      ]}
    />
  );
}
