// Executes the real browser preference/tracking modules in an isolated window.
// No HTTP requests, personal data, database or application secrets are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../apps/web/node_modules/typescript');
const root = path.resolve(__dirname, '..');

function fixture() {
  const storage = new Map();
  const requests = [];
  const events = [];
  let blockedRead = false;
  let blockedWrite = false;
  let now = Date.now();
  const window = {
    location: { pathname: '/privacy' },
    localStorage: {
      getItem(key) { if (blockedRead) throw Error('storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedWrite) throw Error('storage blocked'); storage.set(key, value); },
      removeItem(key) { if (blockedWrite) throw Error('storage blocked'); storage.delete(key); },
    },
    dispatchEvent(event) { events.push(event.type); },
  };
  const shared = {
    window, document: { referrer: 'https://example.test/private/customer?token=secret' },
    navigator: { sendBeacon: (url, body) => { requests.push({ url, body }); return true; } },
    crypto: { randomUUID: () => '081e0a76-3fb5-4606-9d84-4e02e0d456ab' },
    Date: { now: () => now }, Blob, Event,
    fetch: () => { throw Error('unexpected network'); },
  };
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {};
    const source = fs.readFileSync(path.join(root, 'apps/web/app/lib', `${relative}.ts`), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, {
      ...shared, exports,
      require(name) {
        if (name === '@/app/lib/public-env') return { PUBLIC_API_BASE_URL: 'https://api.example.test' };
        if (name === './privacy-preferences') return load('privacy-preferences');
        throw Error(`Unexpected import: ${name}`);
      },
    }, { filename: `${relative}.ts` });
    modules.set(relative, exports);
    return exports;
  }
  return {
    prefs: load('privacy-preferences'), analytics: load('analytics'), storage, requests, events,
    blockRead() { blockedRead = true; }, blockWrite() { blockedWrite = true; },
    advance(ms) { now += ms; },
  };
}

(async () => {
  const f = fixture();
  f.storage.set(f.prefs.VISITOR_STORAGE_KEY, 'legacy-id');
  f.analytics.trackEvent('page_view');
  assert.equal(f.requests.length, 0, 'no preconsent event');
  assert.equal(f.storage.has(f.prefs.VISITOR_STORAGE_KEY), false, 'remove pre-existing ID without consent');
  assert.equal(f.prefs.savePrivacyPreferences(false), true);
  f.analytics.trackEvent('cta_click');
  assert.equal(f.requests.length, 0, 'rejection does not send analytics');
  assert.equal(f.prefs.savePrivacyPreferences(true), true);
  f.analytics.trackEvent('page_view');
  assert.equal(f.requests.length, 1, 'valid consent enables event');
  const payload = JSON.parse(await f.requests[0].body.text());
  assert.equal(payload.referrer, '', 'private referrer is not transmitted');
  assert.equal(payload.visitorId, '081e0a76-3fb5-4606-9d84-4e02e0d456ab');
  assert.deepEqual(Object.keys(JSON.parse(f.storage.get(f.prefs.PRIVACY_STORAGE_KEY))).sort(), ['analytics', 'expiresAt', 'updatedAt', 'version']);
  f.prefs.savePrivacyPreferences(false);
  f.analytics.trackEvent('page_view');
  assert.equal(f.requests.length, 1, 'withdrawal stops future tracking');
  assert.equal(f.storage.has(f.prefs.VISITOR_STORAGE_KEY), false);
  f.prefs.savePrivacyPreferences(true);
  f.advance(f.prefs.PRIVACY_MAX_AGE_MS + 1);
  f.analytics.trackEvent('page_view');
  assert.equal(f.requests.length, 1, 'expired consent stops tracking');
  assert.equal(f.storage.has(f.prefs.VISITOR_STORAGE_KEY), false);
  for (const value of ['broken', 'null', '{"version":1,"analytics":true}', JSON.stringify({ version: 2, analytics: true })]) {
    f.storage.set(f.prefs.PRIVACY_STORAGE_KEY, value);
    f.analytics.trackEvent('page_view');
    assert.equal(f.requests.length, 1, 'malformed/unknown consent cannot enable tracking');
  }
  const blocked = fixture();
  blocked.blockRead(); blocked.blockWrite();
  assert.doesNotThrow(() => blocked.analytics.trackEvent('page_view'));
  assert.equal(blocked.prefs.savePrivacyPreferences(true), false);
  blocked.analytics.trackEvent('cta_click');
  assert.equal(blocked.requests.length, 0, 'blocked storage fails closed');
  const readonly = fixture();
  readonly.prefs.savePrivacyPreferences(true);
  readonly.blockWrite();
  assert.equal(readonly.prefs.savePrivacyPreferences(false), false);
  readonly.analytics.trackEvent('page_view');
  assert.equal(readonly.requests.length, 0, 'failed write of withdrawal overrides old acceptance');
  const crossTab = fixture();
  crossTab.prefs.savePrivacyPreferences(true);
  crossTab.storage.delete(crossTab.prefs.PRIVACY_STORAGE_KEY);
  crossTab.analytics.trackEvent('page_view');
  assert.equal(crossTab.requests.length, 0, 'read current storage for every event after other-tab withdrawal');
  const minimal = fixture();
  minimal.prefs.savePrivacyPreferences(true);
  for (const path of ['/dashboard', '/onboarding/private-id', '/auth/login', '/settings?email=private@example.test']) {
    minimal.analytics.trackEvent('page_view', { path });
  }
  minimal.analytics.trackEvent('trial_signup');
  minimal.analytics.trackEvent('cta_click', { metadata: { target: 'private@example.test' } });
  assert.equal(minimal.requests.length, 0, 'private routes and unapproved events/labels cannot create analytics');
  minimal.analytics.trackEvent('page_view', { path: '/privacy?token=private#secret', metadata: { email: 'private@example.test' } });
  const minimalBody = JSON.parse(await minimal.requests[0].body.text());
  assert.equal(minimalBody.path, '/privacy');
  assert.deepEqual(minimalBody.metadata, {});
  assert.equal(minimalBody.analyticsConsent, true);
  const serverExports = {};
  const serverSource = fs.readFileSync(path.join(root, 'apps/api/src/lib/website-analytics.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(serverSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: serverExports });
  const parsed = serverExports.parseWebsiteAnalytics({ ...minimalBody, referrer: 'https://private.example.test/user', metadata: { email: 'private@example.test' } });
  assert.ok(parsed);
  assert.equal(parsed.referrer, null);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.metadata)), { consentVersion: 1 });
  for (const override of [{ analyticsConsent: false }, { analyticsConsent: 'true' }, { privacyPreferenceVersion: 2 },
    { path: '/dashboard' }, { path: '/privacy?token=secret' }, { visitorId: 'private@example.test' },
    { event: ['page_view'] }, { event: 'trial_signup' }, { event: 'cta_click', metadata: { target: 'private@example.test' } }]) {
    assert.equal(serverExports.parseWebsiteAnalytics({ ...minimalBody, ...override }), null, 'server rejects unapproved or sensitive analytics');
  }
  console.log('PASS website privacy: default/reject/accept/withdraw/expiry/malformed/blocked/read-only/cross-tab/referrer/private-route/metadata minimization and server rejection');
})().catch((error) => { console.error(error); process.exitCode = 1; });
