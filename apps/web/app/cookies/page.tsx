import type { Metadata } from 'next';
import LegalPage from '@/app/components/LegalPage';

export const metadata: Metadata = {
  title: 'Cookie and Data Usage Notice',
  description: 'Basic notice explaining session, security, and analytics-related cookies and usage data.',
};

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookie and Data Usage"
      title="Cookie and Data Usage Notice"
      summary="This notice explains the categories of cookies and related usage data DrapixAI uses to keep the site secure, maintain sessions, and improve reliability. We do not describe this page as a substitute for your own legal advice."
      sections={[
        {
          heading: 'Essential Cookies and Session Data',
          body: [
            'DrapixAI uses essential cookies or similar mechanisms to keep users signed in, protect accounts, maintain secure sessions, and support core application functions.',
            'Disabling essential cookies may prevent portions of the website, dashboard, or authentication flow from functioning correctly.',
          ],
        },
        {
          heading: 'Performance and Product Usage Data',
          body: [
            'We may collect limited technical and usage data such as browser type, device information, request timing, error logs, and feature usage in order to improve reliability, security, and product performance.',
            'DrapixAI is not positioned as an ad-tech product. If we add third-party analytics or marketing tracking, this notice should continue to identify those tools clearly together with any consent requirements that apply.',
          ],
        },
        {
          heading: 'Managing Preferences',
          body: [
            'Users may control some cookie behavior through browser settings or future consent tools added to the DrapixAI website. Blocking all cookies can affect authentication, security, and core product features.',
            'For questions about data usage or future cookie preferences, contact support@drapixai.com.',
          ],
        },
      ]}
    />
  );
}
