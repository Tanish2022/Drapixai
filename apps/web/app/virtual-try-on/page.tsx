import Link from 'next/link';
import MarketingNav from '../components/MarketingNav';
import MarketingFooter from '../components/MarketingFooter';
import StructuredData from '../components/StructuredData';
import discoveryPolicy from '../lib/discovery-policy.cjs';

const questions = [
  { id: 'what-is-virtual-try-on', question: 'What is virtual try-on?', answer: 'Virtual try-on generates an image preview of a garment on a person. It helps a shopper explore appearance. It does not measure the body, predict an exact size or guarantee physical fit.' },
  { id: 'supported-garments', question: 'Which garments should a brand evaluate first?', answer: 'Start with eligible upper-body shirts, T-shirts, polos, blouses and clean tops. Each product needs review. A listed category does not mean every fabric, pattern, logo or garment is supported. Lower-body try-on is outside the current Standard launch scope.' },
  { id: 'shopify', question: 'How will a Shopify store connect?', answer: 'The planned Shopify flow connects an authorized store, reads its product catalog and lets the merchant review garment-to-product mappings. The development integration is being verified; a public Shopify App Store listing and a completed live installation are not yet available.' },
  { id: 'custom-store', question: 'Can a custom website integrate DrapixAI?', answer: 'The browser SDK and REST API are designed for custom storefronts. A backend issues short-lived, product-scoped tokens for the browser. Keep permanent API keys on your server. A merchant must prepare garments, confirm product mappings and verify the storefront domain before enabling a product.' },
  { id: 'garment-images', question: 'How should a brand prepare its garment images?', answer: 'Use clear, isolated garment images with permission to use them. Keep the entire garment visible and review the source image, product identity and generated preview together. Ask support to review difficult patterns, transparent fabrics, layering or model-worn source photos before assuming compatibility.' },
  { id: 'quality', question: 'Does a quality score guarantee an accurate result?', answer: 'No. Automated quality checks can reject detected defects, but a score is not a percentage accuracy guarantee. Review garment details, identity, pose and overall realism with people. Speed, quality under load, conversion improvement and fewer returns require measured evidence for the actual deployment.' },
  { id: 'photos', question: 'What should shoppers know before uploading a photo?', answer: 'Explain the purpose of the preview and obtain the required permission before processing a photo. Use only photos the person is authorized to submit. Review the privacy notice for data handling and deletion information; never place shopper photos or secret keys in analytics or support messages.' },
  { id: 'pilot', question: 'How can a small store prepare for a pilot?', answer: 'Choose a small set of eligible products, confirm rights to images, appoint a merchant contact and agree on feedback and stop criteria. DrapixAI is in pre-launch preparation. Public access and live pilots depend on launch approval; contact support to discuss readiness before sending images or connecting a live store.' },
] as const;

export default function MerchantGuide() {
  const origin = discoveryPolicy.PUBLIC_ORIGIN;
  return (
    <div className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
        <StructuredData data={{ '@context': 'https://schema.org', '@graph': [
          { '@type': 'WebPage', '@id': `${origin}/virtual-try-on#page`, url: `${origin}/virtual-try-on`,
            name: 'Virtual Try-On: Merchant Guide', inLanguage: 'en',
            description: 'A guide to upper-body garment evaluation, storefront integration and pilot preparation.',
            isPartOf: { '@id': `${origin}/#website` } },
          { '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'DrapixAI', item: origin },
            { '@type': 'ListItem', position: 2, name: 'Merchant guide', item: `${origin}/virtual-try-on` },
          ] },
        ] }} />
        <nav aria-label="Breadcrumb" className="text-sm text-[#344f40]">
          <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4">DrapixAI</Link>
          <span aria-hidden="true"> / </span><span aria-current="page">Merchant guide</span>
        </nav>
        <p className="mt-8 text-sm font-semibold text-[#31725b]">For Shopify and custom fashion stores</p>
        <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-6xl">Virtual try-on: a merchant guide</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#48594e]">DrapixAI is developing upper-body virtual try-on for fashion brands. This guide explains the intended workflow, its limits and the questions to resolve before a controlled rollout.</p>
        <p className="mt-4 text-sm text-[#48594e]">Prepared by DrapixAI · Updated <time dateTime="2026-10-29">29 October 2026</time></p>
        <nav aria-label="Guide questions" className="my-10 border-y border-black/15 py-6">
          <ul className="grid gap-1 sm:grid-cols-2">
            {questions.map(({ id, question }) => <li key={id}><a href={`#${id}`} className="inline-flex min-h-11 items-center py-2 text-sm font-semibold text-[#245b45] underline underline-offset-4">{question}</a></li>)}
          </ul>
        </nav>
        <article>
          {questions.map(({ id, question, answer }) => (
            <section id={id} key={id} className="border-b border-black/15 py-8">
              <h2 className="text-2xl font-semibold leading-snug">{question}</h2>
              <p className="mt-4 max-w-3xl leading-8 text-[#48594e]">{answer}</p>
              {id === 'custom-store' && <p className="mt-4"><Link href="/docs" className="inline-flex min-h-11 items-center font-semibold text-[#245b45] underline underline-offset-4">Read the developer quickstart</Link></p>}
              {id === 'photos' && <p className="mt-4"><Link href="/privacy" className="inline-flex min-h-11 items-center font-semibold text-[#245b45] underline underline-offset-4">Read the privacy policy</Link></p>}
            </section>
          ))}
        </article>
        <aside aria-label="Next steps" className="mt-10 border border-black/15 bg-[#f0f4ee] p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">Prepare your store evaluation</h2>
          <p className="mt-3 leading-7 text-[#48594e]">Tell us your storefront platform and the garment categories you want to evaluate. Keep passwords, keys and shopper photos out of the enquiry.</p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link href="/contact" className="inline-flex min-h-11 items-center bg-[#183f32] px-5 py-3 font-semibold text-white">Contact merchant support</Link>
            <Link href="/help" className="inline-flex min-h-11 items-center px-2 font-semibold text-[#245b45] underline underline-offset-4">Read setup guidance</Link>
            <Link href="/pricing" className="inline-flex min-h-11 items-center px-2 font-semibold text-[#245b45] underline underline-offset-4">Review plans and terms</Link>
          </div>
        </aside>
      </main>
      <MarketingFooter />
    </div>
  );
}
