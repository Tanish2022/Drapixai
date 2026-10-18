import assert from 'node:assert/strict';
import { validateAuthHttpFixtureEnv } from './auth-http-database-tests';

const accepted: NodeJS.ProcessEnv = {
  NODE_ENV:'production',DATABASE_URL:'postgresql://fixture@127.0.0.1/drapixai_auth_http_test',
  REDIS_URL:'redis://127.0.0.1:6379/15',
  DRAPIXAI_DISPOSABLE_DB_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_DATABASE',
  DRAPIXAI_DISPOSABLE_HTTP_APPROVAL:'I_ACKNOWLEDGE_DISPOSABLE_HTTP_FIXTURE',
  DRAPIXAI_DASHBOARD_PROXY_TOKEN:'x'.repeat(40),
};
assert.equal(validateAuthHttpFixtureEnv(accepted).pathname,'/15');
const denied: Array<[string,NodeJS.ProcessEnv]> = [
  ['database approval missing',{DRAPIXAI_DISPOSABLE_DB_APPROVAL:''}],
  ['HTTP approval missing',{DRAPIXAI_DISPOSABLE_HTTP_APPROVAL:''}],
  ['remote PostgreSQL',{DATABASE_URL:'postgresql://fixture@external.example.invalid/drapixai_auth_http_test'}],
  ['non-test database',{DATABASE_URL:'postgresql://fixture@127.0.0.1/production'}],
  ['nested database path',{DATABASE_URL:'postgresql://fixture@127.0.0.1/drapixai_auth_http_test/production'}],
  ['database options outside guard',{DATABASE_URL:'postgresql://fixture@127.0.0.1/drapixai_auth_http_test?sslmode=disable'}],
  ['remote Redis',{REDIS_URL:'redis://external.example.invalid:6379/15'}],
  ['default Redis DB',{REDIS_URL:'redis://127.0.0.1:6379/0'}],
  ['non-Redis scheme',{REDIS_URL:'https://127.0.0.1/15'}],
  ['SMTP configured',{SMTP_HOST:'smtp.example.invalid'}],
  ['operator identity configured',{DRAPIXAI_ADMIN_EMAIL:'operator@example.invalid'}],
  ['operator authenticator configured',{DRAPIXAI_ADMIN_TOTP_SECRET:'a'.repeat(20)}],
  ['weak proxy credential',{DRAPIXAI_DASHBOARD_PROXY_TOKEN:'short'}],
  ['non-production route mode',{NODE_ENV:'test'}],
];
for(const [name,patch] of denied) assert.throws(()=>validateAuthHttpFixtureEnv({...accepted,...patch}),Error,name);
console.log('PASS HTTP fixture guard: one positive and fourteen rejection controls, no services or network');
