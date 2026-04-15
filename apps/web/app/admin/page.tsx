'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PUBLIC_API_BASE_URL } from '@/app/lib/public-env';

interface AdminGarment {
  id: number;
  userId: number;
  garmentId: string;
  status: string;
  thumbnailUrl?: string;
  updatedAt: string;
  rejectedReason?: string | null;
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

export default function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [website, setWebsite] = useState<AdminWebsiteAnalytics | null>(null);
  const [ops, setOps] = useState<AdminOps | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [garments, setGarments] = useState<AdminGarment[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const router = useRouter();

  useEffect(() => {
    const storedApiKey = localStorage.getItem('adminApiKey') || '';
    if (!storedApiKey) {
      router.push('/admin-access');
      return;
    }
    setApiKey(storedApiKey);

    if (storedApiKey) {
      fetch(`${PUBLIC_API_BASE_URL}/admin/overview`, {
        headers: { 'Authorization': `Bearer ${storedApiKey}` },
      })
        .then(res => res.json())
        .then(data => setOverview(data))
        .catch(console.error);

      fetch(`${PUBLIC_API_BASE_URL}/admin/website`, {
        headers: { 'Authorization': `Bearer ${storedApiKey}` },
      })
        .then(res => res.json())
        .then(data => setWebsite(data))
        .catch(console.error);

      fetch(`${PUBLIC_API_BASE_URL}/admin/ops`, {
        headers: { 'Authorization': `Bearer ${storedApiKey}` },
      })
        .then(res => res.json())
        .then(data => setOps(data))
        .catch(console.error);
    }
  }, [router]);

  const fetchGarments = async () => {
    const res = await fetch(`${PUBLIC_API_BASE_URL}/admin/garments?status=pending`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (res.ok) {
      const data = await res.json();
      setGarments(data.items || []);
    }
  };

  useEffect(() => {
    if (!apiKey || garments.length === 0) return;
    let active = true;
    const load = async () => {
      const next: Record<number, string> = {};
      for (const g of garments.slice(0, 6)) {
        try {
          const res = await fetch(`${PUBLIC_API_BASE_URL}/admin/garments/${g.id}/thumbnail`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
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
  }, [apiKey, garments]);

  if (!overview || !website || !ops) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 p-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={40}
              height={40}
              className="rounded-xl"
            />
            <span className="text-2xl font-bold">DrapixAI Admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                fetch('/api/admin/session', { method: 'DELETE' }).finally(() => {
                  localStorage.removeItem('adminApiKey');
                  router.push('/');
                });
              }}
              className="text-gray-400 hover:text-white text-sm"
            >
              Admin Logout
            </button>
            <Link href="/dashboard" className="text-gray-400 hover:text-white">Dashboard</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">Admin Control Panel</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Users</p>
            <p className="text-2xl font-bold">{overview.totals.users}</p>
          </div>
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Active API Keys</p>
            <p className="text-2xl font-bold">{overview.totals.activeApiKeys}</p>
          </div>
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Renders This Month</p>
            <p className="text-2xl font-bold">{overview.totals.rendersThisMonth}</p>
          </div>
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Pending Garments</p>
            <p className="text-2xl font-bold">{overview.totals.pendingGarments}</p>
          </div>
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Emails Sent</p>
            <p className="text-2xl font-bold">{overview.totals.emailsSent}</p>
          </div>
          <div className="p-6 border border-white/10 rounded-xl">
            <p className="text-gray-400 text-sm">Email Failures</p>
            <p className="text-2xl font-bold">{overview.totals.emailsFailed}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="p-6 border border-white/10 rounded-xl">
            <h2 className="text-xl font-bold mb-4">Business Overview</h2>
            <div className="space-y-3">
              {overview.plans.map((plan) => (
                <div key={plan.planType} className="flex items-center justify-between text-sm text-gray-300">
                  <span>{plan.planName || plan.planType}</span>
                  <span className="font-semibold text-white">{plan.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="text-sm font-semibold text-white mb-3">Recent Signups</h3>
              <div className="space-y-2">
                {overview.recentUsers.map((user) => (
                  <div key={`${user.email}-${user.createdAt}`} className="flex items-center justify-between text-sm text-gray-300">
                    <span>{user.email}</span>
                    <span>{user.planName || user.planType}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border border-white/10 rounded-xl">
            <h2 className="text-xl font-bold mb-4">Website Analytics</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">Page Views</p>
                <p className="text-2xl font-bold">{website.pageViewsLast30Days}</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">Demo Starts</p>
                <p className="text-2xl font-bold">{website.demoStartsLast30Days}</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">Demo Success</p>
                <p className="text-2xl font-bold">{website.demoSuccessLast30Days}</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">CTA Clicks</p>
                <p className="text-2xl font-bold">{website.ctaClicksLast30Days}</p>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white mb-3">Top Pages</h3>
            <div className="space-y-2">
              {website.topPages.map((page) => (
                <div key={page.path} className="flex items-center justify-between text-sm text-gray-300">
                  <span>{page.path}</span>
                  <span className="font-semibold text-white">{page.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="p-6 border border-white/10 rounded-xl">
            <h2 className="text-xl font-bold mb-4">AI Ops Dashboard</h2>
            <div className="space-y-3 text-sm text-gray-300">
              <div className="flex items-center justify-between"><span>Database</span><span className={ops.health.database ? 'text-green-400' : 'text-red-400'}>{ops.health.database ? 'Healthy' : 'Down'}</span></div>
              <div className="flex items-center justify-between"><span>Redis</span><span className={ops.health.redis ? 'text-green-400' : 'text-red-400'}>{ops.health.redis ? 'Healthy' : 'Down'}</span></div>
              <div className="flex items-center justify-between"><span>AI Reachable</span><span className={ops.health.aiReachable ? 'text-green-400' : 'text-red-400'}>{ops.health.aiReachable ? 'Yes' : 'No'}</span></div>
              <div className="flex items-center justify-between"><span>AI Ready</span><span className={ops.health.aiReady ? 'text-green-400' : 'text-red-400'}>{ops.health.aiReady ? 'Ready' : 'Not ready'}</span></div>
              <div className="flex items-center justify-between"><span>AI Status</span><span>{ops.health.aiStatus}</span></div>
              <div className="flex items-center justify-between"><span>Render Queue</span><span>{ops.health.queueDepth}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">Pending Renders</p>
                <p className="text-2xl font-bold">{ops.renderStats.pending}</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-xs text-gray-400">Failed Renders</p>
                <p className="text-2xl font-bold">{ops.renderStats.failed}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border border-white/10 rounded-xl">
            <h2 className="text-xl font-bold mb-4">Recent Failures</h2>
            {ops.recentFailures.length === 0 ? (
              <p className="text-sm text-gray-400">No recent render failures recorded.</p>
            ) : (
              <div className="space-y-3">
                {ops.recentFailures.map((failure) => (
                  <div key={failure.id} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                    <p className="text-sm text-red-300">{failure.error || 'Unknown render failure'}</p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(failure.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border border-white/10 rounded-xl mb-8">
          <h2 className="text-xl font-bold mb-4">Global Daily AI Traffic</h2>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {ops.dailyTraffic.slice(-7).map((d) => (
              <div key={d.date} className="p-4 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-gray-400">{d.date.slice(5)}</p>
                <p className="text-2xl font-bold">{d.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 border border-white/10 rounded-xl mt-8">
          <h2 className="text-xl font-bold mb-4">Garment Approvals</h2>
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => fetchGarments()}
              className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
            >
              Load Pending
            </button>
          </div>
          {garments.length === 0 ? (
            <p className="text-sm text-gray-400">No pending garments.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {garments.map((g) => (
                <div key={g.id} className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <p className="text-xs text-gray-400">User ID: {g.userId}</p>
                  <p className="text-base font-mono">{g.garmentId}</p>
                  <div className="mt-2">
                    <img
                      src={thumbs[g.id] || ''}
                      alt={g.garmentId}
                      className="w-full h-40 object-contain bg-white/5 border border-white/10 rounded-md"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async () => {
                        await fetch(`${PUBLIC_API_BASE_URL}/admin/garments/${g.id}/approve`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${apiKey}` }
                        });
                        fetchGarments();
                      }}
                      className="px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-lg text-green-300"
                    >
                      Approve
                    </button>
                    <button
                      onClick={async () => {
                        await fetch(`${PUBLIC_API_BASE_URL}/admin/garments/${g.id}/reject`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                          body: JSON.stringify({ reason: 'Rejected by admin' })
                        });
                        fetchGarments();
                      }}
                      className="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300"
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
