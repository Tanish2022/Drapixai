import { SERVER_API_BASE_URL } from './server-env';

export const accountTermsHeaders = (apiKey: string) => {
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  const proxyToken = (process.env.DRAPIXAI_DASHBOARD_PROXY_TOKEN || '').trim();
  if (proxyToken) headers.set('x-drapixai-dashboard-proxy-token', proxyToken);
  return headers;
};

export const readAccountTermsState = async (apiKey: string) => {
  const response = await fetch(`${SERVER_API_BASE_URL}/auth/terms`, {
    headers: accountTermsHeaders(apiKey), cache: 'no-store', signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response?.ok) return { status: response?.status === 401 ? 401 : 503, state: null };
  const state = await response.json().catch(() => null);
  if (typeof state?.accepted !== 'boolean' || typeof state?.version !== 'string'
      || !/^[a-f0-9]{64}$/.test(state?.documentHash || '')) return { status: 503, state: null };
  return { status: 200, state: { accepted: state.accepted as boolean, version: state.version as string, documentHash: state.documentHash as string } };
};
