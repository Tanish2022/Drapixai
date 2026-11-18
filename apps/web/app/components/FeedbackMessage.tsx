'use client';

import { useCallback, useRef, useState } from 'react';
import { userError, type Feedback, type FeedbackTone } from '@/app/lib/user-feedback';

export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const notify = useCallback((message: string, tone: FeedbackTone = 'info') => setFeedback(message ? { message, tone } : null), []);
  const dismiss = useCallback(() => setFeedback(null), []);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await action(); }
    catch (error) { notify(userError(error), 'error'); }
    finally { running.current = false; setBusy(false); }
  }, [notify]);
  return { feedback, notify, dismiss, run, busy };
}

export default function FeedbackMessage({ feedback, onDismiss, id }: { feedback: Feedback; onDismiss?: () => void; id?: string }) {
  const tone = feedback?.tone || 'info';
  return <div id={id} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
    {feedback && <div className={`my-4 flex items-start justify-between gap-4 border p-4 text-sm leading-6 ${tone === 'error' ? 'border-[#b66d66] bg-[#fbefed] text-[#752b25]' : tone === 'success' ? 'border-[#7b9e89] bg-[#e8f2ec] text-[#183f32]' : 'border-[#a4b1a8] bg-[#f0f3ef] text-[#34483b]'}`}>
      <p>{feedback.message}</p>
      {onDismiss && <button type="button" className="min-h-10 shrink-0 px-2 font-bold underline" onClick={onDismiss}>Dismiss message</button>}
    </div>}
  </div>;
}

export function LoadFailure({ title, message }: { title: string; message: string }) {
  return <main className="min-h-screen bg-[#f4f6f2] px-5 py-16 text-[#172019]">
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-serif text-3xl">{title}</h1>
      <FeedbackMessage feedback={{ message, tone: 'error' }} />
      <button type="button" onClick={() => window.location.reload()} className="min-h-12 bg-[#183f32] px-5 py-3 font-bold text-white">Try loading again</button>
      <p><a href="/status" className="inline-flex min-h-11 items-center underline">Check service status</a></p>
      <p><a href="/contact" className="inline-flex min-h-11 items-center underline">Contact support</a></p>
    </div>
  </main>;
}
