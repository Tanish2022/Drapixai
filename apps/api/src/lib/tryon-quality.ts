export type ConfidenceBadge = 'Excellent' | 'Review' | 'Not publishable';

export type ProductAccuracyReport = {
  colorMatch: ConfidenceBadge;
  printLogoPreservation: ConfidenceBadge;
  sleeveMatch: ConfidenceBadge;
  hemMatch: ConfidenceBadge;
  collarMatch: ConfidenceBadge;
  textureMatch: ConfidenceBadge;
};

export type TryOnQualityInput = {
  qualityScore?: number | null;
  latencyMs?: number | null;
  warnings?: string[] | null;
  timingJson?: Record<string, unknown> | null;
};

const EXCELLENT_SCORE = Number(process.env.DRAPIXAI_EXCELLENT_QUALITY_SCORE || 0.95);
const MIN_PUBLISHABLE_SCORE = Number(process.env.DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE || 0.90);
const EXCELLENT_LATENCY_MS = Number(process.env.DRAPIXAI_EXCELLENT_LATENCY_MS || 10000);
const MAX_PUBLISHABLE_LATENCY_MS = Number(process.env.DRAPIXAI_MAX_PUBLISHABLE_LATENCY_MS || 12000);

const BLOCKING_WARNINGS = new Set([
  'GARMENT_COLOR_DRIFT',
  'BODY_CHANGED_RISK',
  'POSE_CHANGED_RISK',
  'FACE_CHANGED_RISK',
  'EDGE_ARTIFACT_RISK',
  'IMAGE_ARTIFACT_RISK',
  'RECTANGULAR_BLEND_ARTIFACT_RISK',
  'BACKGROUND_COLOR_CAST_RISK',
  'LOW_REALISM_RISK',
  'GARMENT_SHAPE_DRIFT',
  'GARMENT_TUCKED_HEM_RISK',
  'GARMENT_COVERAGE_INCOMPLETE',
  'QUALITY_SCORE_BELOW_THRESHOLD',
]);

const REVIEW_WARNINGS = new Set([
  'GARMENT_HEM_BLEND_RISK',
  'GARMENT_SLEEVE_LENGTH_DRIFT',
  'GARMENT_BACKGROUND_DOMINANT',
]);

export const normalizeWarnings = (warnings: unknown): string[] => {
  if (Array.isArray(warnings)) {
    return warnings.map((warning) => String(warning).trim()).filter(Boolean);
  }
  return String(warnings || '')
    .split(',')
    .map((warning) => warning.trim())
    .filter(Boolean);
};

const metric = (timingJson: Record<string, unknown> | null | undefined, key: string): number | null => {
  const metrics = timingJson?.metrics;
  const value = metrics && typeof metrics === 'object' && !Array.isArray(metrics)
    ? (metrics as Record<string, unknown>)[key]
    : timingJson?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const metricBadge = (value: number | null, excellent = 0.88, publishable = 0.72): ConfidenceBadge => {
  if (value === null) return 'Review';
  if (value >= excellent) return 'Excellent';
  if (value >= publishable) return 'Review';
  return 'Not publishable';
};

const warningBadge = (warnings: string[], blocking: string[], review: string[] = []): ConfidenceBadge => {
  if (warnings.some((warning) => blocking.includes(warning))) return 'Not publishable';
  if (warnings.some((warning) => review.includes(warning))) return 'Review';
  return 'Excellent';
};

export const buildProductAccuracyReport = (input: TryOnQualityInput): ProductAccuracyReport => {
  const warnings = normalizeWarnings(input.warnings);
  const timingJson = input.timingJson || null;
  return {
    colorMatch: warningBadge(warnings, ['GARMENT_COLOR_DRIFT']),
    printLogoPreservation: warningBadge(warnings, ['GARMENT_SHAPE_DRIFT', 'GARMENT_COVERAGE_INCOMPLETE']),
    sleeveMatch: warningBadge(warnings, ['GARMENT_COVERAGE_INCOMPLETE'], ['GARMENT_SLEEVE_LENGTH_DRIFT']),
    hemMatch: warningBadge(warnings, ['GARMENT_TUCKED_HEM_RISK'], ['GARMENT_HEM_BLEND_RISK']),
    collarMatch: metricBadge(metric(timingJson, 'garment_structure'), 0.86, 0.70),
    textureMatch: metricBadge(metric(timingJson, 'garment_texture_similarity'), 0.86, 0.70),
  };
};

export const getTryOnConfidenceBadge = (input: TryOnQualityInput): ConfidenceBadge => {
  const warnings = normalizeWarnings(input.warnings);
  const score = typeof input.qualityScore === 'number' ? input.qualityScore : 0;
  const latencyMs = typeof input.latencyMs === 'number' ? input.latencyMs : Number.POSITIVE_INFINITY;
  const accuracy = buildProductAccuracyReport(input);
  const accuracyValues = Object.values(accuracy);

  if (
    score < MIN_PUBLISHABLE_SCORE
    || latencyMs > MAX_PUBLISHABLE_LATENCY_MS
    || warnings.some((warning) => BLOCKING_WARNINGS.has(warning))
    || accuracyValues.includes('Not publishable')
  ) {
    return 'Not publishable';
  }

  if (
    score >= EXCELLENT_SCORE
    && latencyMs <= EXCELLENT_LATENCY_MS
    && warnings.length === 0
    && accuracyValues.every((item) => item === 'Excellent')
  ) {
    return 'Excellent';
  }

  if (warnings.some((warning) => REVIEW_WARNINGS.has(warning))) return 'Review';
  return 'Review';
};

export const shouldAutoRejectTryOn = (input: TryOnQualityInput) => {
  return getTryOnConfidenceBadge(input) === 'Not publishable';
};
