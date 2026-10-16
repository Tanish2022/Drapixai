// Test-harness boundary only. Never infer approval from an application's .env.
export const requireDisposableDatabase = (env: NodeJS.ProcessEnv): string => {
  const value = env.DATABASE_URL || '';
  let allowed = false;
  try {
    const target = new URL(value);
    const name = decodeURIComponent(target.pathname.slice(1));
    const permittedOptions = new Set(['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'socket_timeout']);
    allowed = ['postgres:', 'postgresql:'].includes(target.protocol)
      && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
      && !target.hash
      && !name.includes('/') && !name.includes('\\')
      && (/(?:^|[_-])(p0|test|disposable)(?:$|[_-])/i.test(name) || name === 'drapixai_launch_gate')
      && [...target.searchParams.keys()].every((key) => permittedOptions.has(key));
  } catch { /* Refuse without exposing the supplied URL or credentials. */ }
  if (!allowed || env.DRAPIXAI_DISPOSABLE_DB_APPROVAL !== 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE') {
    throw new Error('Billing database tests require an explicitly approved loopback disposable DATABASE_URL');
  }
  return value;
};
