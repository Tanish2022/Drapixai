import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Code2, Shield, Sparkles, Upload, Wrench, Video } from 'lucide-react';
import { getSdkScriptUrl, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Quick-start documentation for integrating DrapixAI into a storefront.',
};

export default function DocsPage() {
  const sdkScriptUrl = getSdkScriptUrl();

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[700px] bg-gradient-glow opacity-40" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">
        <div className="flex items-center justify-between gap-6 flex-wrap mb-12">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">DrapixAI Docs</p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Integrate virtual try-on without rebuilding your storefront.</h1>
            <p className="text-lg text-gray-300 max-w-3xl leading-8">
              This is the launch-ready quick-start guide for brands evaluating DrapixAI. It covers account setup, garment caching, the SDK embed, and the safest production path.
            </p>
          </div>
          <Link href="/auth/register" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 font-semibold hover:opacity-90 transition-opacity">
            Start Free Trial
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {[
            { icon: Sparkles, title: '1. Upload garments', body: 'Cache each approved garment once, then reuse it across product pages for faster try-ons.' },
            { icon: Code2, title: '2. Embed the SDK', body: 'Drop in the SDK script, point it at your product identifier, and initialize the widget in a container.' },
            { icon: Shield, title: '3. Lock your domain', body: 'Each API key is limited to a validated storefront domain for production safety.' },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-sm p-6">
              <item.icon className="w-8 h-8 text-cyan-400 mb-4" />
              <h2 className="text-xl font-semibold mb-3">{item.title}</h2>
              <p className="text-gray-300 leading-7">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-10 mb-10">
          <h2 className="text-2xl font-semibold mb-4">Quick Start</h2>
          <p className="text-gray-300 mb-6">Use an API key from the dashboard, upload a garment with the same `productId`, and initialize the widget on your product page.</p>
          <pre className="overflow-x-auto rounded-2xl bg-black/30 border border-white/[0.08] p-5 text-sm text-gray-200">
{`<script src="${sdkScriptUrl}"></script>
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: 'your-api-key',
    productId: 'sku-12345',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`}
          </pre>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Production Checklist</h2>
            <div className="space-y-3">
              {[
                'Create an account and copy your API key from the dashboard.',
                'Upload each garment once through the garment cache workflow.',
                'Verify your production domain using the domain lock section.',
                'Point the API at the live AI host and confirm /ready succeeds.',
                'Run one real try-on before exposing the feature publicly.',
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
                  <p className="text-gray-300 leading-7">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Available Endpoints</h2>
            <div className="space-y-4 text-sm text-gray-300">
              <div>
                <p className="font-mono text-cyan-300">POST /auth/register</p>
                <p>Create a user, issue an API key, and start the 12-day trial.</p>
              </div>
              <div>
                <p className="font-mono text-cyan-300">POST /sdk/garments</p>
                <p>Upload and preprocess a garment so it can be reused during try-on.</p>
              </div>
              <div>
                <p className="font-mono text-cyan-300">POST /sdk/validate</p>
                <p>Validate an API key and bind it to the storefront domain.</p>
              </div>
              <div>
                <p className="font-mono text-cyan-300">POST /sdk/tryon</p>
                <p>Generate an upper-body try-on image using a cached garment.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <div className="flex items-center gap-3 mb-4">
              <Upload className="w-6 h-6 text-cyan-400" />
              <h2 className="text-2xl font-semibold">Garment Onboarding</h2>
            </div>
            <div className="space-y-3 text-gray-300">
              <p>Use one front-facing garment image per product ID. The first upload preprocesses the garment and stores a cache key for future try-ons.</p>
              <p>Upper-body garments are the supported launch scope. Keep the garment centered on a clean background for better outputs.</p>
              <p>For catalog imports, sync product IDs first, then upload only the missing garments shown in the dashboard.</p>
            </div>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <div className="flex items-center gap-3 mb-4">
              <Wrench className="w-6 h-6 text-cyan-400" />
              <h2 className="text-2xl font-semibold">Troubleshooting</h2>
            </div>
            <div className="space-y-3 text-gray-300">
              <p>If `/sdk/validate` fails, check the authorized domain in the dashboard and verify the API key is from the same account.</p>
              <p>If `/sdk/garments` fails, confirm the AI host is reachable and the S3/storage settings are valid for both API and AI services.</p>
              <p>If `/sdk/tryon` fails, verify one garment is already cached, the AI service is healthy, and Redis is reachable from both API and worker processes.</p>
            </div>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <div className="flex items-center gap-3 mb-4">
              <Video className="w-6 h-6 text-cyan-400" />
              <h2 className="text-2xl font-semibold">Evaluation Flow</h2>
            </div>
            <div className="space-y-3 text-gray-300">
              <p>Start with the public demo if you need a low-friction proof of output quality. It is intentionally rate limited to a few tries per IP.</p>
              <p>Move to a free trial when you want garment caching, domain binding, analytics, and SDK integration against your own storefront.</p>
              <p>For serious rollout testing, finish a live staging pass with the Runpod A100 AI service before exposing the feature on a production storefront.</p>
            </div>
          </section>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 md:p-10 mb-10">
          <h2 className="text-2xl font-semibold mb-4">Frequently Asked Questions</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-gray-300">
            <div>
              <h3 className="font-semibold text-white mb-2">How many free tests should a prospect get?</h3>
              <p>The public demo is intentionally limited to a few tries per IP so genuine evaluators can test output quality without opening the platform to abuse.</p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">Do customers need to upload the same garment every time?</h3>
              <p>No. The intended production flow is to preprocess the garment once, store the cache key, and reuse it for subsequent try-ons tied to that product.</p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">Is DrapixAI ready for full public scale today?</h3>
              <p>Not until the A100 staging pass completes and one full end-to-end try-on succeeds on the live Linux GPU stack.</p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-2">What should prospects prepare before integrating?</h3>
              <p>A small garment set, a staging domain, and one storefront page where they can test the SDK against a real product detail flow.</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 p-8">
          <h2 className="text-2xl font-semibold mb-3">Need to test before integrating?</h2>
          <p className="text-gray-200 mb-5">Use the public demo to run a few sample try-ons before committing engineering time to the SDK integration.</p>
          <Link href="/demo" className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-cyan-400/30 hover:bg-white/[0.05] transition-colors">
            Open Live Demo
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}
