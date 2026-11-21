import assert from 'assert';
import { getTryOnConfidenceBadge, shouldAutoRejectTryOn, TryOnQualityInput } from '../lib/tryon-quality';
import { acceptPublicDemoOutput } from '../lib/public-demo-result';

const valid: TryOnQualityInput = {
  qualityScore: 0.95,
  latencyMs: 9_000,
  warnings: [],
  timingJson: { metrics: { garment_structure: 0.99, garment_texture_similarity: 0.99 } },
};

assert.equal(shouldAutoRejectTryOn(valid), false, '9.5/10 meets the minimum score');
assert.equal(shouldAutoRejectTryOn({ ...valid, qualityScore: 0.949999 }), true);
for (const qualityScore of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.01]) {
  const input = { ...valid, qualityScore };
  assert.equal(shouldAutoRejectTryOn(input), true, `Invalid score ${qualityScore} must fail closed`);
  assert.equal(getTryOnConfidenceBadge(input), 'Not publishable');
}

const lowerWarnings = [
  'SAFETY_CHECK_BLOCKED', 'LOWER_GARMENT_COLOR_DRIFT', 'LOWER_GARMENT_TEXTURE_DRIFT',
  'UPPER_BODY_CHANGED_RISK', 'LOWER_BODY_POSE_CHANGED_RISK', 'SHOE_CHANGED_RISK',
  'WAISTBAND_MISALIGNED', 'LEFT_LEG_ARTIFACT_RISK', 'RIGHT_LEG_ARTIFACT_RISK',
  'KNEE_ARTIFACT_RISK', 'ANKLE_ARTIFACT_RISK', 'LOWER_GARMENT_COVERAGE_INCOMPLETE',
  'CROTCH_ARTIFACT_RISK', 'LAYERED_OR_RETAINED_GARMENT_RISK', 'REVEALED_LEG_ARTIFACT_RISK',
  ...['JEANS', 'PANTS', 'TROUSERS', 'JOGGERS', 'SHORTS', 'SKIRT', 'LEGGINGS']
    .map((category) => `${category}_HEM_ALIGNMENT_RISK`),
];
for (const warning of lowerWarnings) {
  assert.equal(shouldAutoRejectTryOn({ ...valid, qualityScore: 1, warnings: [warning] }), true, warning);
}
assert.equal(shouldAutoRejectTryOn({
  ...valid, warnings: ['LOWER_BODY_V1_REVIEW_REQUIRED', 'LOWER_BODY_PROFILE:JEANS'],
}), false, 'Internal profile labels alone are not visual failures');
assert.equal(shouldAutoRejectTryOn({ ...valid, latencyMs: 60_000 }), false, 'Latency is a separate review decision');
assert.equal(shouldAutoRejectTryOn({ ...valid, warnings: ['GARMENT_COLOR_DRIFT'] }), true, 'Upper-body failures still reject');
assert.equal(getTryOnConfidenceBadge(valid), 'Excellent', 'Existing clean upper-body behavior is preserved');

async function demoSettlementChecks() {
  const receipt = '00000000-0000-4000-8000-000000000001';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNKkAAAAASUVORK5CYII=', 'base64');
  const output = (bytes = png, token = receipt) => new Response(bytes, { headers: { 'x-drapixai-demo-receipt': token } });
  const settlements: string[] = [];
  const settle = async (token: string) => { settlements.push(token); return new Response(null, { status: 204 }); };
  assert.equal((await acceptPublicDemoOutput({ ...valid, qualityScore: 0.5 }, output(), settle)).state, 'rejected');
  assert.equal((await acceptPublicDemoOutput({ ...valid, warnings: ['GARMENT_COLOR_DRIFT'] }, output(), settle)).state, 'rejected');
  assert.equal((await acceptPublicDemoOutput(valid, output(Buffer.alloc(0)), settle)).state, 'unavailable');
  assert.equal((await acceptPublicDemoOutput(valid, output(png, ''), settle)).state, 'unavailable');
  assert.deepEqual(settlements, []);
  const accepted = await acceptPublicDemoOutput(valid, output(), settle);
  assert.equal(accepted.state, 'accepted');
  assert.deepEqual(settlements, [receipt]);
  assert.equal((await acceptPublicDemoOutput(valid, output(), async () => new Response(null, { status: 429 }))).state, 'limited');
  const attempts: string[] = [];
  const retried = await acceptPublicDemoOutput(valid, output(), async token => {
    attempts.push(token);
    if (attempts.length === 1) throw Error('synthetic lost acknowledgement');
    return new Response(null, { status: 204 });
  });
  assert.equal(retried.state, 'accepted');
  assert.deepEqual(attempts, [receipt, receipt]);
}

demoSettlementChecks().then(() => console.log('Try-on quality and public demo settlement checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
