'use client';

export default function SkipToContent() {
  return <a href="#main-content" className="sr-only z-[100] bg-white p-4 text-[#183f32] underline focus:fixed focus:left-3 focus:top-3 focus:h-auto focus:w-auto focus:overflow-visible focus:whitespace-normal focus:[clip:auto]" onClick={(event) => {
    const target = document.querySelector<HTMLElement>('main h1') || document.querySelector<HTMLElement>('main');
    if (!target) return;
    event.preventDefault();
    target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }}>Skip to main content</a>;
}
