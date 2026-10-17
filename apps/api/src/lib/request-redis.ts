import { createClient } from 'redis';
import { formatLogError } from './security';

const REQUEST_TIMEOUT_MS = 3000;
const MAX_PENDING_REQUESTS = 256;

type Generation = {
  client: ReturnType<typeof createClient>;
  connected: boolean;
  retired: boolean;
  connecting?: Promise<unknown>;
};

// Request-scoped Redis work must not survive as an offline command backlog.
// Each purpose retains one healthy connection; a failed generation is discarded.
export const createRequestRedis = (purpose: string) => {
  let active: Generation | undefined;
  let pending = 0;

  const retire = async (generation: Generation) => {
    generation.retired = true;
    if (active === generation) active = undefined;
    // Before TCP connects node-redis has not yet assigned its socket. Let its
    // bounded connection attempt settle; the connect listener disposes a late
    // transport before any application command is allowed to run.
    if ((generation.connected || generation.client.isReady) && generation.client.isOpen) {
      await generation.client.disconnect().catch(() => undefined);
    }
  };

  const current = () => {
    if (active) return active;
    const client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      disableOfflineQueue: true,
      commandsQueueMaxLength: MAX_PENDING_REQUESTS,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    const generation: Generation = { client, connected: false, retired: false };
    client.on('connect', () => {
      generation.connected = true;
      if (generation.retired) void retire(generation);
    });
    client.on('error', (error) => {
      if (process.env.NODE_ENV !== 'test') console.error(`${purpose} Redis connection error:`, formatLogError(error));
      void retire(generation);
    });
    active = generation;
    return generation;
  };

  const run = <T>(operation: (client: Generation['client']) => Promise<T>, timeoutCode = 'REDIS_REQUEST_TIMEOUT'): Promise<T> => {
    if (pending >= MAX_PENDING_REQUESTS) return Promise.reject(new Error('REDIS_REQUEST_CAPACITY'));
    let generation: Generation;
    try { generation = current(); } catch (error) { return Promise.reject(error); }
    pending++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (success: boolean, value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending--;
        if (success) resolve(value as T); else reject(value);
      };
      const timer = setTimeout(() => {
        void retire(generation);
        finish(false, new Error(timeoutCode));
      }, REQUEST_TIMEOUT_MS);
      void (async () => {
        if (!generation.client.isReady) {
          generation.connecting ??= Promise.resolve().then(() => {
            if (generation.retired) throw new Error('REDIS_REQUEST_CANCELLED');
            return generation.client.connect();
          });
          await generation.connecting;
        }
        if (generation.retired) throw new Error('REDIS_REQUEST_CANCELLED');
        const value = await operation(generation.client);
        if (generation.retired) throw new Error('REDIS_REQUEST_CANCELLED');
        return value;
      })().then(value => finish(true, value), error => {
        void retire(generation);
        finish(false, error);
      });
    });
  };

  const close = async () => { if (active) await retire(active); };
  return { run, close };
};
