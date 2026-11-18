import { randomUUID } from 'crypto';
import { createRequestRedis } from './request-redis';
import { formatLogError } from './security';

const redis = createRequestRedis('Maintenance');
const local = new Set<string>();
const LEASE_MS = 15 * 60_000;
const OWNED = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end `;

export const withMaintenanceLease = (name: string, work: () => Promise<unknown>) => async () => {
  if (local.has(name)) return;
  local.add(name);
  const key = `drapixai:maintenance:${name}`;
  const token = randomUUID();
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    if (!await redis.run(client => client.set(key, token, { NX: true, PX: LEASE_MS }))) return;
    heartbeat = setInterval(() => {
      void redis.run(client => client.eval(`${OWNED}return redis.call('PEXPIRE', KEYS[1], ARGV[2])`, {
        keys: [key], arguments: [token, String(LEASE_MS)],
      })).then(renewed => {
        if (renewed !== 1) console.warn('Maintenance lease lost:', name);
      }).catch(() => console.warn('Maintenance lease renewal failed:', name));
    }, LEASE_MS / 3);
    heartbeat.unref();
    await work();
  } catch (error) {
    console.error('Scheduled maintenance failed:', name, formatLogError(error));
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
      await redis.run(client => client.eval(`${OWNED}return redis.call('DEL', KEYS[1])`, {
        keys: [key], arguments: [token],
      })).catch(() => console.warn('Maintenance lease release failed:', name));
    }
    local.delete(name);
  }
};
