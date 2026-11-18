import type { MetadataRoute } from 'next';
import discoveryPolicy from './lib/discovery-policy.cjs';
import { DISCOVERY_PAGES } from './lib/discovery-pages';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  if (!discoveryPolicy.publicIndexingEnabled()) return [];
  // No synthetic lastModified dates or unverified update frequencies.
  return Object.keys(DISCOVERY_PAGES).map(path => ({ url: `${discoveryPolicy.PUBLIC_ORIGIN}${path === '/' ? '' : path}` }));
}
