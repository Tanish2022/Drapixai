import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { inventoryShopperMedia } from '../lib/shopper-media-inventory';

type Reply = { body: string; status?: number };
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const listing = (versions: boolean, body = '', truncated: boolean | null = false): Reply => ({
  body: `<${versions ? 'ListVersionsResult' : 'ListBucketResult'} xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`
    + (truncated === null ? '' : `<IsTruncated>${truncated}</IsTruncated>`)
    + body + `</${versions ? 'ListVersionsResult' : 'ListBucketResult'}>`,
});
const object = (key: string) => `<Contents><Key>${xml(key)}</Key><Size>12</Size></Contents>`;
const version = (key: string, id = 'old-version') => `<Version><Key>${xml(key)}</Key><VersionId>${id}</VersionId><IsLatest>false</IsLatest><Size>12</Size></Version>`;
const marker = (key: string) => `<DeleteMarker><Key>${xml(key)}</Key><VersionId>deleted</VersionId><IsLatest>true</IsLatest></DeleteMarker>`;
const shopper = 'tryon-review/1/request-test/person.png';
const garment = 'tryon-review/1/request-test/garment.png';

const main = async () => {
  let reply: (url: URL) => Reply = (url) => listing(url.searchParams.has('versions'));
  let requests: URL[] = [];
  let handlerFailure: unknown;
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      requests.push(url);
      assert.equal(req.method, 'GET', 'Inventory must never change or download objects');
      assert.ok(['/privacy-test', '/privacy-test/'].includes(url.pathname), 'Only bucket inventory endpoints are allowed');
      const result = reply(url);
      res.writeHead(result.status || 200, { 'Content-Type': 'application/xml' });
      res.end(result.body);
    } catch (error) {
      handlerFailure = error;
      res.writeHead(500); res.end('<Error><Code>FixtureFailure</Code></Error>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const client = new S3Client({
    endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'synthetic-fixture', secretAccessKey: 'synthetic-fixture' },
  });
  let passed = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    requests = []; handlerFailure = undefined;
    try { await run(); } catch (error) { throw handlerFailure || error; }
    if (handlerFailure) throw handlerFailure;
    passed++;
    console.log(`PASS ${name}`);
  };
  const inventory = () => inventoryShopperMedia(client, 'privacy-test');
  const respond = (special: (url: URL, versions: boolean, prefix: string) => Reply | undefined) => {
    reply = (url) => special(url, url.searchParams.has('versions'), url.searchParams.get('prefix') || '')
      || listing(url.searchParams.has('versions'));
  };
  try {
    await check('empty current and historical listings are both inspected', async () => {
      respond(() => undefined);
      const result = await inventory();
      assert.ok(Object.values(result).every((value) => value === 0));
      assert.equal(requests.length, 6);
      assert.equal(requests.filter((url) => url.searchParams.has('versions')).length, 3);
    });
    await check('deleted shopper photo remains detectable as a noncurrent version', async () => {
      respond((_url, versions, prefix) => versions && prefix === 'tryon-review/'
        ? listing(true, version(shopper) + marker(shopper)) : undefined);
      const result = await inventory();
      assert.equal(result.shopperMediaObjectCount, 0);
      assert.equal(result.shopperMediaVersionCount, 1);
      assert.equal(result.deleteMarkerCount, 1);
      assert.ok(!JSON.stringify(result).includes(shopper), 'Reports must not contain object identities');
    });
    await check('historical legacy inputs and outputs are detected even with empty current listings', async () => {
      respond((_url, versions, prefix) => versions && prefix !== 'tryon-review/'
        ? listing(true, version(prefix + 'synthetic-image.png', 'null')) : undefined);
      const result = await inventory();
      assert.equal(result.legacyRenderMediaObjectCount, 0);
      assert.equal(result.legacyRenderMediaVersionCount, 2);
    });
    await check('known garment-only review assets are not shopper media', async () => {
      respond((_url, versions, prefix) => prefix === 'tryon-review/'
        ? listing(versions, versions ? version(garment) : object(garment)) : undefined);
      const result = await inventory();
      assert.equal(result.scannedObjects, 1);
      assert.equal(result.scannedObjectVersions, 1);
      assert.equal(result.shopperMediaVersionCount + result.shopperMediaObjectCount, 0);
      assert.equal(result.unclassifiedReviewObjectCount + result.unclassifiedReviewVersionCount, 0);
    });
    await check('unclassified review files require review instead of silently passing', async () => {
      respond((_url, versions, prefix) => prefix === 'tryon-review/'
        ? listing(versions, versions ? version(prefix + 'renamed-photo.bin') : object(prefix + 'renamed-photo.bin')) : undefined);
      const result = await inventory();
      assert.equal(result.unclassifiedReviewObjectCount, 1);
      assert.equal(result.unclassifiedReviewVersionCount, 1);
    });
    await check('delete markers alone are counted separately from image bytes', async () => {
      respond((_url, versions, prefix) => versions && prefix === 'tryon-review/' ? listing(true, marker(shopper)) : undefined);
      const result = await inventory();
      assert.equal(result.deleteMarkerCount, 1);
      assert.equal(result.shopperMediaVersionCount, 0);
    });
    await check('current listing follows continuation token to hidden later media', async () => {
      respond((url, versions, prefix) => !versions && prefix === 'tryon-review/'
        ? url.searchParams.has('continuation-token')
          ? listing(false, object(shopper))
          : listing(false, '<NextContinuationToken>page-2</NextContinuationToken>', true)
        : undefined);
      assert.equal((await inventory()).shopperMediaObjectCount, 1);
      assert.equal(requests[1].searchParams.get('continuation-token'), 'page-2');
    });
    await check('version listing forwards both markers for multiple versions of one key', async () => {
      respond((url, versions, prefix) => versions && prefix === 'tryon-review/'
        ? url.searchParams.has('key-marker')
          ? listing(true, version(shopper))
          : listing(true, marker(shopper) + `<NextKeyMarker>${shopper}</NextKeyMarker><NextVersionIdMarker>deleted</NextVersionIdMarker>`, true)
        : undefined);
      assert.equal((await inventory()).shopperMediaVersionCount, 1);
      const next = requests.find((url) => url.searchParams.has('key-marker'))!;
      assert.equal(next.searchParams.get('key-marker'), shopper);
      assert.equal(next.searchParams.get('version-id-marker'), 'deleted');
    });
    await check('truncated current listing without cursor fails closed', async () => {
      respond((_url, versions) => !versions ? listing(false, '', true) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_MISSING_CURSOR/);
    });
    await check('missing pagination state cannot be treated as complete', async () => {
      respond((_url, versions) => listing(versions, '', null));
      await assert.rejects(inventory(), /MEDIA_INVENTORY_INVALID_PAGINATION/);
    });
    await check('repeated current cursor stops instead of looping or passing', async () => {
      respond((_url, versions) => !versions ? listing(false, '<NextContinuationToken>repeat</NextContinuationToken>', true) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_REPEATED_CURSOR/);
      assert.equal(requests.length, 2);
    });
    await check('truncated version listing without key marker fails closed', async () => {
      respond((_url, versions) => versions ? listing(true, '', true) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_MISSING_CURSOR/);
    });
    await check('repeated version cursor stops instead of losing hidden versions', async () => {
      respond((_url, versions) => versions ? listing(true, `<NextKeyMarker>${shopper}</NextKeyMarker><NextVersionIdMarker>repeat</NextVersionIdMarker>`, true) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_REPEATED_CURSOR/);
      assert.equal(requests.length, 3);
    });
    await check('invalid version identity fails closed', async () => {
      respond((_url, versions) => versions ? listing(true, `<Version><Key>${shopper}</Key></Version>`) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_INVALID_VERSION/);
    });
    await check('unexpected key outside requested prefix fails closed', async () => {
      respond((_url, versions) => !versions ? listing(false, object('another-prefix/person.png')) : undefined);
      await assert.rejects(inventory(), /MEDIA_INVENTORY_INVALID_KEY/);
    });
    for (const [code, status] of [['AccessDenied', 403], ['NotImplemented', 501]] as const) {
      await check(`version listing ${code} cannot produce privacy PASS`, async () => {
        respond((_url, versions) => versions ? { status, body: `<Error><Code>${code}</Code></Error>` } : undefined);
        await assert.rejects(inventory(), (error: any) => error.name === code);
      });
    }
    console.log(`Shopper-media inventory: ${passed} checks passed (synthetic loopback S3 responses, no real bucket).`);
  } finally {
    client.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
