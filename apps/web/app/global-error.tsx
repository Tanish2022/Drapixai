'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main>
    <h1>We could not load this page</h1>
    <p>The page encountered a problem. Try loading it again, or check service status.</p>
    <button type="button" onClick={reset}>Try loading again</button>
    <p><a href="/status">Check service status</a></p>
    <p><a href="/contact">Contact support</a></p>
  </main></body></html>;
}
