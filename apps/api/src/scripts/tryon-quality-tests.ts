import assert from 'assert';
import { getTryOnConfidenceBadge, shouldAutoRejectTryOn, TryOnQualityInput } from '../lib/tryon-quality';

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

console.log('Try-on quality score boundaries and lower-body warning tests passed.');
