import assert from 'assert';
import { isTryOnIntakeEnabled, requireTryOnIntake } from '../lib/tryon-intake';

const originalNodeEnv = process.env.NODE_ENV;
const originalIntake = process.env.DRAPIXAI_TRYON_INTAKE_ENABLED;

try {
  process.env.NODE_ENV = 'production';
  delete process.env.DRAPIXAI_TRYON_INTAKE_ENABLED;
  assert.equal(isTryOnIntakeEnabled(), false, 'Production intake must fail closed without explicit configuration');

  process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = '1';
  assert.equal(isTryOnIntakeEnabled(), true);
  let continued = false;
  requireTryOnIntake({} as any, {} as any, () => { continued = true; });
  assert.equal(continued, true, 'Enabled intake must continue to the generation handler');

  process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = '0';
  const response = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: null as any,
    setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  requireTryOnIntake({} as any, response as any, () => assert.fail('Paused intake must not continue'));
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('x-drapixai-intake-status'), 'paused');
  assert.deepStrictEqual(response.body, {
    error: 'TRYON_TEMPORARILY_UNAVAILABLE',
    message: 'Virtual try-on is temporarily unavailable. Please retry shortly.',
  });

  process.env.NODE_ENV = 'test';
  delete process.env.DRAPIXAI_TRYON_INTAKE_ENABLED;
  assert.equal(isTryOnIntakeEnabled(), true, 'Local tests remain usable without production configuration');
  console.log('Try-on intake containment tests passed.');
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalIntake === undefined) delete process.env.DRAPIXAI_TRYON_INTAKE_ENABLED;
  else process.env.DRAPIXAI_TRYON_INTAKE_ENABLED = originalIntake;
}
