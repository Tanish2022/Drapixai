'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Download, ImageIcon, Loader2, Play, ShieldCheck, Video } from 'lucide-react';
import MarketingFooter from '@/app/components/MarketingFooter';
import MarketingNav from '@/app/components/MarketingNav';
import { DEMO_VIDEO_URL, PUBLIC_API_BASE_URL } from '@/app/lib/public-env';
import { trackEvent } from '@/app/lib/analytics';

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const walkthroughSteps = [
  { icon: ImageIcon, title: 'Validate inputs', body: 'JPEG, PNG, or WebP person and garment images are checked before generation.' },
  { icon: ShieldCheck, title: 'Protect quality', body: 'Standard generation keeps the launch quality path consistent for every evaluation.' },
  { icon: Check, title: 'Review the result', body: 'Download the output or continue to a trial workspace for product certification.' },
];

type DemoVideoKind = 'embed' | 'video' | null;

const getDemoVideoKind = (value: string): DemoVideoKind => {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return null;

    const host = parsed.hostname.toLowerCase();
    const isYouTube = ['youtube.com', 'www.youtube.com', 'www.youtube-nocookie.com'].includes(host)
      && parsed.pathname.startsWith('/embed/');
    const isVimeo = host === 'player.vimeo.com' && parsed.pathname.startsWith('/video/');
    if (isYouTube || isVimeo) return 'embed';

    return /\.(mp4|webm)$/i.test(parsed.pathname) ? 'video' : null;
  } catch {
    return null;
  }
};

export default function DemoClient() {
  const [personImage, setPersonImage] = useState<File | null>(null);
  const [clothImage, setClothImage] = useState<File | null>(null);
  const [personPreviewUrl, setPersonPreviewUrl] = useState('');
  const [clothPreviewUrl, setClothPreviewUrl] = useState('');
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const demoVideoKind = getDemoVideoKind(DEMO_VIDEO_URL);

  const selectImage = (
    file: File | null,
    label: 'person' | 'garment',
    setter: (value: File | null) => void
  ) => {
    if (file && !supportedImageTypes.has(file.type)) {
      setter(null);
      setStatus(`Use a JPEG, PNG, or WebP ${label} image.`);
      return;
    }

    setter(file);
    setStatus('');
  };

  useEffect(() => {
    if (!personImage) {
      setPersonPreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(personImage);
    setPersonPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [personImage]);

  useEffect(() => {
    if (!clothImage) {
      setClothPreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(clothImage);
    setClothPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [clothImage]);

  const runDemo = async () => {
    if (!personImage || !clothImage) {
      setStatus('Upload both a person image and a garment image.');
      return;
    }
    if (!hasConsent) {
      setStatus('Confirm transient photo processing before running the demo.');
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
      form.append('shopper_consent', 'true');
      form.append('privacy_policy_version', '2026-08-04');

      const response = await fetch(`${PUBLIC_API_BASE_URL}/demo/tryon`, { method: 'POST', body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setStatus('Demo limit reached for this IP. Try again later or create a trial account.');
          return;
        }
        setStatus(data?.message || data?.error || 'Demo try-on failed.');
        return;
      }

      const blob = await response.blob();
      const nextResultUrl = URL.createObjectURL(blob);
      setResultUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return nextResultUrl;
      });
      setStatus('Demo try-on complete.');
      trackEvent('cta_click', { metadata: { target: 'demo_result_generated' } });
    } catch {
      setStatus('Demo try-on failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  const statusTone = status.toLowerCase().includes('complete')
    ? 'border-[#93b4a3] bg-[#e8f2ec] text-[#183f32]'
    : status.toLowerCase().includes('failed') || status.toLowerCase().includes('limit') || status.toLowerCase().includes('upload')
      ? 'border-[#d6a29c] bg-[#fbefed] text-[#7c2d27]'
      : 'border-[#b7c4ba] bg-[#f0f3ef] text-[#415047]';

  return (
    <main className="min-h-screen bg-[#fbfcf9] text-[#172019]">
      <MarketingNav active="demo" />

      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase text-[#31725b]">Public evaluation</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.02] text-[#101712] sm:text-6xl">Judge the garment, not the claim.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5b665e]">
              Run a small number of real upper-body try-ons before creating a workspace. The public demo follows the same Standard quality path used by the storefront SDK.
            </p>
            <a href="#live-demo-form" className="mt-8 inline-flex h-12 items-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48]">
              Run a test <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <ol className="border-t border-black/10">
            {['Upload a clear front-facing person', 'Add one garment-only product image', 'Review the Standard-quality result'].map((label, index) => (
              <li key={label} className="grid grid-cols-[3rem_1fr] border-b border-black/10 py-5 text-sm">
                <span className="font-bold text-[#8d9890]">0{index + 1}</span>
                <span className="font-semibold">{label}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8 lg:px-12">
        <div className="grid gap-10 border-b border-black/10 pb-14 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <Video className="h-5 w-5 text-[#31725b]" />
            <h2 className="mt-5 text-2xl font-semibold">The controlled demo flow</h2>
            <p className="mt-3 leading-7 text-[#68736b]">Inputs are validated first. Generation only runs through the launch Standard path, then the result is returned for your own inspection.</p>
          </div>
          {demoVideoKind ? (
            demoVideoKind === 'embed' ? (
              <div className="aspect-video overflow-hidden border border-black/10 bg-[#101712]">
                <iframe src={DEMO_VIDEO_URL} title="DrapixAI demo walkthrough" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            ) : (
              <video src={DEMO_VIDEO_URL} controls className="w-full border border-black/10 bg-[#101712]" />
            )
          ) : (
            <div className="grid border-y border-black/10 md:grid-cols-3 md:divide-x md:divide-black/10">
              {walkthroughSteps.map(({ icon: Icon, title, body }) => (
                <div key={title} className="border-b border-black/10 py-6 last:border-b-0 md:border-b-0 md:px-6 md:first:pl-0 md:last:pr-0">
                  <Icon className="h-5 w-5 text-[#31725b]" />
                  <h3 className="mt-5 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#68736b]">{body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="live-demo-form" className="scroll-mt-8 bg-[#eaf0e9]">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="px-5 py-14 sm:px-8 lg:border-r lg:border-black/10 lg:px-12 lg:py-16">
            <p className="text-xs font-bold uppercase text-[#31725b]">Input</p>
            <h2 className="mt-4 font-serif text-4xl">Run 2-3 free tests</h2>
            <p className="mt-4 max-w-xl leading-7 text-[#5d6961]">Use a clear front-facing person and a garment-only product image on a plain background. A model already wearing the garment is rejected because it weakens garment fidelity.</p>

            <div className="mt-8 space-y-7">
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Person image</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0] || null, 'person', setPersonImage)} className="block min-w-0 max-w-full border border-black/15 bg-white p-3 text-sm file:mr-4 file:border-0 file:bg-[#e3e9e3] file:px-4 file:py-2 file:font-semibold" />
                {personPreviewUrl ? <img src={personPreviewUrl} alt="Person preview" className="mt-3 h-52 w-full border border-black/10 bg-white object-contain" /> : null}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-bold">Garment image</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0] || null, 'garment', setClothImage)} className="block min-w-0 max-w-full border border-black/15 bg-white p-3 text-sm file:mr-4 file:border-0 file:bg-[#e3e9e3] file:px-4 file:py-2 file:font-semibold" />
                {clothPreviewUrl ? <img src={clothPreviewUrl} alt="Garment preview" className="mt-3 h-52 w-full border border-black/10 bg-white object-contain" /> : null}
              </label>

              <label className="flex items-start gap-3 border-y border-black/10 py-4 text-sm leading-6 text-[#4f5d54]">
                <input
                  type="checkbox"
                  checked={hasConsent}
                  onChange={(event) => setHasConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#183f32]"
                />
                <span>
                  I confirm I have permission to upload this person photo. It is processed transiently, is not persistently stored, and is never used to train AI models.
                </span>
              </label>

              <button type="button" onClick={runDemo} disabled={isSubmitting || !hasConsent} className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#183f32] px-5 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                {isSubmitting ? 'Running demo...' : 'Run Free Try-On'}
              </button>

              {status ? <div role="status" className={`border p-4 text-sm ${statusTone}`}>{status}</div> : null}
            </div>
          </div>

          <div className="bg-white px-5 py-14 sm:px-8 lg:px-12 lg:py-16">
            <div className="flex items-center justify-between border-b border-black/10 pb-4">
              <div><p className="text-xs font-bold uppercase text-[#31725b]">Output</p><h2 className="mt-2 text-2xl font-semibold">Try-on result</h2></div>
              <span className="text-xs font-semibold text-[#78837b]">Standard</span>
            </div>
            {resultUrl ? (
              <img src={resultUrl} alt="DrapixAI demo result" className="mt-6 aspect-[3/4] w-full border border-black/10 bg-[#f4f5f2] object-contain" />
            ) : (
              <div className="mt-6 flex aspect-[3/4] w-full items-center justify-center border border-dashed border-black/20 bg-[#f4f5f2] px-8 text-center text-sm leading-6 text-[#768179]">Your output will appear here after the AI service accepts and processes both images.</div>
            )}

            <div className="mt-6 border-t border-black/10 pt-6">
              {resultUrl ? (
                <a href={resultUrl} download="drapixai-demo-result.png" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#183f32] hover:text-[#31725b]"><Download className="h-4 w-4" /> Download result</a>
              ) : null}
              <p className="text-sm leading-6 text-[#68736b]">Need production testing? A trial workspace adds garment caching, analytics, product mapping, and storefront installation.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/auth/register" onClick={() => trackEvent('cta_click', { metadata: { target: 'demo_start_trial' } })} className="inline-flex h-11 items-center bg-[#183f32] px-4 text-sm font-bold text-white hover:bg-[#245a48]">Start free trial</Link>
                <Link href="/help" onClick={() => trackEvent('cta_click', { metadata: { target: 'demo_read_help' } })} className="inline-flex h-11 items-center border border-black/15 px-4 text-sm font-bold hover:bg-[#f1f4f0]">Open help</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
