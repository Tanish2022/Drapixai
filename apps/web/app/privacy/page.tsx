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
      updatedLabel="Privacy notice version: 2026-10-18"
      summary="This policy explains what information DrapixAI collects, how it is used, and the steps taken to protect customer and end-user data across the current upper-body virtual try-on launch scope."
      sections={[
        {
          heading: 'Information We Collect',
          body: [
            'For a merchant workspace we process the account email, brand or company name, protected authentication credentials, selected plan, usage records and messages you send us. Optional profile details are not required by the registration form. Hosted checkout providers process payment details; do not send payment-card numbers to support.',
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
            'The Shopify integration is optional and requires a merchant installation. On an uninstall notification, access is disabled. On a shop-redact request, Shopify-origin catalog records, garment caches, mappings, stored garment assets and installation data are removed. Storefront credentials are revoked and store-identifying fields are redacted; minimum key references may remain for historical billing, usage or unsettled quota accounting. This is not a promise to erase every financial or security record.',
          ],
        },
        {
          heading: 'Storage, Security, and Retention',
          body: [
            'The service is designed to restrict access, protect authenticated sessions, redact sensitive application logs and use private temporary processing space. These safeguards do not make any online service risk-free. Do not submit sensitive documents or unrelated personal information in a try-on image.',
            'The current try-on design uses memory and private temporary files instead of a persistent shopper-image library. Normal completion and failure paths clean up temporary files. Interrupted-job cleanup uses a 15-minute file-age threshold; scheduled checks, activity, restart and service availability affect when cleanup actually runs. Fifteen minutes is not a guaranteed deletion deadline, and a photo you download remains under your own control. Image bytes and base64 payloads are excluded from application logs.',
            'DrapixAI retains metadata-only consent, security, billing, quality, and audit records without shopper image content. Brand garment assets and confirmed product mappings are retained while the brand account uses DrapixAI so approved try-on caches can operate. Shopper photos and generated previews are never used for model training.',
          ],
        },
        {
          heading: 'Optional Analytics and External Media',
          body: [
            'Optional website analytics is off until you choose Accept analytics. It records a random browser identifier, public page names and a limited set of interaction labels; it does not need your account email, full referring URL, page title, form contents or photo. Private workspace and authentication pages are excluded from this website analytics path.',
            'Use Cookie preferences to reject or withdraw optional analytics without losing core service access. Withdrawal stops subsequent events and removes the browser identifier when storage is writable; it does not automatically erase earlier server records. Read /cookies for storage names, durations and choices.',
            'An external demo video connects to its displayed provider only after you choose Load external video. That provider receives connection data such as your IP address and browser details and may use its own storage. Loading a video is optional and separate from analytics consent.',
          ],
        },
        {
          heading: 'Third-Party Services',
          body: [
            'Service delivery may involve hosting, database, storage, email, authentication and payment providers. If you choose Google sign-in, Google processes that sign-in. If a merchant enables Shopify or hosted billing, those services process the relevant store or payment information. A software integration alone does not mean a provider receives every category of your data.',
            'The production provider list, processing countries and any required contractual transfer safeguards must be confirmed for a commercial deployment. Request the applicable processing terms and recipient details before sharing production customer data; this page does not claim a completed vendor or international-transfer review.',
          ],
        },
        {
          heading: 'Your Rights and Contact',
          body: [
            'Depending on your location, you may have rights to access, correct, delete, or restrict certain personal information. You may also have the right to object to certain processing or request a copy of your data.',
            'For access, correction, deletion, withdrawal or a privacy grievance, contact privacy@drapixai.com with a brief description and an account reference only if needed. We may need proportionate identity or merchant-authority checks; do not send a photo ID or shopper image by default. Financial, security or legal obligations may limit erasure and should be explained in the response.',
            'For a try-on embedded in a merchant store, contact that merchant as well: it controls its storefront and may hold separate records. Legal operator and business-contact information is published on /contact as it is confirmed. Support requests can be sent to support@drapixai.com.',
          ],
        },
      ]}
    />
  );
}
