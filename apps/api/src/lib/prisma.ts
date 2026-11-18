import { PrismaClient } from '@prisma/client';

// One bounded pool per API process. Keep operator-supplied pool limits and
// transport options, including the managed provider's pooled endpoint.
const runtimeUrl = process.env.DATABASE_URL;
const options = (() => {
  if (!runtimeUrl) return undefined;
  let url: URL;
  try { url = new URL(runtimeUrl); } catch { throw new Error('DATABASE_URL_INVALID'); }
  for (const [key, fallback] of [['connection_limit', '4'], ['pool_timeout', '10']]) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1 || (values.length === 1 && !/^[1-9]\d*$/.test(values[0]))) {
      throw new Error('DATABASE_POOL_CONFIGURATION_INVALID');
    }
    if (!values.length) url.searchParams.set(key, fallback);
  }
  return { datasourceUrl: url.toString() };
})();

export const prisma = new PrismaClient(options);
