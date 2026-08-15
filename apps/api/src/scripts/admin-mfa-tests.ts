import assert from 'assert';
import { verifyAdminTotp } from '../lib/admin-mfa';

const previous = {
  nodeEnv: process.env.NODE_ENV,
  adminEmail: process.env.DRAPIXAI_ADMIN_EMAIL,
  totpSecret: process.env.DRAPIXAI_ADMIN_TOTP_SECRET,
};

try {
  process.env.NODE_ENV = 'production';
  process.env.DRAPIXAI_ADMIN_EMAIL = 'admin@drapixai.test';
  process.env.DRAPIXAI_ADMIN_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  const rfcTimestampMs = 59_000;
  assert.equal(verifyAdminTotp('admin@drapixai.test', '287082', rfcTimestampMs), true);
  assert.equal(verifyAdminTotp('admin@drapixai.test', '000000', rfcTimestampMs), false);
  assert.equal(verifyAdminTotp('admin@drapixai.test', '', rfcTimestampMs), false);
  assert.equal(
    verifyAdminTotp('id-matched-admin@drapixai.test', '287082', rfcTimestampMs, true),
    true,
    'A system administrator matched by configured ID must still pass TOTP',
  );
  assert.equal(
    verifyAdminTotp('ordinary-user@drapixai.test', '', rfcTimestampMs, false),
    true,
    'Ordinary brand users must not be forced through the system-admin TOTP secret',
  );

  delete process.env.DRAPIXAI_ADMIN_TOTP_SECRET;
  assert.equal(
    verifyAdminTotp('admin@drapixai.test', '287082', rfcTimestampMs),
    false,
    'Production administrator login must fail closed when TOTP is not configured',
  );
  console.log('Administrator MFA tests passed.');
} finally {
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  if (previous.adminEmail === undefined) delete process.env.DRAPIXAI_ADMIN_EMAIL;
  else process.env.DRAPIXAI_ADMIN_EMAIL = previous.adminEmail;
  if (previous.totpSecret === undefined) delete process.env.DRAPIXAI_ADMIN_TOTP_SECRET;
  else process.env.DRAPIXAI_ADMIN_TOTP_SECRET = previous.totpSecret;
}
