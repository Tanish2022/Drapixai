// Explicit public discovery inventory. Never derive a sitemap from account routes.
export const DISCOVERY_PAGES = {
  '/': { title: 'Virtual Try-On for Fashion Brands', description: 'Explore DrapixAI virtual try-on for fashion brands: upper-body garment evaluation, storefront integration and a guided merchant workflow.' },
  '/virtual-try-on': { title: 'Virtual Try-On: Merchant Guide', description: 'How virtual try-on works for Shopify and custom stores, which garments to evaluate, and what to check before a merchant pilot.' },
  '/pricing': { title: 'Plans and Pricing', description: 'Review DrapixAI trial and subscription plans, usage allowances, cancellation terms and rollout considerations for fashion stores.' },
  '/docs': { title: 'Developer Quickstart', description: 'Prepare a product, request a scoped storefront token and review the DrapixAI Standard virtual try-on integration.' },
  '/help': { title: 'Help', description: 'Find DrapixAI merchant setup, garment preparation, integration, troubleshooting and support guidance.' },
  '/contact': { title: 'Contact', description: 'Contact DRAPIXAI SOFTWARE SOLUTIONS LLP in Ahmedabad, India for merchant enquiries, support, billing or privacy requests.' },
  '/privacy': { title: 'Privacy Policy', description: 'Read how DrapixAI handles account data, shopper photos, consent, retention and privacy requests.' },
  '/terms': { title: 'Terms of Service', description: 'Read the current terms governing access to and use of DrapixAI.' },
  '/cookies': { title: 'Cookie and Data Usage Notice', description: 'Understand DrapixAI session storage, optional analytics, external video and privacy controls.' },
  '/refund-policy': { title: 'Refund and Cancellation Policy', description: 'Review subscription cancellation, incorrect-charge refunds and applicable statutory rights for DrapixAI.' },
} as const;

export function discoveryPage(pathname: string) {
  return Object.hasOwn(DISCOVERY_PAGES, pathname)
    ? DISCOVERY_PAGES[pathname as keyof typeof DISCOVERY_PAGES] : undefined;
}
