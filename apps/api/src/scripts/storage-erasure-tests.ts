import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { eraseStoredObjectVersions } from '../lib/storage-erasure';

type Entry = { key: string; id: string; latest: boolean; etag?: string };
type Request = { method: string; url: URL; headers: http.IncomingHttpHeaders };
type Reply = { status?: number; body?: string; headers?: Record<string, string> };
const key = 'tryon-review/fixture/person.png';
const sibling = key + '.other';
const bucket = 'erasure-fixture';
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const entry = (id: string, latest = false, objectKey = key): Entry => ({ key: objectKey, id, latest, etag: '"fixture-etag"' });
const versionXml = (value: Entry) => `<Version><Key>${escape(value.key)}</Key><VersionId>${escape(value.id)}</VersionId><IsLatest>${value.latest}</IsLatest>${value.etag ? `<ETag>${escape(value.etag)}</ETag>` : ''}</Version>`;
const listing = (body = '', truncated: boolean | null = false): Reply => ({ body: `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${truncated === null ? '' : `<IsTruncated>${truncated}</IsTruncated>`}${body}</ListVersionsResult>` });
const denied = (code = 'AccessDenied', status = 403): Reply => ({ status, body: `<Error><Code>${code}</Code></Error>` });

const main = async () => {
  let data: Entry[] = [];
  let markers: Entry[] = [];
  let requests: Request[] = [];
  let handlerFailure: unknown;
  let special: (request: Request) => Reply | undefined = () => undefined;
  const server = http.createServer((req, res) => {
    try {
      const request = { method: req.method || '', url: new URL(req.url || '/', 'http://127.0.0.1'), headers: req.headers };
      requests.push(request);
      const { method, url } = request;
      let reply = special(request);
      if (!reply && method === 'GET' && url.searchParams.has('versioning')) {
        reply = { body: '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>' };
      }
      if (!reply && method === 'GET') {
        assert.ok([`/${bucket}`, `/${bucket}/`].includes(url.pathname), 'Never download image contents');
        assert.ok(url.searchParams.has('versions'));
        const prefix = url.searchParams.get('prefix')!;
        reply = listing(data.filter(item => item.key.startsWith(prefix)).map(versionXml).join('')
          + markers.filter(item => item.key.startsWith(prefix)).map(item => `<DeleteMarker><Key>${escape(item.key)}</Key><VersionId>${item.id}</VersionId><IsLatest>${item.latest}</IsLatest></DeleteMarker>`).join(''));
      } else if (!reply && method === 'DELETE') {
        assert.equal(decodeURIComponent(url.pathname), `/${bucket}/${key}`, 'Deletion must match the exact owned key');
        const id = url.searchParams.get('versionId');
        assert.ok(id, 'Ordinary marker-only deletion is forbidden');
        assert.ok(!markers.some(item => item.id === id), 'Delete markers must survive');
        assert.equal(req.headers['x-amz-bypass-governance-retention'], undefined);
        if (id === 'null') assert.equal(req.headers['if-match'], '"fixture-etag"');
        data = data.filter(item => item.key !== key || item.id !== id);
        reply = { status: 204 };
      } else if (!reply && method === 'HEAD') {
        assert.equal(decodeURIComponent(url.pathname), `/${bucket}/${key}`);
        reply = data.some(item => item.key === key && item.latest) ? { status: 200 } : { status: 404 };
      }
      assert.ok(reply, 'Unexpected storage request');
      res.writeHead(reply.status || 200, { 'Content-Type': 'application/xml', ...reply.headers });
      res.end(reply.body || '');
    } catch (error) {
      handlerFailure = error;
      res.writeHead(500); res.end('<Error><Code>FixtureFailure</Code></Error>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, { S3_ENDPOINT: endpoint, S3_BUCKET: bucket, AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'synthetic-fixture', AWS_SECRET_ACCESS_KEY: 'synthetic-fixture', AWS_MAX_ATTEMPTS: '1' });
  const client = new S3Client({ endpoint, forcePathStyle: true, region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'synthetic-fixture', secretAccessKey: 'synthetic-fixture' } });
  // Import only after configuring the private loopback fixture. No .env is loaded.
  const { runTryOnReviewRetention } = await import('../services/review-retention');
  let passed = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    data = []; markers = []; requests = []; handlerFailure = undefined; special = () => undefined;
    try { await run(); } catch (error) { throw handlerFailure || error; }
    if (handlerFailure) throw handlerFailure;
    console.log(`PASS ${name}`); passed++;
  };
  const erase = () => eraseStoredObjectVersions(client, bucket, key);
  const noDeletes = () => assert.equal(requests.filter(item => item.method === 'DELETE').length, 0);
  const rejectInventory = async (reply: Reply, pattern: RegExp) => {
    special = ({ url }) => url.searchParams.has('versions') ? reply : undefined;
    await assert.rejects(erase(), pattern); noDeletes();
  };
  const retentionFixture = (url = `s3://${bucket}/${key}`) => {
    const row = { id: 1, requestId: 'synthetic', personImageUrl: url as string | null, resultImageUrl: null };
    let updates = 0;
    let failUpdate = false;
    let replacement: string | null = null;
    const audit: any[] = [];
    const prisma: any = {
      tryOnResult: {
        findMany: async () => row.personImageUrl ? [{ ...row }] : [],
        updateMany: async ({ where, data: values }: any) => {
          if (failUpdate) throw new Error('SYNTHETIC_DATABASE_FAILURE');
          if (replacement) row.personImageUrl = replacement;
          if (row.personImageUrl !== where.personImageUrl) return { count: 0 };
          updates++; Object.assign(row, values); return { count: 1 };
        },
      },
      $transaction: async (run: any) => run({ $executeRaw: async () => 1, securityAuditLog: {
        findFirst: async () => null, create: async ({ data: value }: any) => { audit.push(value); return value; },
      } }),
    };
    return { row, audit, updates: () => updates, crashUpdate: (value: boolean) => { failUpdate = value; },
      replaceReference: (value: string) => { replacement = value; },
      run: (dryRun = false) => runTryOnReviewRetention(prisma, { retentionDays: 0, batchSize: 10, dryRun }) };
  };
  try {
    await check('ambiguous or traversal-like object keys refuse any storage request', async () => {
      for (const invalid of ['', 'tryon-review/', 'tryon-review/../garments/keep.png', 'tryon-review/./person.png', 'tryon-review//person.png', 'tryon-review/\u0000person.png']) {
        await assert.rejects(eraseStoredObjectVersions(client, bucket, invalid), /OBJECT_KEY_REQUIRED/);
      }
      assert.equal(requests.length, 0);
    });
    await check('all data versions erased, current last; sibling and delete markers preserved', async () => {
      data = [entry('current', true), entry('old'), entry('sibling', true, sibling)];
      markers = [entry('marker')];
      assert.equal((await erase()).deletedVersions, 2);
      assert.deepEqual(requests.filter(r => r.method === 'DELETE').map(r => r.url.searchParams.get('versionId')), ['old', 'current']);
      assert.deepEqual(data, [entry('sibling', true, sibling)]);
      assert.equal(markers.length, 1);
    });
    await check('hidden historical version erased behind existing delete marker', async () => {
      data = [entry('hidden')]; markers = [entry('marker', true)];
      assert.equal((await erase()).deletedVersions, 1); assert.equal(data.length, 0);
    });
    await check('null version is explicitly deleted with an ETag precondition', async () => {
      data = [entry('null', true)]; assert.equal((await erase()).deletedVersions, 1);
    });
    await check('already erased data is safe to retry without deleting markers', async () => {
      markers = [entry('marker', true)]; assert.equal((await erase()).deletedVersions, 0); noDeletes();
    });
    await check('pagination completes before mutation and forwards both version markers', async () => {
      data = [entry('old'), entry('current', true)]; let lists = 0;
      special = ({ method, url }) => {
        if (method !== 'GET' || !url.searchParams.has('versions') || ++lists > 2) return undefined;
        if (lists === 1) return listing(versionXml(data[0]) + `<NextKeyMarker>${key}</NextKeyMarker><NextVersionIdMarker>old</NextVersionIdMarker>`, true);
        assert.equal(url.searchParams.get('key-marker'), key); assert.equal(url.searchParams.get('version-id-marker'), 'old');
        noDeletes(); return listing(versionXml(data[1]));
      };
      assert.equal((await erase()).deletedVersions, 2);
    });
    for (const [name, reply, pattern] of [
      ['missing completeness flag', listing('', null), /INCOMPLETE_INVENTORY/],
      ['truncated listing without both cursors', listing(`<NextKeyMarker>${key}</NextKeyMarker>`, true), /MISSING_CURSOR/],
      ['repeated cursor', listing(`<NextKeyMarker>${key}</NextKeyMarker><NextVersionIdMarker>repeat</NextVersionIdMarker>`, true), /INVALID_PAGINATION/],
      ['missing version identity', listing(`<Version><Key>${key}</Key><IsLatest>true</IsLatest></Version>`), /INVALID_ENTRY/],
      ['missing current-version state', listing(`<Version><Key>${key}</Key><VersionId>x</VersionId></Version>`), /INVALID_ENTRY/],
      ['foreign prefix', listing(versionXml(entry('x', true, 'garments/keep.png'))), /INVALID_ENTRY/],
      ['duplicate version identity', listing(versionXml(entry('x')) + versionXml(entry('x'))), /INVALID_INVENTORY/],
      ['null version without ETag', listing(versionXml({ ...entry('null'), etag: undefined })), /ETAG_REQUIRED/],
      ['denied version listing', denied(), /AccessDenied/],
      ['unsupported version listing', denied('NotImplemented', 501), /NotImplemented/],
    ] as Array<[string, Reply, RegExp]>) {
      await check(`${name} refuses deletion`, () => rejectInventory(reply, pattern));
    }
    await check('delete success cannot hide retained versions', async () => {
      data = [entry('retained')]; special = ({ method }) => method === 'DELETE' ? { status: 204 } : undefined;
      await assert.rejects(erase(), /VERSIONS_REMAIN/);
    });
    await check('disabled, suspended or missing versioning state refuses all mutation', async () => {
      for (const state of ['', 'Suspended', 'Unknown']) {
        special = ({ url }) => url.searchParams.has('versioning') ? {
          body: `<VersioningConfiguration>${state ? `<Status>${state}</Status>` : ''}</VersioningConfiguration>`,
        } : undefined;
        await assert.rejects(erase(), /VERSIONING_REQUIRED/); noDeletes();
      }
    });
    await check('versioning suspended after inventory refuses deletion', async () => {
      data = [entry('null')]; let policies = 0;
      special = ({ url }) => url.searchParams.has('versioning') && ++policies > 1
        ? { body: '<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>' } : undefined;
      await assert.rejects(erase(), /VERSIONING_REQUIRED/); noDeletes();
    });
    await check('current object surviving an empty version response fails verification', async () => {
      special = ({ method }) => method === 'HEAD' ? { status: 200 } : undefined;
      await assert.rejects(erase(), /CURRENT_OBJECT_REMAINS/);
    });
    await check('unexpected delete-marker response fails verification', async () => {
      data = [entry('x')]; special = ({ method }) => method === 'DELETE' ? { status: 204, headers: { 'x-amz-delete-marker': 'true' } } : undefined;
      await assert.rejects(erase(), /UNEXPECTED_DELETE_MARKER/);
    });
    await check('retention clears its reference only after verified erasure', async () => {
      data = [entry('hidden')]; markers = [entry('marker', true)]; const fixture = retentionFixture();
      const result = await fixture.run(); assert.equal(result.imagesDeleted, 1); assert.deepEqual(result.failures, []);
      assert.equal(fixture.row.personImageUrl, null); assert.equal(fixture.updates(), 1);
      assert.equal(fixture.audit[0].outcome, 'success'); assert.ok(requests.some(r => r.method === 'HEAD'));
    });
    for (const [label, method, response] of [
      ['Object Lock or delete permission denial', 'DELETE', denied()],
      ['provider precondition rejection', 'DELETE', denied('PreconditionFailed', 412)],
      ['verification access denial', 'HEAD', denied()],
    ] as Array<[string, string, Reply]>) {
      await check(`${label} preserves the database reference for retry`, async () => {
        data = [entry('null', true)]; special = r => r.method === method ? response : undefined;
        const fixture = retentionFixture(); const result = await fixture.run();
        assert.equal(result.imagesDeleted, 0); assert.equal(result.failures.length, 1);
        assert.equal(fixture.row.personImageUrl, `s3://${bucket}/${key}`); assert.equal(fixture.updates(), 0);
        assert.equal(fixture.audit[0].outcome, 'failure');
      });
    }
    await check('foreign bucket and wrong prefix cannot authorize storage requests', async () => {
      for (const url of [`s3://another-bucket/${key}`, `s3://${bucket}/garments/keep.png`, `s3://${bucket}/tryon-review/`]) {
        const fixture = retentionFixture(url); const result = await fixture.run();
        assert.equal(result.failures.length, 1); assert.equal(fixture.row.personImageUrl, url);
      }
      assert.equal(requests.length, 0);
    });
    await check('retention dry run does not mutate or access storage', async () => {
      const fixture = retentionFixture(); await fixture.run(true);
      assert.equal(requests.length, 0); assert.equal(fixture.updates(), 0); assert.equal(fixture.audit.length, 0);
    });
    await check('database failure after erasure can retry and clear the surviving reference', async () => {
      data = [entry('hidden')]; const fixture = retentionFixture(); fixture.crashUpdate(true);
      assert.equal((await fixture.run()).failures.length, 1); assert.equal(data.length, 0);
      assert.ok(fixture.row.personImageUrl); fixture.crashUpdate(false);
      assert.deepEqual((await fixture.run()).failures, []); assert.equal(fixture.row.personImageUrl, null);
    });
    await check('a concurrent replacement reference cannot be cleared using an older deletion result', async () => {
      data = [entry('hidden')]; const fixture = retentionFixture();
      const replacement = `s3://${bucket}/tryon-review/new/person.png`;
      fixture.replaceReference(replacement);
      assert.equal((await fixture.run()).failures.length, 1);
      assert.equal(fixture.row.personImageUrl, replacement); assert.equal(fixture.updates(), 0);
      assert.equal(fixture.audit[0].outcome, 'failure');
    });
    console.log(`Storage erasure: ${passed} checks passed (loopback S3 XML; retention database calls are test doubles).`);
  } finally {
    client.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
};
main().catch(error => { console.error(error); process.exitCode = 1; });
