'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface AdminGarment {
  id: number;
  userId: number;
  garmentId: string;
  displayName?: string | null;
  productName?: string | null;
  category?: string | null;
  status: string;
  cacheKey?: string | null;
  thumbnailUrl?: string;
  updatedAt: string;
  rejectedReason?: string | null;
  certification?: string;
}

interface AdminTryOnResult {
  id: number;
  userId: number;
  userEmail: string;
  garmentId?: string | null;
  productId?: string | null;
  hasPersonImage: boolean;
  hasGarmentImage: boolean;
  hasResultImage: boolean;
  engine: string;
  qualityScore?: number | null;
  candidateCount: number;
  processingMs?: number | null;
  latencyMs?: number | null;
  warnings?: string[] | null;
  confidenceBadge?: 'Excellent' | 'Review' | 'Not publishable';
  productAccuracyReport?: Record<string, 'Excellent' | 'Review' | 'Not publishable'> | null;
  status: string;
  createdAt: string;
}

interface AdminOverview {
  totals: {
    users: number;
    activeApiKeys: number;
    rendersThisMonth: number;
    pendingGarments: number;
    emailsSent: number;
    emailsFailed: number;
  };
  plans: { planType: string; planName?: string; count: number }[];
  recentUsers: { email: string; planType: string; planName?: string; createdAt: string }[];
  dailyUsage: { date: string; count: number }[];
  signups: { date: string; count: number }[];
}

interface AdminWebsiteAnalytics {
  pageViewsLast30Days: number;
  demoStartsLast30Days: number;
  demoSuccessLast30Days: number;
  ctaClicksLast30Days: number;
  topPages: { path: string; count: number }[];
  eventsByDay: { date: string; pageViews: number; demoStarts: number; demoSuccess: number; ctaClicks: number }[];
}

interface AdminOps {
  health: {
    database: boolean;
    redis: boolean;
    aiReachable: boolean;
    aiReady: boolean;
    aiStatus: string;
    queueDepth: number;
  };
  renderStats: {
    total: number;
    pending: number;
    complete: number;
    failed: number;
  };
  recentFailures: { id: number; error: string | null; createdAt: string }[];
  dailyTraffic: { date: string; count: number }[];
}

type TryOnReviewFilter = 'generated' | 'low_quality' | 'high_latency' | 'warnings' | 'approved' | 'rejected';
type GarmentReviewFilter = 'pending' | 'cache_failed' | 'no_cache' | 'ready' | 'rejected';

const tryOnReviewFilters: { value: TryOnReviewFilter; label: string; description: string }[] = [
  { value: 'generated', label: 'Generated', description: 'New results awaiting review' },
  { value: 'low_quality', label: 'Low Quality', description: 'Score below 0.95' },
  { value: 'high_latency', label: 'High Latency', description: 'Above 12 seconds' },
  { value: 'warnings', label: 'Warnings', description: 'Any model or pipeline warning' },
  { value: 'approved', label: 'Approved', description: 'Production examples' },
  { value: 'rejected', label: 'Rejected', description: 'Failed review' },
];

const garmentReviewFilters: { value: GarmentReviewFilter; label: string; description: string }[] = [
  { value: 'pending', label: 'Pending', description: 'Needs admin review' },
  { value: 'cache_failed', label: 'Cache Failed', description: 'Regeneration failed' },
  { value: 'no_cache', label: 'No Cache', description: 'Missing try-on asset' },
  { value: 'ready', label: 'Ready', description: 'Approved cache assets' },
  { value: 'rejected', label: 'Rejected', description: 'Blocked assets' },
];

const confidenceClass = (badge?: string) => {
  if (badge === 'Excellent') return 'border-[#9bb6a8] bg-[#eaf0e9] text-[#183f32]';
  if (badge === 'Not publishable') return 'border-[#d6a29c] bg-[#fbefed] text-[#7c2d27]';
  return 'border-[#d5b77d] bg-[#fbf5e9] text-[#7c5620]';
};

const accuracyLabel = (key: string) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase());

export default function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [website, setWebsite] = useState<AdminWebsiteAnalytics | null>(null);
  const [ops, setOps] = useState<AdminOps | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [garments, setGarments] = useState<AdminGarment[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [tryOnResults, setTryOnResults] = useState<AdminTryOnResult[]>([]);
  const [tryOnImages, setTryOnImages] = useState<Record<string, string>>({});
  const [tryOnFilter, setTryOnFilter] = useState<TryOnReviewFilter>('generated');
  const [garmentFilter, setGarmentFilter] = useState<GarmentReviewFilter>('pending');
  const router = useRouter();
  const adminFetch = (path: string, init?: RequestInit) => fetch(`/api/admin/proxy/${path}`, init);

  useEffect(() => {
    let active = true;
    const loadAdminData = async () => {
      try {
        const [overviewRes, websiteRes, opsRes, resultsRes] = await Promise.all([
          adminFetch('overview'),
          adminFetch('website'),
          adminFetch('ops'),
          adminFetch('tryon-results?filter=generated'),
        ]);

        if ([overviewRes, websiteRes, opsRes, resultsRes].some((res) => res.status === 401 || res.status === 403)) {
          router.push('/admin-access');
          return;
        }

        if (!overviewRes.ok || !websiteRes.ok || !opsRes.ok || !resultsRes.ok) {
          throw new Error('ADMIN_DASHBOARD_LOAD_FAILED');
        }

        const [overviewData, websiteData, opsData, resultsData] = await Promise.all([
          overviewRes.json(),
          websiteRes.json(),
          opsRes.json(),
          resultsRes.json(),
        ]);

        if (!active) return;
        setOverview(overviewData);
        setWebsite(websiteData);
        setOps(opsData);
        setTryOnResults(resultsData.items || []);
        setSessionReady(true);
      } catch (error) {
        console.error(error);
        if (active) {
          router.push('/admin-access');
        }
      }
    };

    loadAdminData();
    return () => {
      active = false;
    };
  }, [router]);

  const fetchGarments = async (filter = garmentFilter) => {
    const res = await adminFetch(`garments?filter=${encodeURIComponent(filter)}`);
    if (res.ok) {
      const data = await res.json();
      setGarments(data.items || []);
    }
  };

  const fetchTryOnResults = async (filter = tryOnFilter) => {
    const res = await adminFetch(`tryon-results?filter=${encodeURIComponent(filter)}`);
    if (res.ok) {
      const data = await res.json();
      setTryOnResults(data.items || []);
    }
  };

  useEffect(() => {
    if (!sessionReady || garments.length === 0) return;
    let active = true;
    const load = async () => {
      const next: Record<number, string> = {};
      for (const g of garments.slice(0, 6)) {
        try {
          const res = await adminFetch(`garments/${g.id}/thumbnail`);
          if (!res.ok) continue;
          const blob = await res.blob();
          next[g.id] = URL.createObjectURL(blob);
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
  }, [sessionReady, garments]);

  useEffect(() => {
    if (!sessionReady || tryOnResults.length === 0) return;
    let active = true;
    const load = async () => {
      const next: Record<string, string> = {};
      for (const item of tryOnResults.slice(0, 12)) {
        const imageKinds = [
          item.hasPersonImage ? 'person' : '',
          item.hasGarmentImage ? 'garment' : '',
          item.hasResultImage ? 'result' : '',
        ].filter(Boolean);
        for (const kind of imageKinds) {
          try {
            const res = await adminFetch(`tryon-results/${item.id}/${kind}`);
            if (!res.ok) continue;
            const blob = await res.blob();
            next[`${item.id}:${kind}`] = URL.createObjectURL(blob);
          } catch {
            // ignore
          }
        }
      }
      if (active) setTryOnImages(next);
    };
    load();
    return () => {
      active = false;
      Object.values(tryOnImages).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [sessionReady, tryOnResults]);

  if (!overview || !website || !ops) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f2] text-[#172019]">
        <p className="text-[#68736b]">Loading administration data...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f2] text-[#172019]">
      <header className="border-b border-black/10 bg-[#fbfcf9]">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={40}
              height={40}
              className="rounded-md"
            />
            <div><span className="block text-lg font-bold leading-none">DrapixAI</span><span className="mt-1 block text-[11px] font-semibold uppercase text-[#748078]">Quality operations</span></div>
          </Link>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                fetch('/api/admin/session', { method: 'DELETE' }).finally(() => {
                  router.push('/');
                });
              }}
              className="text-sm font-semibold text-[#667169] hover:text-[#172019]"
            >
              Admin Logout
            </button>
            <Link href="/dashboard" className="text-sm font-semibold text-[#667169] hover:text-[#172019]">Brand workspace</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="mb-10 border-b border-black/10 pb-8"><p className="text-xs font-bold uppercase text-[#31725b]">Internal operations</p><h1 className="mt-4 font-serif text-4xl leading-tight">Quality and launch control.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#68736b]">Review platform health, generated results, garment certification, latency, warnings, and customer-facing approval decisions.</p></div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Users</p>
            <p className="text-2xl font-bold">{overview.totals.users}</p>
          </div>
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Active API Keys</p>
            <p className="text-2xl font-bold">{overview.totals.activeApiKeys}</p>
          </div>
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Renders This Month</p>
            <p className="text-2xl font-bold">{overview.totals.rendersThisMonth}</p>
          </div>
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Pending Garments</p>
            <p className="text-2xl font-bold">{overview.totals.pendingGarments}</p>
          </div>
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Emails Sent</p>
            <p className="text-2xl font-bold">{overview.totals.emailsSent}</p>
          </div>
          <div className="border border-black/10 bg-white p-5">
            <p className="text-sm text-[#68736b]">Email Failures</p>
            <p className="text-2xl font-bold">{overview.totals.emailsFailed}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="border border-black/10 bg-white p-6">
            <h2 className="text-xl font-bold mb-4">Business Overview</h2>
            <div className="space-y-3">
              {overview.plans.map((plan) => (
                <div key={plan.planType} className="flex items-center justify-between text-sm text-[#536057]">
                  <span>{plan.planName || plan.planType}</span>
                  <span className="font-semibold text-[#172019]">{plan.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-black/10 pt-6">
              <h3 className="mb-3 text-sm font-semibold">Recent Signups</h3>
              <div className="space-y-2">
                {overview.recentUsers.map((user) => (
                  <div key={`${user.email}-${user.createdAt}`} className="flex items-center justify-between text-sm text-[#536057]">
                    <span>{user.email}</span>
                    <span>{user.planName || user.planType}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border border-black/10 bg-white p-6">
            <h2 className="text-xl font-bold mb-4">Website Analytics</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">Page Views</p>
                <p className="text-2xl font-bold">{website.pageViewsLast30Days}</p>
              </div>
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">Demo Starts</p>
                <p className="text-2xl font-bold">{website.demoStartsLast30Days}</p>
              </div>
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">Demo Success</p>
                <p className="text-2xl font-bold">{website.demoSuccessLast30Days}</p>
              </div>
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">CTA Clicks</p>
                <p className="text-2xl font-bold">{website.ctaClicksLast30Days}</p>
              </div>
            </div>
            <h3 className="mb-3 text-sm font-semibold">Top Pages</h3>
            <div className="space-y-2">
              {website.topPages.map((page) => (
                <div key={page.path} className="flex items-center justify-between text-sm text-[#536057]">
                  <span>{page.path}</span>
                  <span className="font-semibold text-[#172019]">{page.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="border border-black/10 bg-white p-6">
            <h2 className="text-xl font-bold mb-4">AI Ops Dashboard</h2>
            <div className="space-y-3 text-sm text-[#536057]">
              <div className="flex items-center justify-between"><span>Database</span><span className={ops.health.database ? 'font-semibold text-[#31725b]' : 'font-semibold text-[#9a3b33]'}>{ops.health.database ? 'Healthy' : 'Down'}</span></div>
              <div className="flex items-center justify-between"><span>Redis</span><span className={ops.health.redis ? 'font-semibold text-[#31725b]' : 'font-semibold text-[#9a3b33]'}>{ops.health.redis ? 'Healthy' : 'Down'}</span></div>
              <div className="flex items-center justify-between"><span>AI Reachable</span><span className={ops.health.aiReachable ? 'font-semibold text-[#31725b]' : 'font-semibold text-[#9a3b33]'}>{ops.health.aiReachable ? 'Yes' : 'No'}</span></div>
              <div className="flex items-center justify-between"><span>AI Ready</span><span className={ops.health.aiReady ? 'font-semibold text-[#31725b]' : 'font-semibold text-[#9a3b33]'}>{ops.health.aiReady ? 'Ready' : 'Not ready'}</span></div>
              <div className="flex items-center justify-between"><span>AI Status</span><span>{ops.health.aiStatus}</span></div>
              <div className="flex items-center justify-between"><span>Render Queue</span><span>{ops.health.queueDepth}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">Pending Renders</p>
                <p className="text-2xl font-bold">{ops.renderStats.pending}</p>
              </div>
              <div className="border border-black/10 bg-[#f4f6f2] p-4">
                <p className="text-xs text-[#68736b]">Failed Renders</p>
                <p className="text-2xl font-bold">{ops.renderStats.failed}</p>
              </div>
            </div>
          </div>

          <div className="border border-black/10 bg-white p-6">
            <h2 className="text-xl font-bold mb-4">Recent Failures</h2>
            {ops.recentFailures.length === 0 ? (
              <p className="text-sm text-[#68736b]">No recent render failures recorded.</p>
            ) : (
              <div className="space-y-3">
                {ops.recentFailures.map((failure) => (
                  <div key={failure.id} className="border border-[#d6a29c] bg-[#fbefed] p-3">
                    <p className="text-sm text-[#7c2d27]">{failure.error || 'Unknown render failure'}</p>
                    <p className="mt-1 text-xs text-[#8b5c57]">{new Date(failure.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mb-8 border border-black/10 bg-white p-6">
          <h2 className="text-xl font-bold mb-4">Global Daily AI Traffic</h2>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {ops.dailyTraffic.slice(-7).map((d) => (
              <div key={d.date} className="border border-black/10 bg-[#f4f6f2] p-4 text-center">
                <p className="text-xs text-[#68736b]">{d.date.slice(5)}</p>
                <p className="text-2xl font-bold">{d.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-8 border border-black/10 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold">Try-On Quality Review</h2>
              <p className="mt-1 text-sm text-[#68736b]">Review person input, garment input, output, quality score, latency, and warnings before approving production examples.</p>
            </div>
            <button
              onClick={() => fetchTryOnResults()}
              className="border border-black/15 bg-white px-4 py-2 text-sm font-semibold hover:bg-[#eef2ed]"
            >
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
            {tryOnReviewFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => {
                  setTryOnFilter(filter.value);
                  fetchTryOnResults(filter.value);
                }}
                className={`border p-3 text-left transition-colors ${
                  tryOnFilter === filter.value
                    ? 'border-[#31725b] bg-[#eaf0e9] text-[#183f32]'
                    : 'border-black/10 bg-white text-[#536057] hover:bg-[#f4f6f2]'
                }`}
              >
                <span className="block text-sm font-semibold">{filter.label}</span>
                <span className="mt-1 block text-xs text-[#748078]">{filter.description}</span>
              </button>
            ))}
          </div>
          {tryOnResults.length === 0 ? (
            <p className="text-sm text-[#68736b]">No try-on results match the selected review filter.</p>
          ) : (
            <div className="space-y-5">
              {tryOnResults.slice(0, 12).map((item) => {
                const warnings = Array.isArray(item.warnings) ? item.warnings : [];
                return (
                  <div key={item.id} className="border border-black/10 bg-[#fbfcf9] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <div>
                        <p className="text-sm font-semibold">Result #{item.id}</p>
                        <p className="text-xs text-[#68736b]">{item.userEmail} / {new Date(item.createdAt).toLocaleString()}</p>
                        <p className="mt-1 text-xs text-[#748078]">Product: {item.productId || 'not linked'} / Garment: {item.garmentId || 'not linked'}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`px-2 py-1 rounded-md border text-xs font-semibold ${confidenceClass(item.confidenceBadge)}`}>
                            {item.confidenceBadge || 'Review'}
                          </span>
                          <span className="border border-black/10 bg-white px-2 py-1 text-xs text-[#536057]">
                            {item.status}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="border border-black/10 bg-white px-3 py-2">
                          <p className="text-[#748078]">Score</p>
                          <p className="font-semibold">{typeof item.qualityScore === 'number' ? item.qualityScore.toFixed(2) : 'n/a'}</p>
                        </div>
                        <div className="border border-black/10 bg-white px-3 py-2">
                          <p className="text-[#748078]">Latency</p>
                          <p className={(item.latencyMs || 0) > 12000 ? 'font-semibold text-[#9a6a1d]' : 'font-semibold text-[#31725b]'}>{item.latencyMs ? `${(item.latencyMs / 1000).toFixed(1)}s` : 'n/a'}</p>
                        </div>
                        <div className="border border-black/10 bg-white px-3 py-2">
                          <p className="text-[#748078]">AI Time</p>
                          <p className="font-semibold">{item.processingMs ? `${(item.processingMs / 1000).toFixed(1)}s` : 'n/a'}</p>
                        </div>
                        <div className="border border-black/10 bg-white px-3 py-2">
                          <p className="text-[#748078]">Engine</p>
                          <p className="font-semibold">{item.engine}</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {['person', 'garment', 'result'].map((kind) => (
                        <div key={kind} className="overflow-hidden border border-black/10 bg-white">
                          <p className="border-b border-black/10 px-3 py-2 text-xs font-bold uppercase text-[#68736b]">{kind}</p>
                          {tryOnImages[`${item.id}:${kind}`] ? (
                            <img
                              src={tryOnImages[`${item.id}:${kind}`]}
                              alt={`${kind} ${item.id}`}
                              className="h-64 w-full bg-[#f4f6f2] object-contain"
                            />
                          ) : (
                            <div className="flex h-64 items-center justify-center text-sm text-[#748078]">No image stored</div>
                          )}
                        </div>
                      ))}
                    </div>
                    {warnings.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {warnings.map((warning) => (
                          <span key={warning} className="border border-[#d5b77d] bg-[#fbf5e9] px-2 py-1 text-xs text-[#7c5620]">{warning}</span>
                        ))}
                      </div>
                    )}
                    {item.productAccuracyReport ? (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                        {Object.entries(item.productAccuracyReport).map(([key, value]) => (
                          <div key={key} className={`px-3 py-2 rounded-md border text-xs ${confidenceClass(value)}`}>
                            <p className="font-semibold">{accuracyLabel(key)}</p>
                            <p className="mt-1 opacity-80">{value}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={async () => {
                          await adminFetch(`tryon-results/${item.id}/approve`, { method: 'POST' });
                          fetchTryOnResults();
                        }}
                        className="border border-[#31725b] bg-[#183f32] px-3 py-2 text-sm font-semibold text-white hover:bg-[#245a48]"
                      >
                        Approve
                      </button>
                      <button
                        onClick={async () => {
                          await adminFetch(`tryon-results/${item.id}/reject`, { method: 'POST' });
                          fetchTryOnResults();
                        }}
                        className="border border-[#d6a29c] bg-[#fbefed] px-3 py-2 text-sm font-semibold text-[#7c2d27] hover:bg-[#f7dfdc]"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 border border-black/10 bg-white p-6">
          <h2 className="text-xl font-bold mb-4">Garment Approvals</h2>
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => fetchGarments()}
              className="border border-black/15 bg-white px-4 py-2 text-sm font-semibold hover:bg-[#eef2ed]"
            >
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
            {garmentReviewFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => {
                  setGarmentFilter(filter.value);
                  fetchGarments(filter.value);
                }}
                className={`border p-3 text-left transition-colors ${
                  garmentFilter === filter.value
                    ? 'border-[#31725b] bg-[#eaf0e9] text-[#183f32]'
                    : 'border-black/10 bg-white text-[#536057] hover:bg-[#f4f6f2]'
                }`}
              >
                <span className="block text-sm font-semibold">{filter.label}</span>
                <span className="mt-1 block text-xs text-[#748078]">{filter.description}</span>
              </button>
            ))}
          </div>
          {garments.length === 0 ? (
            <p className="text-sm text-[#68736b]">No garments match the selected review filter.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {garments.map((g) => (
                <div key={g.id} className="border border-black/10 bg-[#fbfcf9] p-4">
                  <p className="text-xs text-[#68736b]">User ID: {g.userId}</p>
                  <p className="text-base font-mono">{g.garmentId}</p>
                  <p className="mt-1 text-xs text-[#748078]">{g.productName || g.displayName || 'Unnamed garment'}{g.category ? ` / ${g.category}` : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="border border-black/10 bg-white px-2 py-1 text-xs">garment uploaded</span>
                    <span className={g.cacheKey ? 'border border-[#9bb6a8] bg-[#eaf0e9] px-2 py-1 text-xs text-[#183f32]' : 'border border-[#d5b77d] bg-[#fbf5e9] px-2 py-1 text-xs text-[#7c5620]'}>
                      {g.cacheKey ? 'try-on cache ready' : 'regenerate cache'}
                    </span>
                    <span className={g.status === 'rejected' ? 'border border-[#d6a29c] bg-[#fbefed] px-2 py-1 text-xs text-[#7c2d27]' : g.status === 'ready' ? 'border border-[#9bb6a8] bg-[#eaf0e9] px-2 py-1 text-xs text-[#183f32]' : 'border border-[#d5b77d] bg-[#fbf5e9] px-2 py-1 text-xs text-[#7c5620]'}>
                      {g.status === 'ready' ? 'approved' : g.status === 'rejected' ? 'rejected' : 'pending review'}
                    </span>
                    <span className={g.certification === 'DrapixAI-ready' ? 'border border-[#31725b] bg-[#183f32] px-2 py-1 text-xs text-white' : 'border border-black/10 bg-white px-2 py-1 text-xs text-[#536057]'}>
                      {g.certification || 'Not certified'}
                    </span>
                  </div>
                  {g.rejectedReason ? <p className="mt-2 text-xs text-[#7c5620]">{g.rejectedReason}</p> : null}
                  <div className="mt-2">
                    <img
                      src={thumbs[g.id] || ''}
                      alt={g.garmentId}
                      className="h-40 w-full border border-black/10 bg-white object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async () => {
                        await adminFetch(`garments/${g.id}/approve`, { method: 'POST' });
                        fetchGarments();
                      }}
                      className="border border-[#31725b] bg-[#183f32] px-3 py-2 text-sm font-semibold text-white hover:bg-[#245a48]"
                    >
                      Approve
                    </button>
                    <button
                      onClick={async () => {
                        await adminFetch(`garments/${g.id}/reject`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ reason: 'Rejected by admin' })
                        });
                        fetchGarments();
                      }}
                      className="border border-[#d6a29c] bg-[#fbefed] px-3 py-2 text-sm font-semibold text-[#7c2d27] hover:bg-[#f7dfdc]"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
