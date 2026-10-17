const expiredResponse = () => new Response(JSON.stringify({ error: 'ADMIN_SESSION_REQUIRED' }), {
  status: 401, headers: { 'Content-Type': 'application/json' },
});

export const createAdminFetch = (onExpired: () => void) => {
  let expired = false;
  return async (path: string, init?: RequestInit) => {
    if (expired) return expiredResponse();
    const response = await fetch(`/api/admin/proxy/${path}`, init);
    if (expired) {
      void response.body?.cancel().catch(() => undefined);
      return expiredResponse();
    }
    if (response.status === 401 || response.status === 403) {
      expired = true;
      onExpired();
    }
    return response;
  };
};
