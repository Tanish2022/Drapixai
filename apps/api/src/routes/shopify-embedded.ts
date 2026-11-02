import crypto from 'node:crypto';
import { lockShopifyLifecycle } from '../services/shopify-catalog-state';
import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createRateLimitMiddleware } from '../lib/rate-limit';
import { generateLinkToken, hashLinkToken, normalizeShopDomain, verifyShopifyQueryHmac } from '../lib/shopify-auth';
import { verifyShopifyIdToken, ShopifyIdentity } from '../lib/shopify-id-token';
import { renderShopifyAppHome } from '../lib/shopify-app-home';
import { runDatabaseTransaction } from '../lib/database-transaction';
import { assertShopifyTokenLease, encryptedShopifyTokenData, requestShopifyOfflineTokens, requireShopifyAccountOwner, withShopifyTokenLease } from '../services/shopify-tokens';
import { fetchShopifyShop } from '../services/shopify';

const router = Router(), prisma = new PrismaClient();
type EmbeddedRequest = Request & {shopifyIdentity?: ShopifyIdentity};
router.use((_req, res, next) => {res.set({'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});next();});
const identity = (req: EmbeddedRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || '';
    if (!/^Bearer [A-Za-z0-9_.-]+$/.test(header)) throw new Error();
    req.shopifyIdentity = verifyShopifyIdToken(header.slice(7));return next();
  } catch {return res.status(401).json({error:'INVALID_SHOPIFY_ID_TOKEN'});}
};
const perShop = createRateLimitMiddleware(10, 60000, req => `shopify-embedded:${(req as EmbeddedRequest).shopifyIdentity!.shop}`);

router.get('/app', createRateLimitMiddleware(60, 60000), (req, res) => {
  // The document exposes no merchant data. Authenticate shop context before
  // granting iframe ancestry; all data/actions independently require an ID token.
  let shop: string | null = null;
  try {if (req.query.id_token) shop = verifyShopifyIdToken(req.query.id_token).shop;} catch { /* try signed launch instead */ }
  if (!shop) {
    const raw = req.originalUrl.split('?')[1] || '', timestamp = Number(req.query.timestamp);
    try {if (Math.abs(Date.now()/1000-timestamp) <= 300 && verifyShopifyQueryHmac(raw)) shop = normalizeShopDomain(req.query.shop);} catch { /* fail closed */ }
  }
  const nonce = crypto.randomBytes(24).toString('base64');
  if (!shop || !process.env.SHOPIFY_API_KEY) {
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    return res.status(401).type('text').send('Open DrapixAI from Shopify Admin.');
  }
  res.removeHeader('X-Frame-Options');
  res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.shopify.com/shopifycloud/app-bridge.js; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://${shop} https://admin.shopify.com`);
  return res.type('html').send(renderShopifyAppHome(process.env.SHOPIFY_API_KEY, nonce));
});
router.get('/embedded/status', createRateLimitMiddleware(60, 60000), identity, async (req: EmbeddedRequest, res) => {
  const installation = await prisma.shopifyInstallation.findUnique({where:{shopDomain:req.shopifyIdentity!.shop},select:{status:true,userId:true}});
  return res.json({connected:installation?.status === 'active' && Boolean(installation.userId)});
});
router.post('/embedded/connect', createRateLimitMiddleware(20, 60000), identity, perShop, async (req: EmbeddedRequest, res) => {
  const {shop, subject, token} = req.shopifyIdentity!;
  try {
    const web = new URL(process.env.DRAPIXAI_WEB_BASE_URL || '');
    if (web.protocol !== 'https:' || web.username || web.password || web.search || web.hash || !['','/'].includes(web.pathname)) throw new Error('SHOPIFY_CONFIGURATION_INCOMPLETE');
    const result = await withShopifyTokenLease(prisma, shop, async lease => {
      await requireShopifyAccountOwner(shop, token, subject);
      // The provider may have spent time verifying ownership. Never exchange a
      // now-expired ID token or use a tenant selected in request parameters.
      verifyShopifyIdToken(token);
      const tokens = await requestShopifyOfflineTokens(shop, {idToken:token});
      const info = await fetchShopifyShop(shop,tokens.accessToken), linkToken = generateLinkToken();
      const installation = await runDatabaseTransaction(prisma, async tx => {
        await lockShopifyLifecycle(tx, shop);
        await assertShopifyTokenLease(tx,lease);
        const current = await tx.shopifyInstallation.findUnique({where:{shopDomain:shop}});
        if (current?.status === 'redacting') throw new Error('SHOPIFY_REDACTION_PENDING');
        return tx.shopifyInstallation.upsert({where:{shopDomain:shop},
          create:{shopDomain:shop,shopName:info.name,primaryDomain:info.primaryDomain,...encryptedShopifyTokenData(tokens),linkTokenHash:hashLinkToken(linkToken),linkTokenExpiresAt:new Date(Date.now()+10*60000)},
          update:{catalogEpoch:{increment:1},catalogRequestedVersion:{increment:1},catalogNextAttemptAt:new Date(),catalogLeaseOwner:null,catalogLeaseExpiresAt:null,shopName:info.name,primaryDomain:info.primaryDomain,...encryptedShopifyTokenData(tokens),status:current?.userId?'active':'pending_link',installedAt:new Date(),uninstalledAt:null,linkTokenHash:hashLinkToken(linkToken),linkTokenExpiresAt:new Date(Date.now()+10*60000)}});
      });
      const url = new URL('/shopify/connect',web);url.searchParams.set('installation',String(installation.id));url.searchParams.set('token',linkToken);
      return {continueUrl:url.toString()};
    });
    return res.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SHOPIFY_ACCOUNT_OWNER_REQUIRED') return res.status(403).json({error:code});
    if (code === 'SHOPIFY_TOKEN_BUSY') return res.status(409).set('Retry-After','5').json({error:code});
    // Never serialize provider errors, tokens or user-profile payloads.
    return res.status(503).json({error:'SHOPIFY_CONNECTION_UNAVAILABLE'});
  }
});
export default router;
