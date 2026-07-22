export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f2] px-5 text-[#172019]">
      <div className="w-full max-w-xl border-y border-black/15 py-10 text-center" role="status" aria-live="polite">
        <div className="mx-auto h-2 w-24 overflow-hidden bg-[#dce5de]">
          <div className="h-full w-1/2 animate-pulse bg-[#31725b]" />
        </div>
        <p className="mt-7 text-xs font-bold uppercase text-[#31725b]">DrapixAI</p>
        <h1 className="mt-3 font-serif text-3xl">Preparing the next view</h1>
        <p className="mt-3 text-sm text-[#68736b]">Loading current workspace information.</p>
      </div>
    </main>
  );
}
