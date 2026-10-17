import assert from 'assert';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createClient } from 'redis';
import { createRateLimitMiddleware, closeRateLimitForTests, RATE_LIMIT_CONSUME_SCRIPT } from '../lib/rate-limit';

// Called only by the guarded disposable-Redis suite. Clean up exact fixture keys
// and the synthetic ACL user; never flush a database or change an existing user.
export const verifyRateLimitRedis = async (control: ReturnType<typeof createClient>, redisUrl: string) => {
  const prefix = `rate-limit-fixture-${crypto.randomBytes(12).toString('hex')}`;
  const fixtureKeys: string[] = [];
  const key = (suffix: string) => { const value = `${prefix}:${suffix}`; fixtureKeys.push(value); return value; };
  const evaluate = (client: ReturnType<typeof createClient>, name: string, ttl = 30000) =>
    client.eval(RATE_LIMIT_CONSUME_SCRIPT, { keys: [name], arguments: [String(ttl)] });
  const second = createClient({ url: redisUrl });
  const username = prefix;
  const password = crypto.randomBytes(32).toString('hex');
  const restrictedUrl = new URL(redisUrl); restrictedUrl.username = username; restrictedUrl.password = password;
  const restricted = createClient({ url: restrictedUrl.href });
  second.on('error', () => {}); restricted.on('error', () => {});
  let aclCreated = false;
  const realNow = Date.now;
  try {
    await second.connect();
    const shared = key('replicas');
    const counts = await Promise.all(Array.from({ length: 32 }, (_, index) => evaluate(index % 2 ? control : second, shared)));
    assert.deepStrictEqual(counts.map(Number).sort((a, b) => a-b), Array.from({ length: 32 }, (_, i) => i+1));
    assert.ok(await control.pTTL(shared) > 0, 'Concurrent replica consumption must leave a bounded counter');

    const orphan = key('orphan'); await control.set(orphan, '17');
    assert.equal(await control.pTTL(orphan), -1);
    assert.equal(await evaluate(control, orphan), 18, 'Repair must preserve already consumed requests');
    assert.ok(await control.pTTL(orphan) > 0);
    const bounded = key('bounded'); await control.set(bounded, '9', { PX: 5000 });
    const beforeTtl = await control.pTTL(bounded);
    assert.equal(await evaluate(control, bounded), 10);
    assert.ok(await control.pTTL(bounded) <= beforeTtl, 'Consumption must not slide an existing expiry');

    const expiring = key('expiry'); assert.equal(await evaluate(control, expiring, 50), 1);
    const expiryDeadline = realNow() + 3000;
    while (await control.exists(expiring) && realNow() < expiryDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await control.exists(expiring), 0, 'A consumed rate-limit bucket must actually expire');

    assert.equal(await control.sendCommand(['ACL', 'GETUSER', username]), null, 'Refuse to modify an existing ACL user');
    await control.sendCommand(['ACL', 'SETUSER', username, 'on', `>${password}`, `~${prefix}:*`, '+eval', '+pttl', '+incr']);
    aclCreated = true; await restricted.connect();
    // Real negative control reproduces old INCR -> denied PEXPIRE behavior.
    const legacy = key('legacy'); await restricted.incr(legacy);
    await assert.rejects(restricted.pExpire(legacy, 30000));
    assert.equal(await control.pTTL(legacy), -1, 'Old separate commands leave a persistent counter');
    const rejected = key('rejected');
    await assert.rejects(evaluate(restricted, rejected));
    assert.equal(await control.exists(rejected), 0, 'Denied expiry setup must not create an unbounded counter');
    const deniedRepair = key('denied-repair'); await control.set(deniedRepair, '11');
    await assert.rejects(evaluate(restricted, deniedRepair));
    assert.equal(await control.get(deniedRepair), '11', 'Denied repair must not increment an unbounded counter');
    await assert.rejects(control.eval(RATE_LIMIT_CONSUME_SCRIPT, { keys: [key('invalid-ttl')], arguments: ['invalid'] }));
    assert.equal(await control.exists(fixtureKeys.at(-1)!), 0, 'Invalid expiry must fail before counter creation');

    // Freeze only the application's bucket clock to avoid a wall-clock boundary
    // race in the middleware test. Redis itself still uses its real expiry clock.
    const windowMs = 60000;
    const now = Math.floor(realNow()/windowMs)*windowMs + windowMs/2;
    Date.now = () => now;
    const actualKey = `drapixai:rate-limit:${crypto.createHash('sha256').update(prefix).digest('hex')}:${Math.floor(now/windowMs)}`;
    fixtureKeys.push(actualKey);
    const guard = createRateLimitMiddleware(5, windowMs, () => prefix);
    let accepted = 0;
    const statuses = await Promise.all(Array.from({ length: 24 }, async () => {
      const headers = new Map<string, string>();
      const res = { statusCode: 200, setHeader(name: string, value: string) { headers.set(name, value); },
        status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
      await guard({} as Request, res as unknown as Response, () => { accepted++; });
      if (res.statusCode === 429) assert.ok(Number(headers.get('Retry-After')) >= 1);
      assert.ok(Number(headers.get('RateLimit-Remaining')) >= 0);
      return res.statusCode;
    }));
    assert.equal(accepted, 5); assert.equal(statuses.filter(code => code === 429).length, 19);
    assert.equal(await control.get(actualKey), '24'); assert.ok(await control.pTTL(actualKey) > 0);
    console.log('PASS real Redis rate limits: 32 two-client claims; orphan repair without reset; non-sliding TTL; physical expiry; ACL failure negative control; 24 middleware requests admit 5 and reject 19');
  } finally {
    Date.now = realNow;
    await closeRateLimitForTests();
    if (restricted.isOpen) await restricted.disconnect();
    if (second.isOpen) await second.quit();
    if (aclCreated) await control.sendCommand(['ACL', 'DELUSER', username]);
    if (fixtureKeys.length) await control.del(fixtureKeys);
  }
};
