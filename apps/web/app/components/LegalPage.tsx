import Link from 'next/link';

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
  updatedLabel = 'Last updated: March 28, 2026',
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[700px] bg-gradient-glow opacity-40" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-20" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-20">
        <div className="mb-10">
          <Link href="/" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
            Back to DrapixAI
          </Link>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-12 shadow-[0_0_60px_rgba(8,145,178,0.08)]">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">{eyebrow}</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{title}</h1>
          <p className="text-base md:text-lg text-gray-300 leading-8 max-w-3xl">{summary}</p>
          <p className="mt-6 text-sm text-gray-500">{updatedLabel}</p>

          <div className="mt-12 space-y-10">
            {sections.map((section) => (
              <section key={section.heading} className="border-t border-white/[0.06] pt-8">
                <h2 className="text-2xl font-semibold mb-4">{section.heading}</h2>
                <div className="space-y-4">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-gray-300 leading-8">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
