'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, Play, Sparkles, Video } from 'lucide-react';
import { DEMO_VIDEO_URL, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import { trackEvent } from '@/app/lib/analytics';

const isEmbeddableVideo = (value: string) => value.includes('youtube.com/embed/') || value.includes('player.vimeo.com/video/');

export default function DemoClient() {
  const [personImage, setPersonImage] = useState<File | null>(null);
  const [clothImage, setClothImage] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runDemo = async () => {
    if (!personImage || !clothImage) {
      setStatus('Upload both a person image and a garment image.');
      return;
    }

    setIsSubmitting(true);
    setStatus('Generating try-on...');
    setResultUrl('');
    trackEvent('cta_click', { metadata: { target: 'demo_run_tryon' } });

    try {
      const form = new FormData();
      form.append('person_image', personImage);
      form.append('cloth_image', clothImage);

      const response = await fetch(`${PUBLIC_API_BASE_URL}/demo/tryon`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setStatus('Demo limit reached for this IP. Try again later or create a trial account.');
          return;
        }
        setStatus(data?.error || 'Demo try-on failed.');
        return;
      }

      const blob = await response.blob();
      setResultUrl(URL.createObjectURL(blob));
      setStatus('Demo try-on complete.');
      trackEvent('cta_click', { metadata: { target: 'demo_result_generated' } });
    } catch {
      setStatus('Demo try-on failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[700px] bg-gradient-glow opacity-40" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-blue-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-cyan-400/80 mb-4">Live Demo</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Try DrapixAI before signing up.</h1>
          <p className="text-lg text-gray-300 leading-8">
            This public demo allows a small number of free upper-body try-ons so brands can verify image quality and flow before creating an account.
          </p>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Video className="w-6 h-6 text-cyan-400" />
            <h2 className="text-2xl font-semibold">See the demo flow first</h2>
          </div>
          {DEMO_VIDEO_URL ? (
            isEmbeddableVideo(DEMO_VIDEO_URL) ? (
              <div className="aspect-video overflow-hidden rounded-2xl border border-white/[0.08] bg-black/30">
                <iframe
                  src={DEMO_VIDEO_URL}
                  title="DrapixAI demo walkthrough"
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <video
                src={DEMO_VIDEO_URL}
                controls
                className="w-full rounded-2xl border border-white/[0.08] bg-black/30"
              />
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.12] bg-black/20 p-8 text-gray-300">
              Add `NEXT_PUBLIC_DEMO_VIDEO_URL` in the web production env to show a hosted MP4 or an embeddable YouTube/Vimeo video here. Until then, this section acts as the reserved walkthrough slot for prospects.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <div className="flex items-center gap-3 mb-5">
              <Sparkles className="w-6 h-6 text-cyan-400" />
              <h2 className="text-2xl font-semibold">Run 2-3 free tests</h2>
            </div>
            <p className="text-gray-300 mb-6">
              Upload one front-facing person image and one garment image. The demo is rate limited to prevent abuse, so use it for genuine evaluation only.
            </p>

            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 mb-6 text-sm text-gray-300">
              <p className="font-semibold text-white mb-2">Recommended test images</p>
              <p>Use a clear front-facing person photo and a single-garment image on a plain background. If you want instant testing later, upload sample assets into `apps/web/public/demo/` and update this page to preload them.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Person image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setPersonImage(event.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm text-gray-300"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Garment image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setClothImage(event.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm text-gray-300"
                />
              </div>

              <button
                type="button"
                onClick={runDemo}
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                {isSubmitting ? 'Running demo...' : 'Run Free Try-On'}
              </button>

              {status && <p className="text-sm text-gray-300">{status}</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-white/[0.08] bg-[#0b1120]/70 backdrop-blur-xl p-8">
            <h2 className="text-2xl font-semibold mb-5">Result</h2>
            {resultUrl ? (
              <img src={resultUrl} alt="DrapixAI demo result" className="w-full rounded-2xl border border-white/[0.08] bg-black/20" />
            ) : (
              <div className="h-[420px] rounded-2xl border border-dashed border-white/[0.12] bg-black/20 flex items-center justify-center text-center px-8 text-gray-400">
                Your demo output will appear here after the AI service processes the request.
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-white/[0.08]">
              <p className="text-sm text-gray-300 mb-4">
                Need more than a few tests? Create a trial account to access garment caching, analytics, the SDK, and higher try-on limits.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/auth/register" onClick={() => trackEvent('cta_click', { metadata: { target: 'demo_start_trial' } })} className="px-4 py-2 rounded-xl border border-cyan-400/30 hover:bg-white/[0.05] transition-colors">
                  Start Free Trial
                </Link>
                <Link href="/docs" onClick={() => trackEvent('cta_click', { metadata: { target: 'demo_read_docs' } })} className="px-4 py-2 rounded-xl border border-white/[0.12] hover:bg-white/[0.05] transition-colors">
                  Read Docs
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
