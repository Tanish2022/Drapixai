import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';

type LegalSection = {
  heading: string;
  body: string[];
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  summary: string;
  sections: LegalSection[];
  updatedLabel?: string;
};

export default function LegalPage({
  eyebrow,
  title,
  summary,
  sections,
  updatedLabel = 'Last updated: July 16, 2026',
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav />
      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:px-12">
          <div>
            <p className="text-xs font-bold uppercase text-[#31725b]">{eyebrow}</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.02] text-[#101712] sm:text-6xl">{title}</h1>
          </div>
          <div className="border-l border-black/10 lg:pl-10">
            <p className="max-w-3xl text-lg leading-8 text-[#5d6961]">{summary}</p>
            <p className="mt-7 text-xs font-semibold uppercase text-[#8a958d]">{updatedLabel}</p>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-12">
        <aside className="self-start border-t border-black/10 pt-5 lg:sticky lg:top-6">
          <p className="text-xs font-bold uppercase text-[#748078]">On this page</p>
          <nav className="mt-4 space-y-1" aria-label={`${title} sections`}>
            {sections.map((section, index) => (
              <a key={section.heading} href={`#legal-section-${index + 1}`} className="block border-l-2 border-transparent px-3 py-2 text-sm text-[#5d6961] hover:border-[#31725b] hover:bg-[#edf2ed] hover:text-[#172019]">{section.heading}</a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0">
          {sections.map((section, index) => (
            <section id={`legal-section-${index + 1}`} key={section.heading} className="scroll-mt-6 border-t border-black/10 py-10 first:pt-0 first:border-t-0 md:py-14">
              <div className="grid gap-5 md:grid-cols-[4rem_1fr]">
                <span className="text-sm font-bold text-[#9aa39c]">0{index + 1}</span>
                <div>
                  <h2 className="text-2xl font-semibold">{section.heading}</h2>
                  <div className="mt-5 space-y-5">
                    {section.body.map((paragraph) => <p key={paragraph} className="max-w-3xl leading-8 text-[#5d6961]">{paragraph}</p>)}
                  </div>
                </div>
              </div>
            </section>
          ))}
        </article>
      </div>
      <MarketingFooter />
    </main>
  );
}
