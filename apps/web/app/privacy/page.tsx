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
      summary="This policy explains what information DrapixAI collects, how it is used, and the steps taken to protect customer and end-user data across the current upper-body virtual try-on launch scope."
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
          heading: 'Shopify Store Data',
          body: [
            'When a merchant installs the DrapixAI Shopify app, DrapixAI processes the shop domain, store name, primary storefront domain, app installation metadata, product and variant identifiers, product titles and types, and product garment images. The launch app requests read_products only; it does not request Shopify customer, order, payment, or checkout data.',
            'Shopify product data is used only to synchronize the merchant catalog, prepare and review garment caches, map approved products to try-on assets, and operate the storefront try-on block. Storefront API keys are restricted to the merchant verified domain.',
            'When Shopify reports an app uninstall, DrapixAI disables the store access token and storefront key. When Shopify sends the mandatory shop-redact request, Shopify-origin catalog records, garment caches, mappings, stored garment assets, installation records, and the storefront key are deleted. DrapixAI does not retain Shopify customer webhook payloads because the launch app does not use customer or order data.',
          ],
        },
        {
          heading: 'Storage, Security, and Retention',
          body: [
            'DrapixAI uses technical and organizational safeguards to protect data in transit and at rest. Access to production systems is restricted to authorized personnel and service providers who need it to operate the platform.',
            'Shopper person photos and generated try-on preview images may be retained for up to 30 days for quality review, fraud prevention, abuse investigation, and support, then deleted or de-identified unless a longer period is required by law or an active dispute. Brand garment assets and confirmed product mappings are retained while the brand account uses DrapixAI so cached try-on assets can be regenerated after model or resolution upgrades. Security, billing, and audit logs may be retained for up to 12 months.',
          ],
        },
        {
          heading: 'Third-Party Services',
          body: [
            'DrapixAI relies on third-party infrastructure and software providers such as hosting, database, storage, email, analytics, and authentication vendors. Those providers may process data on our behalf under their own contractual and privacy terms.',
            'The current launch stack may use providers for hosting, GPU runtime, database, Redis/queueing, object storage, email delivery, authentication, analytics, and support operations. Provider access is limited to what is needed to operate DrapixAI.',
          ],
        },
        {
          heading: 'Your Rights and Contact',
          body: [
            'Depending on your location, you may have rights to access, correct, delete, or restrict certain personal information. You may also have the right to object to certain processing or request a copy of your data.',
            'For privacy requests, contact DrapixAI at privacy@drapixai.com. Support requests can still be sent to support@drapixai.com.',
          ],
        },
      ]}
    />
  );
}
