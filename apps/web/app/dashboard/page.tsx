'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PUBLIC_API_BASE_URL, getSdkScriptUrl } from '@/app/lib/public-env';

interface UsageData {
  planType: string;
  planName: string;
  rendersUsed: number;
  quota: number;
  quotaRemaining: number;
  trialDaysLeft: number;
  domain?: string;
  dailyUsage?: { date: string; count: number }[];
}

interface GarmentItem {
  garmentId: string;
  cacheKey: string;
  status: string;
  updatedAt: string;
}

export default function Dashboard() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [garmentUploadId, setGarmentUploadId] = useState('');
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentStatus, setGarmentStatus] = useState('');
  const [missingPage, setMissingPage] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const storedApiKey = localStorage.getItem('apiKey');
    
    if (!storedApiKey) {
      router.push('/auth/login');
      return;
    }

    setApiKey(storedApiKey);

    fetch(`${PUBLIC_API_BASE_URL}/analytics/summary`, {
      headers: { 'Authorization': `Bearer ${storedApiKey}` },
    })
      .then(res => res.json())
      .then(data => setUsage(data))
      .catch(console.error);

    fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
      headers: { 'Authorization': `Bearer ${storedApiKey}` },
    })
      .then(res => res.json())
      .then(data => setGarments(data.items || []))
      .catch(() => setGarments([]));
  }, [router]);

  useEffect(() => {
    if (!apiKey || garments.length === 0) return;
    let active = true;
    const load = async () => {
      const next: Record<string, string> = {};
      for (const g of garments.slice(0, 6)) {
        try {
          const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments/${encodeURIComponent(g.garmentId)}/thumbnail`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!res.ok) continue;
          const blob = await res.blob();
          next[g.garmentId] = URL.createObjectURL(blob);
        } catch {
          // ignore
        }
      }
      if (active) setThumbs(next);
    };
    load();
    return () => {
      active = false;
    };
  }, [apiKey, garments]);

  useEffect(() => {
    if (!apiKey) return;
    const script = document.createElement('script');
    script.src = getSdkScriptUrl();
    script.async = true;
    script.onload = () => {
      if (window.DrapixAI) {
        window.DrapixAI.init({
          apiKey,
          productId: garments[0]?.garmentId || 'demo-product',
          containerId: 'drapixai-dashboard-demo',
          garmentType: 'upper'
        });
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [apiKey, garments]);

  const handleLogout = () => {
    localStorage.removeItem('apiKey');
    localStorage.removeItem('authToken');
    router.push('/');
  };

  if (!usage) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10 p-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            DrapixAI
          </Link>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {usage.planType === 'trial' && (
          <div className="p-4 mb-8 border border-cyan-500/30 bg-cyan-500/10 rounded-xl">
            <p className="text-sm text-cyan-200">
              Trial active: {usage.trialDaysLeft} day(s) left. You have {usage.quotaRemaining} try-ons remaining.
            </p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
  <div className="p-6 border border-white/10 rounded-xl">
    <p className="text-gray-400 text-sm">Plan</p>
    <p className="text-2xl font-bold capitalize">{usage.planName || usage.planType}</p>
  </div>
  <div className="p-6 border border-white/10 rounded-xl">
    <p className="text-gray-400 text-sm">Renders Used</p>
    <p className="text-2xl font-bold">{usage.rendersUsed} <span className="text-sm text-gray-400">/ {usage.quota}</span></p>
  </div>
  <div className="p-6 border border-white/10 rounded-xl">
    <p className="text-gray-400 text-sm">Quota Remaining</p>
    <p className="text-2xl font-bold">{usage.quotaRemaining}</p>
  </div>
  <div className="p-6 border border-white/10 rounded-xl">
    <p className="text-gray-400 text-sm">
      {usage.planType === 'trial' ? 'Trial Days Left' : 'Days Until Renewal'}
    </p>
    <p className="text-2xl font-bold">{usage.trialDaysLeft || 30}</p>
  </div>
</div>

        {/* API Key Section */}
        <div className="p-6 border border-white/10 rounded-xl mb-8">
          <h2 className="text-xl font-bold mb-4">Your API Key</h2>
          <div className="flex gap-4">
            <input
              type="text"
              value={apiKey}
              readOnly
              className="flex-1 p-3 bg-white/5 border border-white/10 rounded-lg font-mono text-sm"
            />
            <button
              onClick={() => navigator.clipboard.writeText(apiKey)}
              className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Domain Lock */}
        <div className="p-6 border border-white/10 rounded-xl mb-8">
          <h2 className="text-xl font-bold mb-4">Authorized Domain</h2>
          <p className="text-gray-400 mb-4">Each subscriber can use the SDK on a single domain. Set it once.</p>
          <div className="flex gap-4">
            <input
              type="text"
              defaultValue={usage.domain || ''}
              placeholder="yourbrand.com"
              className="flex-1 p-3 bg-white/5 border border-white/10 rounded-lg font-mono text-sm"
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (!value || !apiKey) return;
                const res = await fetch(`${PUBLIC_API_BASE_URL}/analytics/domain`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                  body: JSON.stringify({ domain: value })
                });
                if (res.ok) {
                  const data = await res.json();
                  setUsage((prev) => prev ? { ...prev, domain: data.domain } : prev);
                }
              }}
            />
          </div>
        </div>

        {/* Daily Usage */}
        <div className="p-6 border border-white/10 rounded-xl mb-8">
          <h2 className="text-xl font-bold mb-4">Daily Try-On Traffic</h2>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {(usage.dailyUsage || []).slice(-7).map((d) => (
              <div key={d.date} className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-gray-400">{d.date.slice(5)}</p>
                <p className="text-2xl font-bold">{d.count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Garments */}
        <div className="p-6 border border-white/10 rounded-xl mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Garment Cache</h2>
            {garments.some((g) => g.status === 'missing') && (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-200">
                Missing: {garments.filter((g) => g.status === 'missing').length}
              </span>
            )}
          </div>
          <p className="text-gray-400 mb-4">Preprocessed garments are cached and reused for faster, consistent try-ons.</p>
          <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
            <p className="text-sm text-gray-400 mb-3">Upload a garment (Product ID = garment ID)</p>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={garmentUploadId}
                onChange={(e) => setGarmentUploadId(e.target.value)}
                placeholder="product-id"
                className="flex-1 p-3 bg-white/5 border border-white/10 rounded-lg font-mono text-sm"
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setGarmentFile(e.target.files?.[0] || null)}
                className="p-2 text-sm text-gray-300"
              />
              <button
                onClick={async () => {
                  if (!apiKey || !garmentUploadId || !garmentFile) {
                    setGarmentStatus('Please provide product ID and image.');
                    return;
                  }
                  setGarmentStatus('Uploading...');
                  const form = new FormData();
                  form.append('garment_id', garmentUploadId);
                  form.append('cloth_image', garmentFile);
                  const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    body: form
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setGarmentStatus(data?.error || 'Upload failed.');
                    return;
                  }
                  setGarmentStatus('Uploaded and cached.');
                  setGarmentUploadId('');
                  setGarmentFile(null);
                  const list = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                  }).then(r => r.json()).catch(() => ({ items: [] }));
                  setGarments(list.items || []);
                }}
                className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
              >
                Upload
              </button>
            </div>
            {garmentStatus && <p className="text-xs text-gray-400 mt-2">{garmentStatus}</p>}
          </div>
          {garments.length === 0 ? (
            <p className="text-sm text-gray-400">No garments uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {garments.slice(0, 6).map((g) => (
                <div key={g.garmentId} className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <div className="mb-3">
                    <img
                      src={thumbs[g.garmentId] || ''}
                      alt={g.garmentId}
                      className="w-full h-40 object-contain bg-white/5 border border-white/10 rounded-md"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <p className="text-sm text-gray-400">Garment ID</p>
                  <p className="text-base font-mono">{g.garmentId}</p>
                  <p className="text-sm text-gray-400 mt-2">Cache Key</p>
                  <p className="text-xs font-mono break-all">{g.cacheKey}</p>
                  <p className="text-xs text-gray-500 mt-2">Status: {g.status}</p>
                </div>
              ))}
            </div>
          )}
          {garments.some((g) => g.status === 'missing') && (
            <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-400">Missing garments (from catalog sync)</p>
                <button
                  onClick={() => {
                    const missing = garments.filter((g) => g.status === 'missing');
                    const rows = ['garmentId,status', ...missing.map((g) => `${g.garmentId},${g.status}`)];
                    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'drapixai-missing-garments.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1 text-xs bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
                >
                  Export CSV
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {garments
                  .filter((g) => g.status === 'missing')
                  .slice(missingPage * 12, missingPage * 12 + 12)
                  .map((g) => (
                  <span key={g.garmentId} className="text-xs font-mono px-2 py-1 rounded bg-white/10">
                    {g.garmentId}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => setMissingPage(Math.max(0, missingPage - 1))}
                  className="px-3 py-1 text-xs bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
                >
                  Prev
                </button>
                <button
                  onClick={() => setMissingPage(missingPage + 1)}
                  className="px-3 py-1 text-xs bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
                >
                  Next
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {garments
                  .filter((g) => g.status === 'missing')
                  .slice(missingPage * 6, missingPage * 6 + 6)
                  .map((g) => (
                  <div key={`${g.garmentId}-upload`} className="p-3 bg-black/30 border border-white/10 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2">Upload for {g.garmentId}</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !apiKey) return;
                        setGarmentStatus(`Uploading ${g.garmentId}...`);
                        const form = new FormData();
                        form.append('garment_id', g.garmentId);
                        form.append('cloth_image', file);
                        const res = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${apiKey}` },
                          body: form
                        });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          setGarmentStatus(data?.error || 'Upload failed.');
                          return;
                        }
                        setGarmentStatus(`Uploaded ${g.garmentId}.`);
                        const list = await fetch(`${PUBLIC_API_BASE_URL}/sdk/garments`, {
                          headers: { 'Authorization': `Bearer ${apiKey}` },
                        }).then(r => r.json()).catch(() => ({ items: [] }));
                        setGarments(list.items || []);
                      }}
                      className="p-2 text-xs text-gray-300"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Plugin Demo */}
        <div id="plugin-demo" className="p-6 border border-white/10 rounded-xl mb-8">
          <h2 className="text-xl font-bold mb-4">Plugin Demo</h2>
          <p className="text-gray-400 mb-4">Preview the customer-facing plugin experience.</p>
          <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
            <div id="drapixai-dashboard-demo"></div>
          </div>
        </div>

        {/* Quick Start */}
        <div className="p-6 border border-white/10 rounded-xl">
          <h2 className="text-xl font-bold mb-4">Quick Start</h2>
          <p className="text-gray-400 mb-4">Upper-body garments only (full-body coming soon). Upload a garment first, then use the product ID:</p>
          <pre className="p-4 bg-white/5 border border-white/10 rounded-lg overflow-x-auto">
{`<script src="${getSdkScriptUrl()}"></script>
<div id="drapixai-container"></div>
<script>
  DrapixAI.init({
    apiKey: '${apiKey}',
    productId: 'your-product-id',
    containerId: 'drapixai-container',
    baseUrl: '${PUBLIC_API_BASE_URL}',
    garmentType: 'upper'
  });
</script>`}
          </pre>
        </div>
      </main>
    </div>
  );
}
