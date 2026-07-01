import { NextFunction, Request, Response } from 'express';

export const DASHBOARD_PROXY_TOKEN_HEADER = 'x-drapixai-dashboard-proxy-token';

const getDashboardProxyToken = () => (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();

export const isDashboardProxyTokenConfigured = () => getDashboardProxyToken().length > 0;

export const requireDashboardProxy = (req: Request, res: Response, next: NextFunction) => {
  const expectedToken = getDashboardProxyToken();

  if (!expectedToken) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED' });
    }
    return next();
  }

  const providedToken = String(req.headers[DASHBOARD_PROXY_TOKEN_HEADER] || '').trim();
  if (providedToken !== expectedToken) {
    return res.status(403).json({ error: 'DASHBOARD_PROXY_REQUIRED' });
  }

  return next();
};