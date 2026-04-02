import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How DrapixAI collects, uses, stores, and protects data across the platform.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      summary="This policy explains what information DrapixAI collects, how it is used, and the steps taken to protect customer and end-user data. Update this page with your final legal review before public launch."
      sections={[
        {
          heading: 'Information We Collect',
          body: [
            'DrapixAI may collect account details such as name, company name, email address, billing-related information, API usage metadata, and support communications.',
            'When customers use try-on features, DrapixAI may process garment images, model images, generated outputs, and technical logs needed to operate, secure, and improve the service.',
          ],
        },
        {
          heading: 'How We Use Information',
          body: [
            'We use collected information to provide the service, authenticate users, generate try-on results, monitor platform reliability, prevent abuse, and communicate about accounts, billing, and support.',
            'We may also use aggregated or de-identified usage information to improve product performance, infrastructure planning, and overall user experience.',
          ],
        },
        {
          heading: 'Storage, Security, and Retention',
          body: [
            'DrapixAI uses technical and organizational safeguards to protect data in transit and at rest. Access to production systems is restricted to authorized personnel and service providers who need it to operate the platform.',
            'Uploaded assets, generated outputs, logs, and account records are retained only as long as needed for service delivery, legal compliance, dispute resolution, fraud prevention, and security operations. Final retention periods should be defined before launch.',
          ],
        },
        {
          heading: 'Third-Party Services',
          body: [
            'DrapixAI relies on third-party infrastructure and software providers such as hosting, database, storage, email, analytics, and authentication vendors. Those providers may process data on our behalf under their own contractual and privacy terms.',
            'You should list the final production providers on this page once your infrastructure stack is finalized.',
          ],
        },
        {
          heading: 'Your Rights and Contact',
          body: [
            'Depending on your location, you may have rights to access, correct, delete, or restrict certain personal information. You may also have the right to object to certain processing or request a copy of your data.',
            'For privacy requests, contact DrapixAI at support@drapixai.com until a dedicated privacy contact is published.',
          ],
        },
      ]}
    />
  );
}
