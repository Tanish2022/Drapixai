import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Cookie and Data Usage Notice',
  description: 'Session storage, optional website analytics, external video, and controls for your choices.',
};

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookie and Data Usage"
      title="Cookie and Data Usage Notice"
      summary="This notice describes the website's session storage, appearance preference, optional analytics, and external demo video controls. You can reopen Cookie preferences at any time."
      updatedLabel="Cookie controls reviewed: October 18, 2026"
      sections={[
        {
          heading: 'Essential Cookies and Session Data',
          body: [
            'DrapixAI uses essential cookies or similar mechanisms to keep users signed in, protect accounts, maintain secure sessions, and support core application functions.',
            'Disabling essential cookies may prevent portions of the website, dashboard, or authentication flow from functioning correctly.',
            'The dashboard session cookie is named drapixai_dashboard_session and has a maximum age of seven days. The admin session cookie is named drapixai_admin_session and has a maximum age of eight hours. Sign-in flows may also use NextAuth session, callback, CSRF, or provider-state cookies.',
          ],
        },
        {
          heading: 'Appearance and Choice Storage',
          body: [
            'The drapixai-theme browser local-storage entry remembers the appearance preference. It has no automatic expiry in the website code and can be cleared through browser settings.',
            'The drapixaiPrivacyPreferences local-storage entry remembers your analytics choice for up to 180 days. It contains a preference version, an analytics choice, and timestamps; it does not add a separate visitor or account identifier.',
          ],
        },
        {
          heading: 'Optional Website Analytics',
          body: [
            'Website page-view and click analytics remains off until you accept it. If accepted, drapixaiVisitorId in local storage identifies this browser for those events on public pages. Private workspace and authentication routes are excluded. The identifier is removed when a choice expires or is withdrawn and the website next checks it, when storage is writable. Public page names and limited interaction labels are sent without the page title, query string, referring page address, form fields or account identifier.',
            'Reject optional leaves this analytics off. You can select Customize to choose analytics separately. Necessary sign-in, security, and records needed to provide a requested try-on continue independently of this optional choice.',
          ],
        },
        {
          heading: 'External Demo Video',
          body: [
            'A configured external demo video is not loaded until you choose Load external video. The control identifies the provider hostname before loading. Loading connects your browser to that provider, which receives connection information such as your IP address and browser details and may use its own storage.',
            'The video load choice applies to the current page visit. You can use the website and try-on demo without loading that video.',
          ],
        },
        {
          heading: 'Managing Preferences',
          body: [
            'Open Cookie preferences to change or withdraw your analytics choice. Reject optional stops subsequent website analytics events and removes this browser\'s visitor ID when browser storage is writable. Withdrawal does not automatically delete earlier server records or data already received by another provider.',
            'You may also clear or restrict storage in browser settings. If the website cannot save your choice, optional analytics stays off on the current page and the website may ask again on another visit. Blocking necessary cookies can affect authentication and core features.',
            'For privacy questions or requests concerning earlier records, contact contact@drapixai.com. See the Privacy Policy for information about service processing.',
          ],
        },
      ]}
    />
  );
}
