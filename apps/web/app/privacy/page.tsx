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
            'When shoppers use try-on features, DrapixAI transiently processes the submitted person photo and generated preview only to complete that requested try-on. Brand garment images and product mappings are processed separately as merchant-owned catalog assets.',
          ],
        },
        {
          heading: 'How We Use Information',
          body: [
            'We use collected information to provide the service, authenticate users, generate try-on results, monitor platform reliability, prevent abuse, and communicate about accounts, billing, and support.',
            'We may use metadata that does not contain shopper photos, such as latency, quality scores, warning codes, and aggregate feature usage, to improve reliability and infrastructure planning. Shopper photos and generated previews are never used to train DrapixAI or third-party AI models.',
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
            'Shopper person photos and generated try-on preview images are not persistently stored in DrapixAI databases or object storage. They are held only in protected transient memory or private temporary processing space and are deleted after completion or failure, with a 15-minute failsafe cleanup window for interrupted jobs. Image bytes and base64 payloads are excluded from application logs.',
            'DrapixAI retains metadata-only consent, security, billing, quality, and audit records without shopper image content. Brand garment assets and confirmed product mappings are retained while the brand account uses DrapixAI so approved try-on caches can operate. Shopper photos and generated previews are never used for model training.',
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
