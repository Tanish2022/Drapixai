import type { MetadataRoute } from 'next';
import discoveryPolicy from './lib/discovery-policy.cjs';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  // Crawlers must be able to read noindex. robots.txt is not access control;
  // private staging still requires the separate authenticated network boundary.
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(discoveryPolicy.publicIndexingEnabled()
      ? { sitemap: `${discoveryPolicy.PUBLIC_ORIGIN}/sitemap.xml` } : {}),
  };
}
