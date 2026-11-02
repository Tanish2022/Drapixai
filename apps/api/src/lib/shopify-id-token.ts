import jwt from 'jsonwebtoken';
import { normalizeShopDomain } from './shopify-auth';

export type ShopifyIdentity = { shop: string; subject: string; token: string };
// No query/body shop parameter may select the tenant for an authenticated call.
export const verifyShopifyIdToken = (token: unknown): ShopifyIdentity => {
  const secret = process.env.SHOPIFY_API_SECRET, clientId = process.env.SHOPIFY_API_KEY;
  if (!secret || !clientId || typeof token !== 'string' || token.length > 8192 || token.split('.').length !== 3) {
    throw new Error('INVALID_SHOPIFY_ID_TOKEN');
  }
  try {
    const claims = jwt.verify(token, secret, {algorithms: ['HS256'], audience: clientId, clockTolerance: 0});
    if (typeof claims === 'string') throw new Error();
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== clientId || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.nbf) || !Number.isSafeInteger(claims.iat)
      || claims.exp! <= now || claims.nbf! > now || claims.iat! > now || claims.exp! - claims.iat! > 120
      || !/^[1-9][0-9]{0,29}$/.test(String(claims.sub || ''))) throw new Error();
    const dest = new URL(String(claims.dest)), issuer = new URL(String(claims.iss));
    const shop = normalizeShopDomain(dest.hostname);
    if (!shop || dest.origin !== `https://${shop}` || !['', '/'].includes(dest.pathname) || dest.search || dest.hash
      || dest.username || dest.password || issuer.origin !== dest.origin || issuer.pathname !== '/admin'
      || issuer.search || issuer.hash || issuer.username || issuer.password) throw new Error();
    return {shop, subject: String(claims.sub), token};
  } catch { throw new Error('INVALID_SHOPIFY_ID_TOKEN'); }
};
