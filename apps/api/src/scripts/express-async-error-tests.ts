import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { NextFunction, Request, Response } from 'express';

async function main() {
  const app = express();

  app.get('/async-failure', async () => {
    await Promise.resolve();
    throw new Error('EXPECTED_ASYNC_FAILURE');
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(503).json({ error: 'ASYNC_FAILURE_HANDLED', detail: error.message });
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/async-failure`);
    const body = await response.json() as { error?: string; detail?: string };

    assert.equal(response.status, 503);
    assert.equal(body.error, 'ASYNC_FAILURE_HANDLED');
    assert.equal(body.detail, 'EXPECTED_ASYNC_FAILURE');
    console.log('Express async error propagation test passed.');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
