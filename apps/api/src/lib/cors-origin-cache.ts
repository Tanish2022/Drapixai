type OriginCachePrisma = {
  apiKey: {
    findMany(args: any): Promise<Array<{ domainWhitelist: string | null }>>;
  };
  shopifyInstallation: {
    findMany(args: any): Promise<Array<{ shopDomain: string; primaryDomain: string | null }>>;
  };
};

const normalizeHost = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .split(':')[0]
  .replace(/\.$/, '');

const parseTtl = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(300_000, Math.max(5_000, Math.floor(parsed)));
};

export const createVerifiedStorefrontOriginCache = (
  prisma: OriginCachePrisma,
  options: { shopifyEnabled: boolean; ttlMs?: number } = { shopifyEnabled: false },
) => {
  const ttlMs = parseTtl(options.ttlMs ?? process.env.DRAPIXAI_CORS_CACHE_TTL_MS);
  let allowedHosts = new Set<string>();
  let expiresAt = 0;
  let refreshPromise: Promise<void> | null = null;

  const refresh = async () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const [manualKeys, installations] = await Promise.all([
        prisma.apiKey.findMany({
          where: {
            kind: 'manual',
            isActive: true,
            domainWhitelist: { not: null },
            user: { storeVerifiedAt: { not: null } },
          },
          select: { domainWhitelist: true },
        }),
        options.shopifyEnabled
          ? prisma.shopifyInstallation.findMany({
            where: { status: 'active' },
            select: { shopDomain: true, primaryDomain: true },
          })
          : Promise.resolve([]),
      ]);
      const next = new Set<string>();
      for (const key of manualKeys) {
        const host = normalizeHost(key.domainWhitelist);
        if (host) next.add(host);
      }
      for (const installation of installations) {
        const shopDomain = normalizeHost(installation.shopDomain);
        const primaryDomain = normalizeHost(installation.primaryDomain);
        if (shopDomain) next.add(shopDomain);
        if (primaryDomain) next.add(primaryDomain);
      }
      allowedHosts = next;
      expiresAt = Date.now() + ttlMs;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  return {
    async allows(origin: string) {
      const host = normalizeHost(new URL(origin).hostname);
      if (!host) return false;
      if (Date.now() >= expiresAt) await refresh();
      return allowedHosts.has(host);
    },
    invalidate() {
      expiresAt = 0;
    },
  };
};
