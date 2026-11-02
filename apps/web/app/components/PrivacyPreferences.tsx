'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  clearAnalyticsIdentifier, PRIVACY_CHANGE_EVENT, readPrivacyPreferences, savePrivacyPreferences,
} from '@/app/lib/privacy-preferences';

const choiceClass = 'min-h-11 border border-[#183f32] bg-white px-4 py-2 text-sm font-semibold text-[#183f32] hover:bg-[#edf3ee]';

export default function PrivacyPreferences() {
  const [visible, setVisible] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [status, setStatus] = useState('');
  const [openRequest, setOpenRequest] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!openRequest) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [openRequest]);

  useEffect(() => {
    const sync = () => {
      const preferences = readPrivacyPreferences();
      if (!preferences?.analytics) clearAnalyticsIdentifier();
      setAnalytics(preferences?.analytics === true);
      setVisible(!preferences);
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(PRIVACY_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(PRIVACY_CHANGE_EVENT, sync);
    };
  }, []);

  const save = (allowAnalytics: boolean) => {
    const saved = savePrivacyPreferences(allowAnalytics);
    setVisible(false);
    setCustomize(false);
    triggerRef.current?.focus();
    setStatus(saved ? 'Cookie preferences saved.' : 'Preferences could not be saved in this browser. Optional analytics remains off.');
  };

  return <>
    <button ref={triggerRef} type="button" onClick={() => {
      setAnalytics(readPrivacyPreferences()?.analytics === true);
      setCustomize(true); setVisible(true); setStatus('');
      setOpenRequest((request) => request + 1);
    }} className="relative mx-5 my-3 inline-flex min-h-11 items-center border border-[#183f32] bg-[#fbfcf9] px-3 py-2 text-sm font-semibold text-[#183f32] shadow-sm sm:fixed sm:bottom-3 sm:left-3 sm:z-[60] sm:m-0">
      Cookie preferences
    </button>
    {visible ? <section aria-labelledby="privacy-preferences-heading" className="relative z-[80] border-b border-[#183f32] bg-[#fbfcf9] p-5 text-[#172019] sm:px-8 lg:px-12">
      <h2 ref={headingRef} tabIndex={-1} id="privacy-preferences-heading" className="text-lg font-semibold">Your privacy choices</h2>
      <p className="mt-3 text-sm leading-6">Necessary session and security storage keeps the service working. Optional website analytics uses a visitor ID to measure page views and clicks. It stays off until you accept. You can change your choice here at any time.</p>
      <Link href="/cookies" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline">Read the cookie notice</Link>
      {customize ? <fieldset className="my-3 border border-[#65786b] p-3">
        <legend className="px-1 font-semibold">Optional storage</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} className="h-5 w-5 accent-[#183f32]" />Website analytics</label>
        <p className="text-sm leading-6">Necessary storage is always active. External demo video loads only when you choose to load it.</p>
      </fieldset> : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => save(false)} className={choiceClass}>Reject optional</button>
        <button type="button" onClick={() => save(true)} className={choiceClass}>Accept analytics</button>
        {customize ? <button type="button" onClick={() => save(analytics)} className={choiceClass}>Save choices</button> : <button type="button" onClick={() => setCustomize(true)} className={choiceClass}>Customize</button>}
      </div>
    </section> : null}
    <p role="status" className="sr-only">{status}</p>
  </>;
}
