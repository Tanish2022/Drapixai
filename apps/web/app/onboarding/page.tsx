'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { signOut } from 'next-auth/react';
import WorkspaceHeader from '@/app/components/WorkspaceHeader';
import { SHOPIFY_APP_INSTALL_URL } from '@/app/lib/public-env';
import { getMerchantSetup, setupErrorMessage, type SetupGarment, type SetupSummary } from '@/app/lib/merchant-onboarding';

type Product = { productId: string; productName?: string | null; garmentType?: string | null };
const field = 'mt-2 w-full border border-black/20 bg-white p-3 text-[#172019]';
const primary = 'inline-flex min-h-12 items-center justify-center gap-2 bg-[#183f32] px-5 py-3 text-sm font-bold text-white hover:bg-[#245a48] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex min-h-12 items-center justify-center gap-2 border border-black/20 bg-white px-4 py-3 text-sm font-semibold hover:bg-[#eef2ed] disabled:opacity-50';

export default function MerchantOnboarding() {
  const router = useRouter();
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [garments, setGarments] = useState<SetupGarment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [productId, setProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('Shirt');
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState('');
  const [selectedGarment, setSelectedGarment] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/dashboard/proxy/${path}`, { ...init, cache: 'no-store' });
    if (response.status === 401) {
      router.replace('/auth/login?next=/onboarding');
      throw new Error('Please sign in again to continue setup.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(setupErrorMessage(data?.error));
    return data;
  }, [router]);

  const refresh = useCallback(async () => {
    setLoadError('');
    try {
      const [usage, assets, catalog] = await Promise.all([
        request('analytics/summary'), request('sdk/garments'), request('sdk/catalog'),
      ]);
      if (!usage || !Array.isArray(assets?.items) || !Array.isArray(catalog?.items)) throw new Error('Unable to load setup. Please try again.');
      setSummary(usage);
      setGarments(assets.items);
      setProducts(catalog.items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load setup. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !file) return;
    setBusy(true);
    setMessage('Saving your product and checking its photo. This can take a little while.');
    try {
      // The existing upsert lets a merchant retry preparation without importing a CSV again.
      const catalog = await request('sdk/catalog/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ productId: productId.trim(), productName: productName.trim(), category, garmentType: 'upper' }] }),
      });
      if (!catalog?.items?.some((item: Product) => item.productId === productId.trim())) throw new Error('This product could not be added. Choose a supported upper-body category.');
      const form = new FormData();
      form.append('garment_id', uploadId);
      form.append('category', category);
      form.append('product_name', productName.trim());
      form.append('garment_type', 'upper');
      form.append('cloth_image', file);
      const garment = await request('sdk/garments', { method: 'POST', body: form });
      setSelectedGarment(garment.garmentId);
      setSelectedProduct(productId.trim());
      setMessage('Product saved. Review and confirm the product/photo pair below when preparation is ready.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add this product. Please try again.');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await request(`sdk/matches/${encodeURIComponent(selectedGarment)}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selectedProduct }),
      });
      setMessage('Product and photo confirmed. You can now try it privately.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to confirm this product.');
    } finally { setBusy(false); }
  };

  const setup = summary ? getMerchantSetup(summary, garments) : null;
  const prepared = garments.filter((item) => (item.garmentType || 'upper') === 'upper' && item.status === 'ready' && item.cacheKey && !item.confirmedProductId);
  const upperProducts = products.filter((item) => (item.garmentType || 'upper') === 'upper');
  const selected = garments.find((item) => item.garmentId === selectedGarment);
  const canConfirm = prepared.some((item) => item.garmentId === selectedGarment) && upperProducts.some((item) => item.productId === selectedProduct);

  return (
    <div className="min-h-screen bg-[#f4f6f2] text-[#172019]">
      <WorkspaceHeader active="onboarding" onLogout={async () => {
        await fetch('/api/dashboard/session', { method: 'DELETE' });
        await signOut({ redirect: false });
        router.push('/');
      }} />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-widest text-[#31725b]">Let’s get you started</p>
            <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Your first product, step by step.</h1>
            <p className="mt-4 max-w-xl leading-7 text-[#5d6961]">Start small. Add one product, see a private try-on, then set up your store. You can leave and come back to your saved progress.</p></div>
          <Link href="/dashboard" className="py-3 text-sm font-semibold underline underline-offset-4">Open full workspace</Link>
        </div>
        <ol className="my-8 grid gap-3 sm:grid-cols-3" aria-label="Setup stages">
          {['Add one product', 'Preview your product', 'Connect your store'].map((label, index) => (
            <li key={label} aria-current={setup?.stage === index ? 'step' : undefined} className={`flex items-center gap-3 border p-4 ${setup?.stage === index ? 'border-[#31725b] bg-[#eaf0e9]' : 'border-black/10 bg-white'}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-black/15 text-sm">{setup && setup.stage > index ? <Check aria-label="Complete" className="h-4 w-4" /> : index + 1}</span><span className="text-sm font-semibold">{label}</span>
            </li>
          ))}
        </ol>
        {loading ? <p role="status">Loading your saved progress…</p> : null}
        {loadError ? <div role="alert" className="mb-6 border border-[#d6a29c] bg-[#fbefed] p-5"><p>{loadError}</p><button onClick={() => void refresh()} disabled={busy} className={`${secondary} mt-3`}>Try loading again</button></div> : null}
        {message ? <p role="status" className="mb-6 border border-[#9bb6a8] bg-[#eaf0e9] p-4 text-sm leading-6">{message}</p> : null}
        {setup && summary && !loadError ? <>
          {setup.stage === 0 ? <section className="border border-black/10 bg-white p-5 sm:p-8">
            <h2 className="font-serif text-3xl">Start with one shirt or top.</h2>
            <p className="mt-3 leading-7 text-[#5d6961]">Use a clear photo of the garment alone, on a plain background. Avoid photos of a person wearing it.</p>
            {SHOPIFY_APP_INSTALL_URL ? <details className="mt-5 border-b border-black/10 pb-5"><summary className="cursor-pointer font-semibold">Already on Shopify? Import from your store</summary><p className="mt-3 text-sm leading-6 text-[#5d6961]">Authorize the DrapixAI app to import eligible products, then return here to review them.</p><a href={SHOPIFY_APP_INSTALL_URL} className={`${secondary} mt-3`}>Connect Shopify <ArrowRight className="h-4 w-4" /></a></details> : null}
            {prepared.length > 0 ? <form onSubmit={confirm} className="mt-6 space-y-4 border border-[#9bb6a8] bg-[#f4f6f2] p-5">
              <h3 className="text-lg font-bold">Confirm the right product and photo</h3>
              <label className="block text-sm font-semibold">Prepared photo<select required value={selectedGarment} onChange={(event) => setSelectedGarment(event.target.value)} className={field}><option value="">Choose a photo</option>{prepared.map((item) => <option key={item.garmentId} value={item.garmentId}>{item.productName || item.displayName || item.garmentId}</option>)}</select></label>
              {selected && prepared.some((item) => item.garmentId === selected.garmentId) ? <img src={`/api/dashboard/proxy/sdk/garments/${encodeURIComponent(selected.garmentId)}/thumbnail`} alt="Selected garment to match with your product" className="h-40 w-40 border border-black/10 object-contain bg-white" /> : null}
              <label className="block text-sm font-semibold">Store product<select required value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)} className={field}><option value="">Choose the matching product</option>{upperProducts.map((item) => <option key={item.productId} value={item.productId}>{item.productName || item.productId} ({item.productId})</option>)}</select></label>
              <p className="text-sm leading-6 text-[#5d6961]">Check that this photo belongs to this store product. Confirming enables a private preview; it does not publish anything.</p>
              <button disabled={busy || !canConfirm} className={primary}>{busy ? 'Saving…' : 'Confirm product and photo'} <ArrowRight className="h-4 w-4" /></button>
            </form> : null}
            <form onSubmit={addProduct} className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Product name<input required maxLength={200} value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Blue Oxford shirt" className={field} /></label>
              <label className="block text-sm font-semibold">Product ID or SKU<input required maxLength={200} value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="e.g. shirt-001" className={field} /><span className="mt-2 block text-xs font-normal leading-5 text-[#5d6961]">Copy the ID used by your store so we can connect the right product later.</span></label>
              <label className="block text-sm font-semibold">Product type<select value={category} onChange={(event) => setCategory(event.target.value)} className={field}>{['Shirt', 'T-Shirt', 'Polo', 'Blouse', 'Top'].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="block text-sm font-semibold">Garment photo<input type="file" required accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setUploadId(`setup-${crypto.randomUUID()}`); }} className={`${field} text-xs`} /></label>
              <div className="sm:col-span-2"><button disabled={busy || !file} className={primary}>{busy ? 'Checking photo…' : 'Add product and check photo'} <ArrowRight className="h-4 w-4" /></button><p className="mt-3 text-xs leading-5 text-[#5d6961]">Your photo goes through the same preparation and quality checks as every other product. Nothing goes live automatically.</p></div>
            </form>
            {garments.length > 0 ? <div className="mt-6 border-t border-black/10 pt-5"><p className="text-sm text-[#5d6961]">{garments.length} saved photo(s). If preparation is pending or a photo needs attention, check its status in product management.</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void refresh()} className={secondary}><RefreshCw className="h-4 w-4" />Refresh progress</button><Link href="/dashboard#garment-onboarding" className={secondary}>Manage saved products</Link></div></div> : null}
          </section> : setup.stage === 1 ? <section className="border border-black/10 bg-white p-5 sm:p-8">
            <p className="text-xs font-bold uppercase text-[#31725b]">Product ready for a private test</p><h2 className="mt-3 font-serif text-3xl">See how your product looks.</h2>
            <p className="mt-4 leading-7 text-[#5d6961]">Open the preview and use a photo you have permission to upload. Review the garment detail, person’s identity and overall realism before any store installation.</p>
            <p className="mt-4 text-sm font-semibold">{setup.ready[0].confirmedProductName || setup.ready[0].confirmedProductId}</p>
            {summary.quotaRemaining > 0 ? <Link href="/dashboard#plugin-demo" className={`${primary} mt-6`}>Open private try-on <ArrowRight className="h-4 w-4" /></Link> : <Link href="/subscription" className={`${primary} mt-6`}>Review your try-on allowance</Link>}
            <p className="mt-4 text-sm text-[#5d6961]">A preview uses one try-on from your plan and requires the generation service to be available.</p><button onClick={() => void refresh()} className={`${secondary} mt-5`}><RefreshCw className="h-4 w-4" />I’ve tested it — refresh progress</button>
          </section> : <section className="border border-black/10 bg-white p-5 sm:p-8">
            <h2 className="font-serif text-3xl">Bring try-on to your store.</h2><p className="mt-4 leading-7 text-[#5d6961]">Your private preview has completed. Finish store verification and result review before installing for shoppers.</p>
            <ul className="mt-6 space-y-3 text-sm">{[
              { label: 'Store ownership verified', done: Boolean(summary.storeVerified) },
              { label: 'Approved results and warning-free examples recorded', done: setup.reviewed },
              { label: 'Try-ons available in your plan', done: summary.quotaRemaining > 0 },
            ].map((item) => <li key={item.label} className="flex items-center gap-3"><span className={`border px-2 py-1 text-xs ${item.done ? 'border-[#9bb6a8] bg-[#eaf0e9]' : 'border-black/15'}`}>{item.done ? 'Done' : 'Pending'}</span>{item.label}</li>)}</ul>
            {!summary.storeVerified ? <Link href="/settings#store-basics" className={`${primary} mt-6`}>Verify my store <ArrowRight className="h-4 w-4" /></Link> : summary.quotaRemaining <= 0 ? <Link href="/subscription" className={`${primary} mt-6`}>Review your allowance</Link> : setup.canInstall ? <Link href="/sdk-install" className={`${primary} mt-6`}>Set up store installation <ArrowRight className="h-4 w-4" /></Link> : <div className="mt-6 border border-[#9bb6a8] bg-[#eaf0e9] p-4 text-sm leading-6">Result review is still pending. The DrapixAI team must record approval before you proceed. <Link href="/help" className="font-bold underline">Get help with review</Link></div>}
            <p className="mt-4 text-xs leading-5 text-[#5d6961]">Store installation is a separate step. Setup progress does not certify public-launch readiness.</p><button onClick={() => void refresh()} className={`${secondary} mt-5`}><RefreshCw className="h-4 w-4" />Refresh progress</button>
          </section>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm text-[#5d6961]"><p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" />Private preview first. Publish after review.</p><Link href="/help" className="font-semibold underline underline-offset-4">Need a hand? Get setup help</Link></div>
        </> : null}
      </main>
    </div>
  );
}
