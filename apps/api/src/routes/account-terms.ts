import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { resolveActiveApiKey, promoteTermsDashboardKey } from '../lib/api-key-auth';
import { CURRENT_TERMS, hasCurrentAccountTerms, recordAccountTermsAcceptance, validateTermsAcceptance, TERMS_PENDING_SCOPE } from '../lib/account-terms';
import { ADMIN_MFA_SCOPE, requiresAdminMfa } from '../lib/admin-mfa';
import { requireDashboardProxy } from '../lib/dashboard-proxy-auth';
import { createRateLimitMiddleware } from '../lib/rate-limit';

const router = Router();
const prisma = new PrismaClient();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); next(); });
router.use(requireDashboardProxy);
router.use(createRateLimitMiddleware(120, 60_000));
const acceptanceLimit = createRateLimitMiddleware(10, 15 * 60_000);

const resolveAccount = async (authorization: string | undefined) => {
  const key = await resolveActiveApiKey(prisma, authorization, { allowUnacceptedTerms: true });
  if (!key || key.kind !== 'dashboard') return null;
  const scopes = key.scopes.split(',');
  if (!scopes.includes('dashboard') && !scopes.includes(TERMS_PENDING_SCOPE)) return null;
  const user = await prisma.user.findUnique({ where: { id: key.userId } });
  if (!user?.emailVerifiedAt) return null;
  if (requiresAdminMfa(user.email, user.role) && !scopes.includes(ADMIN_MFA_SCOPE)) return null;
  return { key, user };
};

router.get('/', async (req, res) => {
  try {
    const account = await resolveAccount(req.headers.authorization);
    if (!account) return res.status(401).json({ error: 'ACCOUNT_SESSION_REQUIRED' });
    const accepted = !account.key.scopes.split(',').includes(TERMS_PENDING_SCOPE)
      && await hasCurrentAccountTerms(prisma, account.user.id);
    return res.json({ accepted, version: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash });
  } catch { return res.status(503).json({ error: 'TERMS_STATUS_UNAVAILABLE' }); }
});

router.post('/', acceptanceLimit, async (req, res) => {
  try {
    const account = await resolveAccount(req.headers.authorization);
    if (!account) return res.status(401).json({ error: 'ACCOUNT_SESSION_REQUIRED' });
    const error = validateTermsAcceptance(req.body);
    if (error) return res.status(400).json({ error });
    await prisma.$transaction(async tx => {
      await promoteTermsDashboardKey(tx, account.key);
      await recordAccountTermsAcceptance(tx, account.user.id, req.body, 'authenticated_account');
    });
    return res.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') return res.status(401).json({ error: 'ACCOUNT_SESSION_REQUIRED' });
    return res.status(503).json({ error: 'TERMS_ACCEPTANCE_UNAVAILABLE' });
  }
});

export default router;
