import { headers } from 'next/headers';

export default async function StructuredData({ data }: { data: object }) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  // Even a later user-controlled value must not close this script element.
  return <script type="application/ld+json" nonce={nonce}
    dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
