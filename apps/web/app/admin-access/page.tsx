'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminAccess() {
  const [email, setEmail] = useState('admin@drapixai.com');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const router = useRouter();

  const submit = async () => {
    setStatus('Checking...');
    const res = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      setStatus('Access denied.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data?.apiKey) {
      localStorage.setItem('adminApiKey', data.apiKey);
    }
    setStatus('Access granted.');
    router.push('/admin');
  };

  return (
    <div className="min-h-screen bg-[#050816] text-white flex items-center justify-center">
      <div className="w-full max-w-md p-6 border border-white/10 rounded-2xl bg-[#0b1120]/60">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/drapixai_emblem_64.webp"
              alt="DrapixAI"
              width={40}
              height={40}
              className="rounded-xl"
            />
            <span className="text-lg font-bold">DrapixAI</span>
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-white">Home</Link>
        </div>
        <h1 className="text-2xl font-bold mb-2">Admin Access</h1>
        <p className="text-gray-400 mb-4">Enter the admin email and password to access the control panel.</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@drapixai.com"
          className="w-full p-3 mb-3 bg-white/5 border border-white/10 rounded-lg text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg font-mono text-sm"
        />
        <button
          onClick={submit}
          className="w-full mt-4 py-2 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
        >
          Continue
        </button>
        {status && <p className="text-xs text-gray-400 mt-3">{status}</p>}
      </div>
    </div>
  );
}
