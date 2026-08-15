import assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { generateApiKey, hashApiKey } from '../lib/api-key-auth';
import { generateOtpCode } from '../lib/verification';
import { getTryOnConfidenceBadge, shouldAutoRejectTryOn } from '../lib/tryon-quality';

const repoRoot = path.resolve(process.cwd(), '../..');

const read = (relativePath: string) => {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
};

const assertIncludes = (source: string, expected: string, label: string) => {
  assert.ok(source.includes(expected), label);
};

const assertNotIncludes = (source: string, unexpected: string, label: string) => {
  assert.ok(!source.includes(unexpected), label);
};

const assertBefore = (source: string, first: string, second: string, label: string) => {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex, label);
};

const gitLsFiles = () => {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
};

const trackedFiles = gitLsFiles();
const forbiddenTrackedEnvFiles = trackedFiles.filter((file) => {
  const normalized = file.replace(/\\/g, '/');
  if (normalized.endsWith('.example') || normalized.endsWith('.sample')) {
    return false;
  }
  return (
    normalized === '.env' ||
    normalized === '.env.local' ||
    /(^|\/)\.env($|\.)/.test(normalized) ||
    /(^|\/)deploy\/env\/[^/]+\.production\.env$/.test(normalized) ||
    /(^|\/)apps\/[^/]+\/\.env($|\.)/.test(normalized)
  );
});

assert.deepStrictEqual(
  forbiddenTrackedEnvFiles,
  [],
  `Real env files must never be tracked by Git: ${forbiddenTrackedEnvFiles.join(', ')}`,
);

const generatedArtifactPrefixes = [
  '.next/',
  '.next-review/',
  'apps/web/.next/',
  'apps/web/.next-review/',
  'runtime/',
  'outputs/',
  'uploads/',
  'drapixai_ai/runtime/',
  'drapixai_ai/outputs/',
  'drapixai_ai/garments/',
];

const forbiddenTrackedGeneratedFiles = trackedFiles.filter((file) => {
  const normalized = file.replace(/\\/g, '/');
  return generatedArtifactPrefixes.some((prefix) => normalized.startsWith(prefix));
});

assert.deepStrictEqual(
  forbiddenTrackedGeneratedFiles,
  [],
  `Generated artifacts must never be tracked by Git: ${forbiddenTrackedGeneratedFiles.join(', ')}`,
);

const secretScanSkippedExtensions = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);

const highRiskSecretPatterns = [
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { name: 'Stripe/OpenAI-style key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: 'Resend API key', pattern: /\bre_[A-Za-z0-9_]{20,}\b/g },
];

const secretAssignmentPattern =
  /^[ \t]*(?:export[ \t]+)?([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSPHRASE|PASSCODE|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)[ \t]*=[ \t]*["']?([^"'\r\n# \t]+)["']?/gm;

const isAllowedPlaceholderSecret = (file: string, name: string, value: string) => {
  const normalized = value.trim();
  const normalizedFile = file.replace(/\\/g, '/');

  if (!normalized || normalized === '""' || normalized === "''") {
    return true;
  }

  if (/[<$%*]/.test(normalized)) {
    return true;
  }

  if (
    /replace-with|your-|example|placeholder|changeme|dummy|sample|app-password|smtp-secret|username:password/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (normalizedFile.endsWith('.example') || normalizedFile.endsWith('.sample')) {
    return true;
  }

  if (normalizedFile === 'deploy/scripts/smoke-test.sh' && name === 'PASSWORD') {
    return true;
  }

  return false;
};

const trackedSecretFindings: string[] = [];

for (const file of trackedFiles) {
  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath)) {
    continue;
  }

  const extension = path.extname(file).toLowerCase();
  const stats = fs.statSync(absolutePath);
  if (secretScanSkippedExtensions.has(extension) || stats.size > 1_000_000) {
    continue;
  }

  const source = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  for (const { name, pattern } of highRiskSecretPatterns) {
    if (source.match(pattern)) {
      trackedSecretFindings.push(`${file}: ${name}`);
    }
  }

  secretAssignmentPattern.lastIndex = 0;
  for (const match of source.matchAll(secretAssignmentPattern)) {
    const [, name, value] = match;
    if (!isAllowedPlaceholderSecret(file, name, value)) {
      trackedSecretFindings.push(`${file}: hard-coded ${name}`);
    }
  }
}

assert.deepStrictEqual(
  trackedSecretFindings,
  [],
  `Tracked source files must not contain real tokens or hard-coded secrets: ${trackedSecretFindings.join(', ')}`,
);

const sdkRoute = read('apps/api/src/routes/sdk.ts');
const apiKeyAuth = read('apps/api/src/lib/api-key-auth.ts');
const apiServer = read('apps/api/src/server.ts');
const authRoute = read('apps/api/src/routes/auth.ts');
const verificationLib = read('apps/api/src/lib/verification.ts');
const adminRoute = read('apps/api/src/routes/admin.ts');
const analyticsRoute = read('apps/api/src/routes/analytics.ts');
const accountRoute = read('apps/api/src/routes/account.ts');
const publicRoute = read('apps/api/src/routes/public.ts');
const securityHelpers = read('apps/api/src/lib/security.ts');
const remoteFetchHelpers = read('apps/api/src/lib/remote-fetch.ts');
const dashboardProxyAuth = read('apps/api/src/lib/dashboard-proxy-auth.ts');
const plansLib = read('apps/api/src/lib/plans.ts');
const rateLimit = read('apps/api/src/lib/rate-limit.ts');
const corsOriginCache = read('apps/api/src/lib/cors-origin-cache.ts');
const nginxConfig = read('deploy/nginx/drapixai.conf');
const usageLib = read('apps/api/src/lib/usage.ts');
const storageLib = read('apps/api/src/lib/storage.ts');
const catalogPreparation = read('apps/api/src/services/catalog-preparation.ts');
const adminPage = read('apps/web/app/admin/page.tsx');
const adminAccessPage = read('apps/web/app/admin-access/page.tsx');
const adminSessionRoute = read('apps/web/app/api/admin/session/route.ts');
const adminProxyRoute = read('apps/web/app/api/admin/proxy/[...path]/route.ts');
const adminSessionHelper = read('apps/web/app/lib/admin-session.ts');
const serverEnv = read('apps/web/app/lib/server-env.ts');
const requestGuard = read('apps/web/app/lib/request-guard.ts');
const dashboardPage = read('apps/web/app/dashboard/page.tsx');
const settingsPage = read('apps/web/app/settings/page.tsx');
const subscriptionPage = read('apps/web/app/subscription/page.tsx');
const helpPage = read('apps/web/app/help/page.tsx');
const marketingNav = read('apps/web/app/components/MarketingNav.tsx');
const marketingFooter = read('apps/web/app/components/MarketingFooter.tsx');
const supportAssistant = read('apps/web/app/components/SupportAssistant.tsx');
const globalStyles = read('apps/web/app/globals.css');
const tailwindConfig = read('apps/web/tailwind.config.ts');
const notFoundPage = read('apps/web/app/not-found.tsx');
const loadingPage = read('apps/web/app/loading.tsx');
const errorPage = read('apps/web/app/error.tsx');
const loginPage = read('apps/web/app/auth/login/page.tsx');
const registerPage = read('apps/web/app/auth/register/page.tsx');
const demoClient = read('apps/web/app/demo/DemoClient.tsx');
const shopifyConnectClient = read('apps/web/app/shopify/connect/ShopifyConnectClient.tsx');
const forgotPasswordPage = read('apps/web/app/auth/forgot-password/page.tsx');
const forgotPasswordForm = read('apps/web/app/auth/forgot-password/ForgotPasswordForm.tsx');
const webProviders = read('apps/web/app/providers.tsx');
const sdkJs = read('apps/web/public/sdk.js');
const sdkComponent = read('apps/web/app/components/DrapixAITryOn.tsx');
const sdkInstallPage = read('apps/web/app/sdk-install/page.tsx');
const dashboardSessionRoute = read('apps/web/app/api/dashboard/session/route.ts');
const dashboardOauthSessionRoute = read('apps/web/app/api/dashboard/oauth-session/route.ts');
const dashboardProxyRoute = read('apps/web/app/api/dashboard/proxy/[...path]/route.ts');
const nextAuthRoute = read('apps/web/app/api/auth/[...nextauth]/route.ts');
const plans = read('apps/api/src/lib/plans.ts');
const pipeline = read('drapixai_ai/pipeline/tryon_pipeline.py');
const aiServer = read('drapixai_ai/api/ai_server.py');
const launchGates = read('deploy/launch-gates.json');
const nodeRuntimeVerifier = read('scripts/verify-node-runtime.mjs');
const trackedSecretVerifier = read('scripts/verify-no-tracked-secrets.mjs');
const aiSettings = read('drapixai_ai/configs/settings.py');
const tryonService = read('drapixai_ai/services/tryon_service.py');
const gpuWorker = read('drapixai_ai/worker/gpu_worker.py');
const transientSpool = read('drapixai_ai/services/transient_spool.py');
const securitySchema = read('apps/api/prisma/schema.prisma');
const adminMfa = read('apps/api/src/lib/admin-mfa.ts');
const aiCompose = read('deploy/docker-compose.ai.yml');
const stagingAiCompose = read('deploy/staging/docker-compose.ai.yml');
const stagingEdgeCompose = read('deploy/staging/docker-compose.edge.yml');
const stagingImagesEnvExample = read('deploy/staging/.images.env.example');
const stagingTopologyVerifier = read('deploy/scripts/verify-staging-topology.py');
const stagingReleaseImageVerifier = read('deploy/staging/verify-release-images.sh');
const garmentCacheService = read('drapixai_ai/services/garment_cache.py');
const garmentCacheDeleteValidation = read('drapixai_ai/scripts/validate_garment_cache_delete.py');
const garmentCacheExpiryValidation = read('drapixai_ai/scripts/validate_garment_cache_expiry.py');
const inputValidation = read('apps/api/src/lib/input-validation.ts');
const inputValidationTests = read('apps/api/src/scripts/input-validation-tests.ts');
const garmentSkinDetectionValidation = read('drapixai_ai/scripts/validate_garment_skin_detection.py');
const neutralGarmentScorerValidation = read('drapixai_ai/scripts/validate_tryon_scorer_neutral_garments.py');
const garmentRules = read('drapixai_ai/services/garment_rules.py');
const maskBuilder = read('drapixai_ai/preprocess/mask_builder.py');
const tryonScorer = read('drapixai_ai/quality/tryon_scorer.py');
const lowerBodyValidator = read('drapixai_ai/services/lower_body_validator.py');
const lowerBodyMatrix = read('deploy/runpod/run_lower_body_matrix.py');
const lowerBodyMatrixExample = read('deploy/runpod/lower_body_matrix.example.json');
const lowerBodyScaffold = read('deploy/runpod/validate_lower_body_v1_scaffold.py');
const lowerBodyQualityDoc = read('docs/lower_body_quality_stack.md');
const cacheRegenerationScript = read('apps/api/src/scripts/regenerate-garment-caches.ts');
const retentionPurgeScript = read('apps/api/src/scripts/purge-tryon-review-retention.ts');
const shopperMediaPrivacyVerifier = read('apps/api/src/scripts/verify-shopper-media-privacy.ts');
const legacyRenderMediaPurge = read('apps/api/src/scripts/purge-legacy-render-media.ts');
const reviewRetentionService = read('apps/api/src/services/review-retention.ts');
const smtpTestScript = read('apps/api/src/scripts/send-test-email.ts');
const emailerService = read('apps/api/src/services/emailer.ts');
const watermarkService = read('apps/api/src/services/watermark.ts');
const smokeTryon = read('deploy/runpod/smoke_tryon.py');
const smokeMatrix = read('deploy/runpod/smoke_matrix.py');
const upperBodyMatrix = read('deploy/runpod/run_upper_body_50_matrix.py');
const smokeTest = read('deploy/scripts/smoke-test.sh');
const smokeAccountPrepare = read('apps/api/src/scripts/prepare-smoke-account.ts');
const smokeTestPowerShell = read('deploy/scripts/smoke-test.ps1');
const smokeHeaderAssert = read('deploy/scripts/assert-smoke-headers.py');
const validateEnv = read('deploy/scripts/validate-env.sh');
const aiEnvProfileTests = read('deploy/scripts/test-ai-env-profiles.sh');
const containerScanScript = read('deploy/scripts/scan-container-images.sh');
const publishReleaseImages = read('deploy/scripts/publish-release-images.sh');
const startProductionRelease = read('deploy/scripts/start-production-release.sh');
const validateProductionEnvSet = read('deploy/scripts/validate-production-env-set.sh');
const validateProductionEnvSetPowerShell = read('deploy/scripts/validate-production-env-set.ps1');
const aiProductionExample = read('deploy/env/ai.production.example');
const apiProductionExample = read('deploy/env/api.production.example');
const webProductionExample = read('deploy/env/web.production.example');
const nextConfig = read('apps/web/next.config.js');
const webProxy = read('apps/web/proxy.ts');
const homePage = read('apps/web/app/page.tsx');
const privacyPage = read('apps/web/app/privacy/page.tsx');
const proveLiveShell = read('deploy/scripts/prove-live-stack.sh');
const proveLivePowerShell = read('deploy/scripts/prove-live-stack.ps1');
const localPreflight = read('deploy/scripts/local-preflight.ps1');
const localStart = read('deploy/scripts/start-local-stack.ps1');
const launchWorkflow = read('.github/workflows/launch-readiness.yml');
const runpodPreflight = read('deploy/runpod/preflight.sh');
const runpodCommon = read('deploy/runpod/common.sh');
const runpodRedisStart = read('deploy/runpod/start-redis.sh');
const runpodStartAll = read('deploy/runpod/start-all.sh');
const runpodSecurityCandidate = read('deploy/runpod/prepare-security-candidate.sh');
const aiRequirements = read('drapixai_ai/requirements.txt');
const aiSecurityCandidate = read('drapixai_ai/requirements.security-candidate.txt');
const aiRuntimeSecurityDoc = read('docs/ai-runtime-security.md');
const catvtonDownload = read('drapixai_ai/scripts/download_catvton.py');
const catvtonPrepare = read('drapixai_ai/scripts/prepare_catvton.py');
const catvtonProductionPatch = read('drapixai_ai/patches/catvton-local-vae.patch');
const catvtonEngine = read('drapixai_ai/engines/catvton.py');
const runLaunchTryon = read('deploy/runpod/run-launch-tryon-test.sh');
const runpodSdkApiSetup = read('deploy/runpod/setup-sdk-api-stack.sh');
const runpodFreshSetup = read('deploy/runpod/setup-fresh-runpod.sh');
const productionReadiness = read('deploy/production-readiness.md');
const launchSupportPlaybook = read('deploy/launch-support-playbook.md');
const workstationPreflight = read('deploy/workstation/preflight.sh');
const sdkReactDoc = read('drapixai_ai/docs/sdk_react.md');
const dockerCompose = read('docker-compose.yml');
const edgeCompose = read('deploy/docker-compose.edge.yml');
const apiDockerfile = read('apps/api/Dockerfile');
const webDockerfile = read('apps/web/Dockerfile');
const nodeVersion = read('.nvmrc');
const rootPackage = read('package.json');
const apiPackage = read('apps/api/package.json');
const aiDockerfile = read('drapixai_ai/docker/Dockerfile');
const auditLog = read('apps/api/src/lib/audit-log.ts');
const auditMigration = read('apps/api/prisma/migrations/20260719170000_immutable_security_audit_log/migration.sql');
const authorizationLib = read('apps/api/src/lib/authorization.ts');
const securityReleaseGate = read('docs/security-release-gate.md');
const stagingPentest = read('deploy/scripts/pentest-staging.sh');
const stagingCertification = read('deploy/staging/certify-release.sh');
const stagingCertificationTemplate = read('deploy/staging/certification.env.example');
const mtlsApiHandshakeVerifier = read('deploy/workstation/internal-proxy/verify-mtls-api-handshake.sh');
const proxyReadme = read('deploy/workstation/internal-proxy/README.md');
const liveSecurityBoundaryTest = read('apps/api/src/scripts/live-security-boundary-tests.ts');
const distributedSecurityTest = read('apps/api/src/scripts/distributed-security-control-tests.ts');
const publicThreeTenantBenchmark = read('deploy/scripts/benchmark-three-tenant-public-api.py');
const launchGateReport = read('scripts/launch-gate-report.mjs');
const launchEvidenceRecorder = read('scripts/record-launch-evidence.mjs');
const launchEvidenceTemplate = JSON.parse(read('deploy/launch-evidence.example.json')) as {
  gates: Record<string, { evidence?: string; sha256?: string }>;
};
const launchGateConfig = JSON.parse(launchGates) as {
  releaseEvidence: Array<{ id: string }>;
};
const rootPackageJson = read('package.json');
const gitignore = read('.gitignore');
const gitattributes = read('.gitattributes');
const setupBatch = read('Setup.bat');
const initProductionEnv = read('deploy/scripts/init-production-env.ps1');
const heroTryOnAsset = path.join(repoRoot, 'apps/web/public/hero-standard-tryon.png');
const femaleTryOnAsset = path.join(repoRoot, 'apps/web/public/hero-female-tryon-v2.png');

assert.ok(fs.existsSync(heroTryOnAsset), 'Homepage must ship the SH-1042 Standard try-on evidence asset');
assert.ok(fs.statSync(heroTryOnAsset).size > 100_000, 'SH-1042 evidence asset must not be an empty placeholder');
assert.ok(fs.existsSync(femaleTryOnAsset), 'Homepage must ship the SH-2071 Standard try-on evidence asset');
assert.ok(fs.statSync(femaleTryOnAsset).size > 100_000, 'SH-2071 evidence asset must not be an empty placeholder');
assertIncludes(homePage, 'src="/hero-female-tryon-v2.png?v=sh2071-20260717"', 'Homepage evidence must show the current SH-2071 result');
assertIncludes(homePage, '>SKU SH-2071</div>', 'Homepage evidence must identify SH-2071 without covering the product image');
assertIncludes(homePage, 'src="/hero-standard-tryon.png?v=sh1042-20260717"', 'Homepage evidence must show the current SH-1042 result');
assertIncludes(homePage, '>SKU SH-1042</div>', 'Homepage evidence must identify SH-1042 without covering the product image');
assertNotIncludes(homePage, 'Hero-specific glow', 'Homepage must not replace product proof with a decorative glow');
assertNotIncludes(globalStyles, '.glow-primary', 'Global styles must not retain the legacy cyan glow system');
assertNotIncludes(globalStyles, '.gradient-text', 'Global styles must not retain legacy gradient text');
assertNotIncludes(tailwindConfig, '#050816', 'Tailwind background must use the current theme variables');
assertNotIncludes(tailwindConfig, 'gradient-primary', 'Tailwind must not expose the legacy cyan-blue gradient');
for (const [source, label] of [
  [dashboardPage, 'Dashboard'],
  [settingsPage, 'Settings'],
  [subscriptionPage, 'Subscription'],
] as const) {
  assertNotIncludes(source, 'bg-gradient', `${label} must not use decorative gradients`);
  assertNotIncludes(source, 'cyan-', `${label} must not retain the legacy cyan palette`);
  assertNotIncludes(source, 'rounded-2xl', `${label} panels must follow the restrained radius system`);
}
assertIncludes(helpPage, 'break-words font-serif text-4xl', 'Help heading must fit narrow mobile viewports');
assertIncludes(marketingNav, 'min-h-10 items-center', 'Marketing navigation links must expose usable touch targets');
assertIncludes(marketingFooter, 'min-h-10 items-center', 'Marketing footer links must expose usable touch targets');
assertIncludes(supportAssistant, 'fixed bottom-4 right-4', 'Support launcher must be available on mobile');
assertIncludes(supportAssistant, 'fixed inset-x-3 bottom-3 top-3', 'Support panel must remain inside mobile viewports');
assertIncludes(notFoundPage, 'This page is not part of the current DrapixAI workspace.', 'Website must ship a branded 404 state');
assertIncludes(loadingPage, 'Preparing the next view', 'Website must ship a branded loading state');
assertIncludes(errorPage, 'The page could not finish loading.', 'Website must ship a recoverable error state');

assertIncludes(sdkRoute, "const REQUIRE_GARMENT_CACHE = (process.env.DRAPIXAI_REQUIRE_GARMENT_CACHE || '1') === '1';", 'SDK must require cached garments by default');
assertIncludes(sdkRoute, "const SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON = (process.env.DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON || '0') === '1';", 'SDK must prefer cached try-on assets by default');
assertIncludes(sdkRoute, "const SDK_GENERATION_SOURCE = (process.env.DRAPIXAI_SDK_GENERATION_SOURCE || 'original_verified').toLowerCase();", 'SDK generation should use direct-quality original garment after cache validation');
assertIncludes(sdkRoute, "error: 'GARMENT_CACHE_REQUIRED'", 'SDK try-on must reject requests without a mapped/cache garment');
assertIncludes(sdkRoute, "error: 'GARMENT_MAPPING_NOT_CONFIRMED'", 'SDK must require confirmed product mapping');
assertIncludes(sdkRoute, "error: 'GARMENT_NOT_READY'", 'SDK must block products whose garment cache is not ready');

for (const header of [
  'x-drapixai-quality-score',
  'x-drapixai-processing-ms',
  'x-drapixai-warnings',
  'x-drapixai-candidate-count',
  'x-drapixai-latency-ms',
  'x-drapixai-latency-target-ms',
  'x-drapixai-timing-json',
  'x-drapixai-quality-mode',
  'x-drapixai-quality-profile',
  'x-drapixai-garment-source',
  'x-drapixai-garment-cache-status',
  'x-drapixai-garment-cache-version',
]) {
  assertIncludes(apiServer, header, `API CORS must expose ${header}`);
  assertIncludes(sdkRoute, header, `SDK try-on must return ${header}`);
}

assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_VERSION', 'SDK must know the expected garment cache version');
assertIncludes(sdkRoute, 'const ENABLE_LOWER_BODY', 'SDK route must gate lower-body V1 behind a server flag');
assertIncludes(sdkRoute, 'const LOWER_BODY_ADMIN_REVIEW_REQUIRED', 'SDK route must keep lower-body review gating separate from upper-body approval');
assertIncludes(sdkRoute, 'const EXPECTED_LOWER_BODY_CACHE_VERSION', 'SDK route must use a separate lower-body cache version');
assertIncludes(sdkRoute, "error: 'LOWER_BODY_NOT_ENABLED'", 'SDK route must reject lower-body when the server flag is off');
assertIncludes(sdkRoute, 'GARMENT_TYPE_MISMATCH', 'SDK route must reject upper/lower garment request mismatches');
assertIncludes(sdkRoute, 'getExpectedCacheVersion(garmentType)', 'SDK route must validate cache version by garment type');
assertIncludes(sdkRoute, "garmentType === 'lower' && LOWER_BODY_ADMIN_REVIEW_REQUIRED", 'Lower-body storefront try-on must block pending assets by default');
assertIncludes(sdkRoute, "requestedGarmentType === 'lower' && LOWER_BODY_ADMIN_REVIEW_REQUIRED", 'Lower-body uploaded garments must remain pending review by default');
assertIncludes(apiProductionExample, 'DRAPIXAI_LOWER_BODY_ADMIN_REVIEW_REQUIRED=1', 'API production example must keep lower-body review required by default');
assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_WIDTH', 'SDK must know expected garment cache width');
assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_HEIGHT', 'SDK must know expected garment cache height');
assertIncludes(sdkRoute, 'normalizeSdkQuality', 'SDK must normalize and reject non-Standard quality requests server-side');
const slowAccurateTryOn = {
  qualityScore: 0.97,
  latencyMs: 13_000,
  warnings: [] as string[],
  timingJson: { metrics: { garment_structure: 0.9, garment_texture_similarity: 0.9 } },
};
assert.strictEqual(getTryOnConfidenceBadge(slowAccurateTryOn), 'Review', 'A slow but accurate result must be marked for performance review');
assert.strictEqual(shouldAutoRejectTryOn(slowAccurateTryOn), false, 'Latency alone must not hide an accurate result from the shopper');
assert.strictEqual(shouldAutoRejectTryOn({ ...slowAccurateTryOn, warnings: ['GARMENT_COLOR_DRIFT'] }), true, 'Visual garment drift must still be auto-rejected');
assertIncludes(sdkRoute, "error: 'INVALID_QUALITY'", 'SDK API must reject non-Standard quality requests');
assertIncludes(sdkRoute, "error: 'GARMENT_CACHE_STALE'", 'SDK API must reject stale cache when regeneration is impossible');
assertIncludes(sdkRoute, "error: 'GARMENT_CACHE_QUALITY_MISMATCH'", 'SDK API must reject wrong-size cache when regeneration is impossible');
assertIncludes(sdkRoute, 'garment_cache_regenerated_quality_mismatch', 'SDK API must regenerate wrong-size caches from originals');
assertIncludes(sdkRoute, "res.setHeader('x-drapixai-garment-source'", 'SDK API must expose garment source metadata');
assertIncludes(sdkRoute, "res.setHeader('x-drapixai-garment-cache-status'", 'SDK API must expose cache verification metadata');
assertIncludes(sdkRoute, "generationGarmentSource = 'original_verified_cache_gate'", 'SDK API must use original garment for generation after cache validation');
assertIncludes(sdkRoute, 'const sdkOperationalWarnings: string[] = []', 'SDK route must keep cache operation notes separate from customer-facing quality warnings');
assertIncludes(sdkRoute, 'const combinedWarnings = parseWarningsHeader(warnings);', 'SDK route must derive storefront warnings only from AI quality warnings');
assertIncludes(sdkRoute, 'const storedWarnings = [...latencyWarnings, ...sdkOperationalWarnings];', 'SDK route must persist operational warnings only for admin review');
assertIncludes(sdkRoute, 'warnings: storedWarnings,', 'SDK route must store operational warnings in TryOnResult metadata');
assertIncludes(sdkRoute, 'const enforceSdkRequestDomain = async', 'SDK route must centralize storefront domain enforcement');
assertIncludes(sdkRoute, "router.post('/tryon-feedback', authMiddleware", 'SDK feedback endpoint must remain authenticated');
assertIncludes(sdkRoute, "router.get('/status/:jobId', authMiddleware, requireLegacyAsyncRender", 'Legacy SDK status endpoint must stay authenticated and disabled by default');
assertIncludes(sdkRoute, "router.get('/result/:jobId', authMiddleware, requireLegacyAsyncRender", 'Legacy SDK result endpoint must stay authenticated and disabled by default');
assertIncludes(sdkRoute, "router.delete('/job/:jobId', authMiddleware, requireLegacyAsyncRender", 'Legacy SDK job cancellation must stay authenticated and disabled by default');
assertIncludes(sdkRoute, 'if (!(await enforceSdkRequestDomain(req, res))) return;', 'SDK feedback/result endpoints must enforce registered storefront domains');
assertIncludes(sdkRoute, "res.setHeader('x-drapixai-warnings', latencyWarnings.join(','))", 'SDK route must not expose cache operation notes in storefront warning headers');

assertIncludes(aiSettings, 'ai_service_token', 'AI settings must include internal service token');
assertIncludes(aiServer, 'x-drapixai-service-token', 'AI server must read internal service token header');
assertIncludes(aiServer, 'AI_SERVICE_TOKEN_REQUIRED', 'AI server must reject protected calls without token');
assertIncludes(aiServer, '_read_upload_limited', 'AI server must enforce upload limits while streaming multipart data');
assertIncludes(aiServer, 'REQUEST_BODY_TOO_LARGE', 'AI server must reject oversized declared request bodies before parsing');
assertIncludes(aiServer, 'normalize_request_id', 'AI server must constrain client-supplied request IDs before logging them');
assertIncludes(launchGates, 'ai-ingress-security', 'Launch gates must execute AI ingress hardening regressions');
assertIncludes(launchGates, 'node-runtime', 'Launch gates must reject unsupported Node.js runtimes.');
assertIncludes(launchGates, 'tracked-secret-scan', 'Launch gates must scan tracked source for recognizable private credentials.');
assertIncludes(launchGates, 'public-api-contracts', 'Launch gates must execute the public API security and billing contract tests.');
assertIncludes(trackedSecretVerifier, 'TRACKED_SECRET_DETECTED', 'Tracked-secret verifier must fail without echoing a detected credential.');
assertIncludes(trackedSecretVerifier, "git', ['ls-files', '-z']", 'Tracked-secret verifier must inspect only versioned source files.');
assertIncludes(nodeRuntimeVerifier, 'UNSUPPORTED_NODE_RUNTIME', 'Node runtime verifier must fail closed on unsupported Node.js versions.');
assertIncludes(nodeRuntimeVerifier, 'NODE_ENGINE_RANGE_MISMATCH', 'Node runtime verifier must require one consistent engine range.');
assertIncludes(launchGates, 'three-tenant-gpu', 'Release evidence gates must require a three-tenant GPU certification artifact.');
assert.ok('three-tenant-gpu' in launchEvidenceTemplate.gates, 'Launch-evidence template must include the three-tenant GPU certification artifact.');
const requiredP0EvidenceGates = [
  'clean-release-commit',
  'disposable-db-migration',
  'container-image-scan',
  'two-tenant-staging',
  'audit-chain-staging',
  'retention-staging',
  'private-services',
  'backup-restore',
  'secret-rotation',
  'alerts',
  'sdk-quality-parity',
  'three-tenant-gpu',
  'quality-matrix',
  'authorized-pentest',
  'edge-operator-access',
  'environment-isolation',
  'auth-lifecycle',
  'log-privacy',
  'billing-security',
  'failure-containment',
  'legal-privacy-approval',
  'controlled-pilot-approval',
] as const;
assert.deepStrictEqual(
  launchGateConfig.releaseEvidence.map(({ id }) => id),
  requiredP0EvidenceGates,
  'Release evidence must contain the complete ordered 22-gate P0 launch program.',
);
for (const gateId of requiredP0EvidenceGates.filter((id) => id !== 'clean-release-commit')) {
  assert.ok(gateId in launchEvidenceTemplate.gates, `Launch-evidence template must include ${gateId}.`);
  assert.ok(launchEvidenceTemplate.gates[gateId].evidence, `${gateId} must name a release-record artifact.`);
  assert.ok(launchEvidenceTemplate.gates[gateId].sha256, `${gateId} must require an artifact digest.`);
}
assertIncludes(aiServer, 'PRODUCTION_CONFIG_INVALID', 'AI server must fail closed when production secrets are missing');
assertIncludes(aiServer, '_validate_image_bytes', 'AI server must validate image payloads before queueing work');
assertIncludes(aiServer, 'hmac.compare_digest(token, settings.ai_service_token)', 'AI service-token checks must be timing safe');
assertIncludes(aiServer, 'settings.request_max_pixels', 'AI image validation must reject pixel bombs before queueing work');
assertIncludes(aiServer, 'no-store, private', 'AI image responses must not be stored by shared or private caches');
assertIncludes(tryonService, '"person_image_ref": person_ref', 'Redis jobs must carry an opaque person reference');
assertIncludes(tryonService, '"cloth_image_ref": cloth_ref', 'Redis jobs must carry an opaque garment reference');
assertNotIncludes(tryonService, '"person_image": person_', 'Redis jobs must not carry person image bytes');
assertNotIncludes(tryonService, '"cloth_image": cloth_', 'Redis jobs must not carry garment image bytes');
assertIncludes(tryonService, 'ttl=settings.queue_ttl_seconds', 'Queued RQ jobs must expire');
assertIncludes(tryonService, 'failure_ttl=settings.failure_ttl_seconds', 'Failed RQ jobs must expire quickly');
assertIncludes(tryonService, 'job.delete()', 'Completed and failed jobs must be deleted explicitly');
assertIncludes(gpuWorker, '"output_image_ref": output_image_ref', 'Redis results must carry an opaque output reference');
assertNotIncludes(gpuWorker, '"image_base64":', 'Redis results must not carry output image bytes');
assertIncludes(transientSpool, 'secrets.token_hex(24)', 'Transient references must be cryptographically unguessable');
assertIncludes(transientSpool, 'path.parent != root', 'Transient references must remain inside the private spool');
assertIncludes(aiCompose, '--appendonly no', 'AI Redis must not persist queue data');
assertIncludes(aiCompose, '--requirepass', 'AI Redis must require authentication');
assertIncludes(aiSettings, 'enable_lower_body', 'AI settings must include lower-body feature flag');
assertIncludes(aiSettings, 'lower_body_cache_version', 'AI settings must include separate lower-body cache version');
assertIncludes(aiServer, 'LOWER_BODY_NOT_ENABLED', 'AI server must reject lower-body when disabled');
assertIncludes(aiServer, 'validate_lower_body_person', 'AI server must validate lower-body person inputs before queueing work');
assertIncludes(aiServer, '_cache_version_for_garment_type', 'AI garment preprocessing must use type-specific cache versions');
assertIncludes(aiServer, '_tryon_profile_type', 'AI try-on must carry lower-body category profiles into generation');
assertIncludes(sdkRoute, 'garment_category:', 'SDK route must forward lower-body garment category into AI try-on');
assertIncludes(garmentRules, 'key="jeans",\n        label="Jeans",\n        support_level="future_lower_beta"', 'Lower-body V1 must include jeans');
assertIncludes(garmentRules, 'key="pants",\n        label="Pants",\n        support_level="future_lower_beta"', 'Lower-body V1 must include pants');
assertIncludes(garmentRules, 'key="trousers",\n        label="Trousers",\n        support_level="future_lower_beta"', 'Lower-body V1 must include trousers as a distinct profile');
assertIncludes(garmentRules, 'key="shorts",\n        label="Shorts",\n        support_level="future_lower_beta"', 'Lower-body V1 must include shorts');
assertIncludes(garmentRules, 'key="skirt",\n        label="Skirt",\n        support_level="future_lower_beta"', 'Lower-body V1 must include skirts');
assertIncludes(garmentRules, 'key="leggings",\n        label="Leggings",\n        support_level="future_lower_beta"', 'Lower-body V1 must include leggings');
assertIncludes(garmentRules, 'key="joggers",\n        label="Joggers",\n        support_level="future_lower_beta"', 'Lower-body V1 must include joggers');
assertIncludes(aiSettings, 'jeans,pants,trousers,shorts,skirt,leggings,joggers', 'Lower-body defaults must allow all V1 lower categories');
assertIncludes(apiProductionExample, 'DRAPIXAI_LOWER_BODY_ALLOWED_CATEGORIES=jeans,pants,trousers,shorts,skirt,leggings,joggers', 'API production example must allow all lower-body V1 categories');
assertIncludes(maskBuilder, 'build_lower_body_mask_for_category', 'Lower-body masks must route by garment category');
assertIncludes(maskBuilder, 'build_shorts_mask', 'Lower-body masks must include a shorts profile');
assertIncludes(maskBuilder, 'build_skirt_mask', 'Lower-body masks must include a skirt profile');
assertIncludes(maskBuilder, 'build_leggings_mask', 'Lower-body masks must include a leggings profile');
assertIncludes(maskBuilder, 'build_joggers_mask', 'Lower-body masks must include a joggers profile');
assertIncludes(tryonScorer, 'LOWER_BODY_CATEGORY_PROFILES', 'Lower-body scorer must define category-specific profiles');
assertIncludes(tryonScorer, '"shorts":', 'Lower-body scorer must include shorts thresholds');
assertIncludes(tryonScorer, '"skirt":', 'Lower-body scorer must include skirt thresholds');
assertIncludes(tryonScorer, '"leggings":', 'Lower-body scorer must include leggings thresholds');
assertIncludes(tryonScorer, '"joggers":', 'Lower-body scorer must include joggers thresholds');
assertIncludes(pipeline, '"lower_body_v1" if normalized_garment_type == "lower"', 'Pipeline must label generic lower-body V1 quality profile');
assertIncludes(pipeline, 'lower_body_v1_', 'Pipeline must label category-specific lower-body quality profiles');
assertIncludes(pipeline, 'LOWER_BODY_V1_REVIEW_REQUIRED', 'Pipeline must mark lower-body V1 results for review');
assertIncludes(lowerBodyValidator, 'validate_lower_body_person', 'Lower-body validator must exist');
assertIncludes(lowerBodyMatrix, 'DRAPIXAI_ENABLE_LOWER_BODY=1', 'Lower-body matrix must require explicit beta enablement guidance');
assertIncludes(lowerBodyMatrix, 'garment_type=f"lower:{case.category}"', 'Lower-body matrix must run category-specific lower garment type');
assertIncludes(lowerBodyMatrix, 'DRAPIXAI_LOWER_BODY_MATRIX_ALLOW_BYPASS', 'Lower-body matrix must make validation bypass explicit');
assertIncludes(lowerBodyMatrix, 'if not ALLOW_BYPASS_VALIDATION:', 'Lower-body matrix must fail strict validation by default for launch QA');
assertIncludes(lowerBodyMatrixExample, '"person_path"', 'Lower-body matrix example must use runner-compatible person_path');
assertIncludes(lowerBodyMatrixExample, '"garment_path"', 'Lower-body matrix example must use runner-compatible garment_path');
for (const category of ['jeans', 'pants', 'trousers', 'shorts', 'skirt', 'leggings', 'joggers']) {
  assertIncludes(lowerBodyMatrixExample, `"category": "${category}"`, `Lower-body matrix example must include ${category}`);
}
assertIncludes(lowerBodyScaffold, 'LOWER_BODY_NOT_ENABLED', 'Lower-body scaffold must prove disabled lower-body fails closed');
assertIncludes(lowerBodyScaffold, 'build_lower_body_mask_for_category', 'Lower-body scaffold must validate category mask generation');
assertIncludes(lowerBodyScaffold, 'garment_type="lower:jeans"', 'Lower-body scaffold must exercise category-specific lower-body scoring');
assertIncludes(lowerBodyQualityDoc, 'V1 Security Gates', 'Lower-body quality doc must document V1 security gates');
assertIncludes(sdkJs, 'enableLowerBody', 'Browser SDK must require explicit lower-body opt-in');
assertIncludes(sdkJs, 'LOWER_BODY_NOT_ENABLED', 'Browser SDK must fail closed for lower-body without opt-in');
assertIncludes(cacheRegenerationScript, 'expectedCacheVersionFor', 'Cache regeneration must validate upper/lower cache versions');
assertIncludes(cacheRegenerationScript, 'garment_type: garmentType', 'Cache regeneration must preserve garment type');
assertIncludes(sdkRoute, 'const AI_SERVICE_TOKEN = process.env.DRAPIXAI_AI_SERVICE_TOKEN', 'SDK API route must load AI service token');
assertIncludes(sdkRoute, 'x-drapixai-service-token', 'SDK API route must forward AI service token');
assertIncludes(publicRoute, 'x-drapixai-service-token', 'Public demo route must forward AI service token');
assertIncludes(cacheRegenerationScript, 'x-drapixai-service-token', 'Cache regeneration script must forward AI service token');
assertIncludes(apiServer, 'DRAPIXAI_EXPOSE_READY_DETAILS', 'API readiness details must be opt-in for production');
assertIncludes(apiServer, 'prisma.apiKey.findFirst({ select: { kind: true } })', 'API readiness must verify API-key schema compatibility');
assertIncludes(apiServer, 'prisma.verificationCode.findFirst({ select: { attemptCount: true } })', 'API readiness must verify verification-attempt schema compatibility');
assertIncludes(apiServer, 'requireProductionConfig();', 'API server must validate production config on startup');
assertIncludes(apiServer, 'DRAPIXAI_CORS_ORIGINS must list explicit production origins', 'API server must reject wildcard production CORS');
assertIncludes(corsOriginCache, "kind: 'manual'", 'API CORS must recognize active manual storefront integrations');
assertIncludes(corsOriginCache, 'user: { storeVerifiedAt: { not: null } }', 'Dynamic storefront CORS must require verified ownership');
assertIncludes(corsOriginCache, 'if (refreshPromise) return refreshPromise', 'Dynamic storefront CORS refreshes must be single-flight');
assertIncludes(apiServer, 'verifiedStorefrontOrigins.allows(parsedOrigin.origin)', 'API CORS must use the bounded verified-storefront cache');
assertIncludes(apiServer, "parsedOrigin.protocol !== 'https:'", 'Production storefront CORS must require HTTPS');
assertIncludes(apiServer, "error.message === 'CORS_HTTPS_REQUIRED'", 'API must return a sanitized HTTPS-only CORS error');
assertIncludes(apiServer, "requireSecret('JWT_SECRET', 32)", 'API server must enforce a strong JWT secret in production');
assertIncludes(apiServer, 'DRAPIXAI_AUTH_SYNC_TOKEN', 'API server must require auth sync token in production');
assertIncludes(apiServer, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'API server must require dashboard proxy token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_TOKEN', 32)", 'API server must require admin token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12)", 'API server must require admin password in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_TOTP_SECRET', 16)", 'API server must require administrator MFA in production');
assertIncludes(apiServer, 'DATABASE_URL must set sslmode=verify-full', 'Production PostgreSQL must verify its TLS peer');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32)", 'API server must require AI service token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_DASHBOARD_PROXY_TOKEN', 32)", 'API server must enforce a strong dashboard proxy token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AUTH_SYNC_TOKEN', 32)", 'API server must enforce a strong auth sync token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32)", 'API server must enforce a strong AI service token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_TOKEN', 32)", 'API server must enforce a strong admin token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12)", 'API server must enforce a strong admin password in production');
assertIncludes(apiServer, "'DRAPIXAI_AI_URL'", 'API server must fail closed when the production AI URL is missing');
assertIncludes(apiServer, "'S3_BUCKET'", 'API server must require production object storage configuration');
assertIncludes(apiServer, "'SMTP_HOST'", 'API server must require production email configuration');
assertIncludes(apiServer, "requireExact('DRAPIXAI_REQUIRE_GARMENT_CACHE', '1')", 'API server must enforce cached garment generation in production');
assertIncludes(apiServer, "requireExact('DRAPIXAI_GARMENT_APPROVAL_REQUIRED', '1')", 'API server must enforce garment approval before shopper exposure');
assertIncludes(apiServer, "requireExact('DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK', '0')", 'API server must reject local storage fallback in production');
assertIncludes(apiServer, "requireExact('DRAPIXAI_ENABLE_LOWER_BODY', '0')", 'API server must keep unverified lower-body support disabled for launch');
assertIncludes(apiServer, "requireNumberAtLeast('DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE', 0.95)", 'API server must enforce the launch quality floor');
assertIncludes(apiServer, "requireExact('DRAPIXAI_AUTO_REJECT_BAD_RESULTS', '1')", 'API server must require public low-quality result rejection');
assertIncludes(publicRoute, 'shouldAutoRejectTryOn', 'Public demo must apply the publishability quality gate');
assertIncludes(publicRoute, "error: 'TRYON_RESULT_NOT_PUBLISHABLE'", 'Public demo must reject sub-threshold results');
assertIncludes(apiServer, '/replace-with|RUNPOD_POD_IP|USERNAME:PASSWORD/i', 'API server must reject placeholder production configuration');
assertIncludes(apiServer, "error.type === 'entity.parse.failed'", 'API server must return sanitized JSON for malformed JSON requests');
assertIncludes(apiServer, "error.message === 'CORS_ORIGIN_NOT_ALLOWED'", 'API server must return sanitized JSON for blocked CORS origins');
assertIncludes(apiServer, 'status = 403;', 'API server must return 403 for blocked CORS origins');
assertIncludes(apiServer, "res.status(404).json({ error: 'NOT_FOUND' });", 'API server must return JSON 404s');
assertIncludes(apiServer, "redis.on('error'", 'API server Redis client must handle socket errors without crashing');
assertIncludes(apiServer, 'formatLogError', 'API server must sanitize operational error logs');
assertIncludes(apiServer, "requireHttpsUrl('DRAPIXAI_AI_URL')", 'Production API must require a non-local HTTPS AI endpoint');
assertIncludes(storageLib, 'getStorageEncryptionParams', 'All object writes must request server-side encryption');
assertIncludes(storageLib, "ServerSideEncryption: 'aws:kms'", 'Object storage must support KMS-backed encryption');
assertIncludes(sdkRoute, "res.setHeader('Cache-Control', 'no-store, private')", 'SDK responses must not be cached');
assertIncludes(adminRoute, "res.setHeader('Cache-Control', 'no-store, private')", 'Sensitive admin responses must not be cached');
assertIncludes(securitySchema, 'role                            String', 'User records must have an explicit role');
assertIncludes(securitySchema, 'revokedAt           DateTime?', 'API keys must record revocation time');
assertIncludes(securitySchema, 'lastUsedAt          DateTime?', 'API keys must record last use');
assertIncludes(securitySchema, 'expiresAt           DateTime?', 'API keys must support expiry');
assertIncludes(apiKeyAuth, 'revokedAt: null', 'Revoked API keys must fail authentication');
assertIncludes(apiKeyAuth, 'lastUsedAt: new Date()', 'API key use must update lifecycle metadata');
assertIncludes(authRoute, "router.post('/logout'", 'Logout must revoke the server-side API key');
assertIncludes(authRoute, 'authVersion: { increment: 1 }', 'Password reset must advance account credential versioning');
assertNotIncludes(authRoute, 'const issueJwt', 'Account authentication must not issue an untracked long-lived bearer JWT');
assertNotIncludes(authRoute, 'token,\n      apiKey', 'Login and registration must return only revocable server-side credentials');
assertIncludes(authRoute, "error: 'EMAIL_NOT_VERIFIED'", 'Password login must reject accounts without verified email ownership');
assertIncludes(authRoute, "action: 'auth.email_unverified.denied'", 'Unverified login attempts must enter the security audit chain');
assertNotIncludes(authRoute, 'data: { emailVerifiedAt: new Date() }', 'Password login must never auto-verify email ownership');
assertIncludes(accountRoute, 'sessionsRevoked: true', 'Password changes must report session revocation');
assertIncludes(accountRoute, 'emailVerifiedAt: revokedAt', 'Email changes must establish the verified identity and revocation time atomically');
assertIncludes(accountRoute, 'authVersion: { increment: 1 }', 'Email changes must advance account credential versioning');
assertIncludes(accountRoute, 'where: { userId: resolved.user.id, isActive: true }', 'Sensitive account changes must revoke active API keys');
assertIncludes(securityHelpers, 'PASSWORD_HASH_ROUNDS = 12', 'Passwords must use strengthened bcrypt parameters');
assertIncludes(adminMfa, 'createHmac', 'Administrator MFA must validate TOTP server-side');
assertIncludes(adminMfa, 'timingSafeEqual', 'Administrator MFA comparisons must be timing safe');
assertIncludes(adminMfa, 'requireForRole', 'Administrator MFA must support fail-closed role-based enforcement');
assertIncludes(authRoute, "user.role === 'system_admin'", 'Every system administrator must require MFA even when matched by configured user ID');
assertIncludes(authRoute, 'authIdentityRateLimit', 'Authentication must rate-limit both IP addresses and account identities');
assertIncludes(authRoute, 'user?.passwordHash || LOGIN_TIMING_SENTINEL_HASH', 'Unknown-account login must perform password-hash work to resist timing enumeration');
assertIncludes(authRoute, 'fallbackStatus = 500', 'Unexpected authentication failures must not be mislabeled as client errors');
assertIncludes(securityHelpers, 'Bearer [redacted]', 'Log redaction must remove bearer credentials');
assertIncludes(securityHelpers, '[redacted-email]', 'Log redaction must remove email addresses');
assertIncludes(remoteFetchHelpers, 'lookup: (_hostname', 'Outbound fetches must connect to the DNS address that passed validation');
assertIncludes(remoteFetchHelpers, 'REMOTE_REDIRECT_NOT_ALLOWED', 'Pinned outbound fetches must reject redirects');
assertIncludes(apiServer, 'DRAPIXAI_CORS_ORIGINS contains an insecure or invalid origin', 'Production API must reject insecure CORS origins');
assertIncludes(apiServer, "'DATABASE_READY_TIMEOUT'", 'API readiness must bound database checks');
assertIncludes(apiServer, "'REDIS_READY_TIMEOUT'", 'API readiness must bound Redis checks');
assertIncludes(apiServer, 'signal: AbortSignal.timeout(3000)', 'API readiness must bound the AI check');
assertIncludes(nginxConfig, 'listen 8080 default_server;', 'Unknown HTTP hosts must use a rejecting default server');
assertIncludes(nginxConfig, 'listen 8443 ssl default_server;', 'Unknown TLS hosts must use a rejecting default server');
assertIncludes(nginxConfig, 'ssl_reject_handshake on;', 'Unknown TLS SNI must be rejected before application routing');
assertIncludes(nginxConfig, 'ssl_protocols TLSv1.2 TLSv1.3;', 'The edge must permit only TLS 1.2 and TLS 1.3');
assertIncludes(nginxConfig, 'ssl_session_tickets off;', 'The edge must disable unmanaged TLS session tickets');
assertIncludes(nginxConfig, 'proxy_connect_timeout 10s;', 'The edge must bound upstream connection attempts');
assertNotIncludes(apiServer, "console.error('Redis client error:', error);", 'API server must not log raw Redis client errors');
assertNotIncludes(apiServer, "console.error('Redis connection error:', error);", 'API server must not log raw Redis connection errors');
assertNotIncludes(apiServer, "console.error('Admin bootstrap failed:', error);", 'API server must not log raw admin bootstrap exceptions');
assertIncludes(authRoute, "router.post('/password-reset/request-otp'", 'Auth route must expose password reset OTP request');
assertIncludes(authRoute, "router.post('/password-reset/confirm'", 'Auth route must expose password reset confirmation');
assertIncludes(authRoute, "purpose: 'password_reset'", 'Password reset must use a dedicated OTP purpose');
assertIncludes(authRoute, "error: 'INVALID_OR_EXPIRED_OTP'", 'Password reset must not disclose account existence through OTP failures');
assertIncludes(authRoute, "return res.json({ ok: true });", 'Password reset request must avoid account enumeration');
assertIncludes(authRoute, 'const publicAuthFailure =', 'Auth route must centralize public error sanitization');
assertNotIncludes(authRoute, "error: 'AUTH_CONFIGURATION_ERROR'", 'Password authentication must not depend on an account JWT configuration');
assertIncludes(authRoute, "error: 'EMAIL_ALREADY_REGISTERED'", 'Auth register flow must use stable public error codes');
assertNotIncludes(authRoute, "err.message || 'OTP_REQUEST_FAILED'", 'Auth OTP route must not return raw exception messages');
assertNotIncludes(authRoute, "err.message || 'PASSWORD_RESET_OTP_REQUEST_FAILED'", 'Password reset OTP route must not return raw exception messages');
assertNotIncludes(authRoute, "err.message || 'PASSWORD_RESET_FAILED'", 'Password reset confirm route must not return raw exception messages');
assertNotIncludes(authRoute, 'res.status(status).json({ error: err.message });', 'Auth login/register routes must not return raw exception messages');
assertNotIncludes(authRoute, "error: 'Email already registered'", 'Auth register route must not return inconsistent natural-language error text');
assertIncludes(emailerService, 'password_reset', 'Emailer must support password reset OTP copy');
assertIncludes(forgotPasswordPage, 'ForgotPasswordForm', 'Forgot password page must render the reset form');
assertIncludes(forgotPasswordForm, '/auth/password-reset/request-otp', 'Forgot password form must request reset OTPs');
assertIncludes(forgotPasswordForm, '/auth/password-reset/confirm', 'Forgot password form must confirm reset OTPs');
assertIncludes(forgotPasswordForm, 'without revealing whether the email is registered', 'Forgot password UI must avoid account enumeration copy');
assertNotIncludes(forgotPasswordForm, 'Password reset is not self-serve yet', 'Forgot password page must not expose launch TODO copy');
assertNotIncludes(forgotPasswordForm, 'should be replaced with a real reset flow', 'Forgot password page must not ship stale TODO copy');
assertIncludes(authRoute, 'x-drapixai-auth-sync-token', 'Google OAuth sync must require a server-to-server token');
assertIncludes(authRoute, 'formatLogError', 'Auth route must sanitize OAuth sync operational logs');
assertNotIncludes(authRoute, "console.error('OAuth sync error:', error);", 'Auth route must not log raw OAuth sync exceptions');
assertIncludes(authRoute, 'AUTH_SYNC_TOKEN_REQUIRED', 'Google OAuth sync must reject missing auth sync token when configured');
assertIncludes(authRoute, "crypto.randomBytes(32).toString('base64url')", 'OAuth-only accounts must receive a cryptographically random fallback password');
assertNotIncludes(authRoute, 'Math.random()', 'Authentication secrets must not use Math.random');
assertNotIncludes(accountRoute, 'Math.random()', 'Store verification secrets must not use Math.random');
const generatedOtp = generateOtpCode();
assert.match(generatedOtp, /^\d{6}$/, 'OTP generation must return exactly six digits');
assert.ok(new Set(Array.from({ length: 32 }, generateOtpCode)).size > 1, 'OTP generation must produce varying values');
assertIncludes(verificationLib, 'crypto.randomInt(0, 10 ** OTP_LENGTH)', 'OTP generation must use cryptographic randomness');
assertIncludes(verificationLib, 'const OTP_MAX_ATTEMPTS = 5', 'Each OTP must have a bounded verification-attempt budget');
assertIncludes(verificationLib, 'attemptCount: { increment: 1 }', 'OTP attempts must be persisted atomically before comparison');
assertNotIncludes(verificationLib, 'Math.random()', 'OTP generation must not use Math.random');
assertIncludes(nextAuthRoute, 'DRAPIXAI_AUTH_SYNC_TOKEN', 'NextAuth route must read the auth sync token');
assertIncludes(nextAuthRoute, 'x-drapixai-auth-sync-token', 'NextAuth route must forward the auth sync token');
assertIncludes(nextAuthRoute, 'if (!res.ok) return false;', 'Google sign-in must fail closed when API synchronization fails');
assertIncludes(nextAuthRoute, 'if (!data.apiKey) return false;', 'Google sign-in must fail closed when API synchronization returns no key');
assertIncludes(nextAuthRoute, '(token as any).apiKey', 'NextAuth JWT must retain the OAuth-issued API key server-side');
assertNotIncludes(nextAuthRoute, '(session as any).apiKey', 'NextAuth browser session must not expose the API key');
assertIncludes(dashboardOauthSessionRoute, 'getToken', 'OAuth dashboard session bridge must read the server-side NextAuth token');
assertIncludes(dashboardOauthSessionRoute, 'createDashboardSessionToken(apiKey)', 'OAuth dashboard session bridge must create the encrypted dashboard session cookie');
assertIncludes(dashboardOauthSessionRoute, 'rejectCrossOriginRequest(request)', 'OAuth dashboard session bridge must reject cross-origin session mutations');
assertNotIncludes(dashboardOauthSessionRoute, 'apiKey });', 'OAuth dashboard session bridge must not return the API key in browser JSON');
assertIncludes(securityHelpers, 'ALLOWED_IMAGE_MIME_TYPES', 'API must use an image MIME allowlist');
assertIncludes(securityHelpers, 'ALLOWED_IMAGE_EXTENSIONS', 'API must use an image extension allowlist');
assertIncludes(securityHelpers, 'detectImageMimeType', 'API must verify upload image magic bytes');
assertIncludes(securityHelpers, 'isAllowedImageFileContent', 'API must validate uploaded image content after Multer writes files');
assertIncludes(securityHelpers, 'removeUploadedFile', 'API must clean up rejected upload temp files through a guarded helper');
assertIncludes(securityHelpers, 'sanitizeUpstreamError', 'API must sanitize upstream AI errors before returning them');
assertIncludes(securityHelpers, 'redactSensitiveText', 'API must provide shared sensitive text redaction for operational logs');
assertIncludes(securityHelpers, 'formatLogError', 'API must provide shared sanitized log error formatting');
assertIncludes(securityHelpers, "errorWithCode.code", 'Operational logs must retain safe dependency error codes');
assertIncludes(securityHelpers, 'buildUploadPath', 'API must build local upload paths through a guarded helper');
assertIncludes(securityHelpers, 'readLocalUploadFile', 'API must read local upload files through a guarded helper');
assertIncludes(securityHelpers, 'UPLOAD_PATH_OUTSIDE_ROOT', 'API upload helper must fail closed when paths escape the upload root');
assertIncludes(sdkRoute, 'buildUploadPath', 'SDK local upload fallback must guard upload paths');
assertIncludes(sdkRoute, 'sanitizePathSegment', 'SDK local upload fallback must sanitize path segments');
assertIncludes(sdkRoute, 'readLocalUploadFile', 'SDK local image reads must stay inside the upload root');
assertIncludes(storageLib, "process.env.NODE_ENV !== 'production'", 'Storage fallback must be disabled automatically in production');
assertIncludes(storageLib, 'DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK', 'Storage fallback must require an explicit development setting');
assertIncludes(sdkRoute, 'if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;', 'SDK uploads must fail closed when production object storage is unavailable');
assertIncludes(catalogPreparation, 'if (!STORAGE_LOCAL_FALLBACK_ALLOWED) throw error;', 'Shopify catalog preparation must fail closed when production object storage is unavailable');
assertIncludes(adminRoute, 'readLocalUploadFile', 'Admin local image reads must stay inside the upload root');
assertIncludes(sdkRoute, 'isAllowedImageUpload(file)', 'SDK uploads must use strict image upload validation');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(personFile)', 'SDK try-on must validate person upload content bytes');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(clothFile)', 'SDK try-on must validate cloth upload content bytes when supplied');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(req.file)', 'SDK garment onboarding must validate garment upload content bytes');
assertIncludes(sdkRoute, 'INVALID_IMAGE_CONTENT', 'SDK routes must reject invalid uploaded image content');
assertIncludes(sdkRoute, 'resolveSdkApiKey', 'SDK routes must use the resolver scoped for storefront and dashboard-preview credentials');
const generatedApiKey = generateApiKey();
assert.match(generatedApiKey, /^dpx_[A-Za-z0-9_-]{43}$/, 'New API keys must contain a recognizable prefix and 256 bits of URL-safe entropy');
assert.strictEqual(hashApiKey(generatedApiKey).length, 64, 'API-key SHA-256 digests must be 64 hexadecimal characters');
assert.notStrictEqual(generateApiKey(), generatedApiKey, 'API-key generation must produce unique random values');
assertIncludes(apiKeyAuth, 'crypto.randomBytes(32)', 'API keys must use 256 bits of cryptographic randomness');
assertIncludes(apiKeyAuth, "crypto.createHash('sha256')", 'Modern API keys must use an indexed SHA-256 digest');
assertIncludes(apiKeyAuth, 'prisma.apiKey.findUnique', 'Modern API-key authentication must use an indexed lookup');
assertIncludes(apiKeyAuth, 'DRAPIXAI_ALLOW_LEGACY_API_KEYS', 'Legacy bcrypt API-key lookup must have an explicit migration gate');
assertIncludes(apiKeyAuth, "process.env.NODE_ENV !== 'production'", 'Legacy API-key lookup must default off in production');
assertIncludes(apiKeyAuth, "keyHash: { startsWith: '$2' }", 'Legacy fallback must inspect only bcrypt-backed keys');
assertIncludes(apiKeyAuth, 'where: { userId, kind, isActive: true }', 'API-key rotation must deactivate only the requested key kind');
assertIncludes(apiKeyAuth, "const STOREFRONT_TOKEN_PREFIX = 'dpxst_'", 'Shopify storefronts must use recognizable short-lived credentials');
assertIncludes(apiKeyAuth, "expiresIn: '5m'", 'Shopify storefront credentials must expire after five minutes');
assertIncludes(apiKeyAuth, "algorithms: ['HS256']", 'Storefront token verification must pin its signing algorithm');
assertIncludes(apiKeyAuth, "kind: 'shopify'", 'Storefront credentials must resolve only Shopify API keys');
assertIncludes(apiKeyAuth, "const DASHBOARD_PREVIEW_TOKEN_PREFIX = 'dpxpv_'", 'Dashboard previews must use a recognizable scoped credential');
assertIncludes(apiKeyAuth, "audience: 'drapixai-sdk-preview'", 'Dashboard preview credentials must use a distinct audience');
assertIncludes(apiKeyAuth, "expiresIn: '15m'", 'Dashboard preview credentials must be short lived');
assertIncludes(apiKeyAuth, "kind: 'dashboard-preview'", 'Dashboard preview credentials must carry a dedicated token purpose');
assertIncludes(apiKeyAuth, 'export const resolveSdkApiKey', 'Preview credentials must be accepted only through the SDK-specific resolver');
assertIncludes(authRoute, "import { issueApiKeyForUser } from '../lib/api-key-auth';", 'Authentication routes must use centralized modern API-key issuance');
assertIncludes(analyticsRoute, 'issueApiKeyForUser', 'Dashboard key rotation must use centralized modern API-key issuance');
assertNotIncludes(authRoute, "uuidv4().replace(/-/g, '')", 'Authentication must not issue legacy 128-bit UUID API keys');
assertNotIncludes(analyticsRoute, "uuidv4().replace(/-/g, '')", 'Dashboard rotation must not issue legacy 128-bit UUID API keys');
assertIncludes(sdkRoute, "redis.on('error'", 'SDK Redis client must handle socket errors without crashing');
assertIncludes(sdkRoute, 'formatLogError', 'SDK route must sanitize operational error logs');
assertNotIncludes(sdkRoute, "console.error('SDK Redis client error:', error);", 'SDK route must not log raw Redis client errors');
assertNotIncludes(sdkRoute, "console.error('Try-on error:', error);", 'SDK route must not log raw try-on exceptions');
assertNotIncludes(sdkRoute, "console.error('Garment upload error:', error);", 'SDK route must not log raw garment upload exceptions');
assertNotIncludes(sdkRoute, "console.error('Watermark error:', watermarkError);", 'SDK route must not log raw watermark exceptions');
assertIncludes(publicRoute, 'isAllowedImageUpload(file)', 'Public demo uploads must use strict image upload validation');
assertIncludes(publicRoute, 'isAllowedImageFileContent(personFile)', 'Public demo must validate person upload content bytes');
assertIncludes(publicRoute, 'isAllowedImageFileContent(clothFile)', 'Public demo must validate garment upload content bytes');
assertIncludes(publicRoute, 'INVALID_IMAGE_CONTENT', 'Public demo must reject invalid uploaded image content');
assertIncludes(publicRoute, "error: 'SHOPPER_CONSENT_REQUIRED'", 'Public demo must require explicit shopper consent');
assertIncludes(publicRoute, "SHOPPER_PRIVACY_POLICY_VERSION", 'Public demo consent must bind to the current privacy policy');
assertIncludes(publicRoute, "x-drapixai-media-retention", 'Public demo must disclose transient-only media handling');
assertIncludes(publicRoute, "x-drapixai-training-use", 'Public demo must disclose that shopper media is not used for training');
assertIncludes(publicRoute, "/ai/garment/cache/delete", 'Public demo must delete its temporary garment cache after every attempt');
assertIncludes(publicRoute, "cleanupResponse.ok ? 'deleted' : 'failed'", 'Public demo must verify the AI cache deletion response');
assertIncludes(publicRoute, "action: 'privacy.public_demo_consent.accepted'", 'Public demo consent must enter the immutable audit chain before generation');
assertIncludes(publicRoute, "action: 'privacy.public_demo_media.cleanup'", 'Public demo cleanup outcome must enter the immutable audit chain');
assertIncludes(publicRoute, "outcome: cacheCleanupOutcome === 'failed' ? 'failure' : 'success'", 'Public demo cache deletion failures must remain visible in audit evidence');
assertIncludes(publicRoute, "PUBLIC_GARMENT_VALIDATION_CODES.has(normalized)", 'Public demo must allowlist garment validation errors before returning them');
assertNotIncludes(publicRoute, "parsed?.detail || parsed?.error || raw", 'Public demo must not return arbitrary upstream preprocessing text');
assertIncludes(publicRoute, "PUBLIC_WEBSITE_EVENTS = new Set(['page_view', 'cta_click', 'trial_signup', 'user_login'])", 'Public analytics must accept only known browser events');
assertIncludes(publicRoute, 'sanitizeReferrer', 'Public analytics must remove query strings from referrers');
assertIncludes(publicRoute, '.slice(0, 10)', 'Public analytics metadata must be bounded');
assertIncludes(apiServer, "app.use('/events', express.json({ limit: '16kb' }))", 'Public analytics JSON must have a narrow body limit');
assertIncludes(sdkRoute, 'sanitizeUpstreamError', 'SDK try-on must sanitize upstream AI errors');
assertIncludes(publicRoute, 'sanitizeUpstreamError', 'Public demo must sanitize upstream AI errors');
assertIncludes(publicRoute, 'formatLogError', 'Public route must sanitize operational error logs');
assertNotIncludes(publicRoute, "console.error('Website event tracking error:', error);", 'Public route must not log raw analytics exceptions');
assertNotIncludes(publicRoute, "console.error('Public demo try-on error:', error);", 'Public route must not log raw demo try-on exceptions');
assertNotIncludes(sdkRoute, "file.mimetype.startsWith('image/')", 'SDK uploads must not trust broad image/* MIME values');
assertNotIncludes(sdkRoute, "authorization?.replace('Bearer ', '')", 'SDK routes must not hand-roll bearer parsing');
assertNotIncludes(sdkRoute, "path.join(UPLOAD_ROOT", 'SDK local fallback paths must not join raw values against upload root');
assertNotIncludes(sdkRoute, "originalUrl.replace('local:', '')", 'SDK original garment reads must not trust raw local paths');
assertNotIncludes(sdkRoute, "garment.thumbnailUrl.replace('local:', '')", 'SDK thumbnail reads must not trust raw local paths');
assertNotIncludes(publicRoute, "file.mimetype.startsWith('image/')", 'Public uploads must not trust broad image/* MIME values');
assertIncludes(sdkRoute, 'router.use(createRateLimitMiddleware(600, 15 * 60 * 1000));', 'SDK API must rate limit public auth and try-on routes');
assertIncludes(sdkRoute, 'DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND', 'SDK domain auto-binding must be controlled explicitly');
assertIncludes(sdkRoute, "process.env.NODE_ENV !== 'production'", 'SDK domain auto-binding must be impossible in production');
assertIncludes(sdkRoute, "if (process.env.NODE_ENV === 'production') return null;", 'Production SDK domain checks must require an Origin or Referer rather than trusting the API Host header');
assertIncludes(sdkRoute, "error: 'SDK_DOMAIN_NOT_CONFIGURED'", 'SDK must fail closed when a production key has no configured storefront domain');
assertIncludes(sdkRoute, "error: 'STOREFRONT_NOT_VERIFIED'", 'Production SDK traffic must require verified storefront ownership');
assertIncludes(sdkRoute, "process.env.NODE_ENV === 'production' && !req.user?.storeVerifiedAt && !req.isDashboardPreview", 'Only scoped internal previews may bypass live storefront ownership checks');
assertNotIncludes(sdkRoute, 'const { domain } = req.body;', 'Public SDK validation must not trust a caller-supplied domain payload');
assertNotIncludes(sdkJs, 'JSON.stringify({ domain: domain })', 'Browser SDK must let the API derive the storefront domain from the request origin');
assertIncludes(apiServer, 'DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND must be disabled in production', 'API startup must reject production domain auto-binding');
assertIncludes(apiServer, 'DRAPIXAI_ALLOW_LEGACY_API_KEYS must be disabled in production', 'API startup must reject legacy linear API-key lookup in production');
assertIncludes(apiProductionExample, 'DRAPIXAI_ALLOW_SDK_DOMAIN_AUTO_BIND=0', 'Production API example must disable SDK domain auto-binding');
assertIncludes(apiProductionExample, 'DRAPIXAI_ALLOW_LEGACY_API_KEYS=0', 'Production API example must disable legacy API-key lookup');
assertIncludes(productionReadiness, 'Production SDK keys must never auto-bind', 'Production guide must document explicit storefront-domain setup');
assertIncludes(productionReadiness, 'Production SDK requests must also require a completed storefront ownership check', 'Production guide must require verified storefront ownership');
assertIncludes(productionReadiness, 'New API keys use high-entropy `dpx_` values', 'Production guide must document indexed modern API keys and pre-launch rotation');
assertIncludes(rateLimit, "req.ip || 'unknown'", 'Rate limiting must rely on Express trusted proxy IP handling');
assertNotIncludes(rateLimit, "req.headers['x-forwarded-for']", 'Rate limiting must not trust spoofable x-forwarded-for directly');
assertIncludes(rateLimit, 'redis.incr(redisKey)', 'Public API rate limiting must use shared Redis state');
assertIncludes(rateLimit, 'redis.pExpire(redisKey', 'Redis rate-limit windows must expire automatically');
assertIncludes(rateLimit, "process.env.NODE_ENV === 'production'", 'Production rate limiting must distinguish fail-closed behavior');
assertIncludes(rateLimit, "error: 'RATE_LIMITER_UNAVAILABLE'", 'Production must fail closed when shared rate limiting is unavailable');
assertIncludes(analyticsRoute, 'resolveActiveApiKey', 'Analytics routes must use the shared API-key resolver');
assertIncludes(analyticsRoute, 'router.use(analyticsRateLimit);', 'Analytics routes must be rate limited');
assertIncludes(analyticsRoute, 'router.use(requireDashboardProxy);', 'Analytics routes must require the same-origin dashboard proxy token');
assertIncludes(analyticsRoute, "router.post('/sdk-preview-token'", 'Dashboard proxy must issue scoped SDK preview credentials');
assertIncludes(analyticsRoute, 'issueDashboardPreviewToken', 'Dashboard preview endpoint must use centralized signed token issuance');
assertIncludes(analyticsRoute, 'getUserDailyUsage, getUserMonthlyUsage', 'Dashboard analytics must aggregate usage across the brand account');
assertIncludes(sdkRoute, 'getUserMonthlyUsage, incrementApiKeyUsage', 'SDK quota enforcement must aggregate usage while preserving per-key audit counts');
assertIncludes(usageLib, 'apiKey: { userId }', 'Usage totals must include every API key owned by the same brand account');
assertIncludes(usageLib, 'prisma.$transaction([', 'Monthly and daily usage counters must update atomically');
assertIncludes(plansLib, 'getPlanAccessContext', 'Plan access helper must centralize launch billing gates');
assertIncludes(plansLib, 'TRIAL_EXPIRED', 'Plan access helper must block expired trials');
assertIncludes(plansLib, 'INACTIVE_SUBSCRIPTION_STATUSES', 'Plan access helper must block explicit inactive subscription states');
assertIncludes(sdkRoute, 'const plan = getUserPlanContext(user);', 'SDK routes must evaluate plan access with user trial/subscription fields');
assertIncludes(sdkRoute, 'reason: plan.blockedReason', 'SDK inactive-plan responses must expose a stable blocked reason');
assertIncludes(sdkRoute, 'trialDaysLeft: plan.trialDaysLeft', 'SDK validation must report shared trial-days-left calculation');
assertIncludes(analyticsRoute, 'planAccessActive: plan.active', 'Analytics summary must expose active plan access state');
assertIncludes(analyticsRoute, 'planBlockedReason: plan.blockedReason', 'Analytics summary must expose plan blocked reason');
assertIncludes(analyticsRoute, 'trialDaysLeft: plan.trialDaysLeft', 'Analytics summary must use shared trial-days-left calculation');
assertNotIncludes(analyticsRoute, "authorization?.replace('Bearer ', '')", 'Analytics routes must not hand-roll bearer parsing');
assertIncludes(remoteFetchHelpers, 'REMOTE_HOST_NOT_ALLOWED', 'Remote fetch helper must block unsafe hosts');
assertIncludes(remoteFetchHelpers, 'REMOTE_RESPONSE_TOO_LARGE', 'Remote fetch helper must cap remote response size');
assertIncludes(remoteFetchHelpers, 'REMOTE_REDIRECT_NOT_ALLOWED', 'Remote fetch helper must reject redirects');
assertIncludes(remoteFetchHelpers, 'safeFetchBuffer', 'Remote fetch helper must support guarded binary image fetches');
assertIncludes(accountRoute, 'safeFetchText', 'Account store verification and feed sync must use safe remote fetches');
assertIncludes(accountRoute, 'FEED_URL_HTTPS_REQUIRED', 'Catalog feed URLs must require HTTPS');
assertIncludes(accountRoute, 'allowInsecureStoreVerification', 'Store verification must make HTTP fallback explicit and local-only');
assertIncludes(accountRoute, "process.env.NODE_ENV !== 'production' && process.env.DRAPIXAI_ALLOW_INSECURE_STORE_VERIFICATION === '1'", 'Store verification HTTP fallback must be disabled in production');
assertIncludes(accountRoute, 'const urlsToCheck = allowInsecureVerification ? [`https://${domain}`, `http://${domain}`] : [`https://${domain}`];', 'Production store verification must check HTTPS only');
assertIncludes(accountRoute, 'allowedProtocols: allowedVerificationProtocols', 'Store verification protocol allowlist must follow HTTPS-only launch policy');
assertNotIncludes(accountRoute, "allowedProtocols: ['https:', 'http:']", 'Store verification must not always permit insecure HTTP');
assertIncludes(accountRoute, 'normalizeStoreSettingsError', 'Account store settings must normalize validation errors');
assertIncludes(accountRoute, 'normalizeVerificationFailure', 'Store verification must normalize upstream fetch failures');
assertIncludes(accountRoute, 'normalizeCatalogSyncFailure', 'Catalog sync must normalize feed failures');
assertNotIncludes(accountRoute, "const message = error instanceof Error ? error.message : 'INVALID_STORE_SETTINGS';", 'Account store settings must not return raw exception messages');
assertNotIncludes(accountRoute, "lastError = error instanceof Error ? error.message : 'Verification request failed.';", 'Store verification must not expose raw upstream error text');
assertNotIncludes(accountRoute, "const message = error instanceof Error ? error.message : 'Feed sync failed.';", 'Catalog sync must not expose raw exception text');
assertNotIncludes(accountRoute, 'message: lastError', 'Store verification must not return upstream error text as a user message');
assertIncludes(accountRoute, 'reason: lastError', 'Store verification may return normalized failure reason codes');
assertIncludes(accountRoute, 'router.use(requireDashboardProxy);', 'Account routes must require the same-origin dashboard proxy token');
assertNotIncludes(accountRoute, "fetch(feedUrl", 'Account feed sync must not fetch brand URLs directly');
assertNotIncludes(accountRoute, "fetch(url, { redirect: 'follow' })", 'Store verification must not follow arbitrary redirects');
assertIncludes(cacheRegenerationScript, 'readLocalUploadFile', 'Cache regeneration must guard local stored image reads');
assertIncludes(cacheRegenerationScript, 'safeFetchBuffer', 'Cache regeneration must use guarded remote image fetches');
assertNotIncludes(cacheRegenerationScript, "storedUrl.replace('local:', '')", 'Cache regeneration must not trust raw local stored image paths');
assertNotIncludes(proveLiveShell, 'eval(', 'Live stack proof script must not evaluate assertion expressions');

assertIncludes(adminRoute, "filter === 'low_quality'", 'Admin API must support low quality review filter');
assertIncludes(adminRoute, 'resolveActiveApiKey', 'Admin routes must use the shared API-key resolver');
assertIncludes(adminRoute, "redis.on('error'", 'Admin Redis client must handle socket errors without crashing');
assertIncludes(adminRoute, 'formatLogError', 'Admin route must sanitize operational error logs');
assertNotIncludes(adminRoute, "console.error('Admin Redis client error:', error);", 'Admin route must not log raw Redis client errors');
assertNotIncludes(adminRoute, "authorization?.replace('Bearer ', '')", 'Admin routes must not hand-roll bearer parsing');
assertNotIncludes(adminRoute, "storedUrl.replace('local:', '')", 'Admin image reads must not trust raw local paths');
assertNotIncludes(adminRoute, "garment.thumbnailUrl.replace('local:', '')", 'Admin thumbnail reads must not trust raw local paths');
assertIncludes(adminRoute, "filter === 'high_latency'", 'Admin API must support high latency review filter');
assertIncludes(adminRoute, "filter === 'warnings'", 'Admin API must support warnings review filter');
assertIncludes(adminRoute, "filter === 'cache_failed'", 'Admin API must support cache failure garment filter');
assertIncludes(adminRoute, "data: { status: 'approved'", 'Admin API must support try-on approval');
assertIncludes(adminRoute, "data: { status: 'rejected'", 'Admin API must support try-on rejection');
assertIncludes(adminSessionRoute, 'createAdminSessionToken(apiKey)', 'Admin session route must store the API key only in the httpOnly session token');
assertIncludes(adminSessionRoute, "fetch(`${SERVER_API_BASE_URL}/auth/logout`", 'Admin logout must revoke the privileged API key server-side');
assertIncludes(adminSessionRoute, 'readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)', 'Admin logout must resolve the credential from the encrypted session cookie');
assertIncludes(adminSessionRoute, "sameSite: 'strict'", 'Admin session cookies must be SameSite Strict');
assertNotIncludes(adminSessionRoute, "sameSite: 'lax'", 'Admin session cookies must not use SameSite Lax');
assertIncludes(adminSessionRoute, 'return noStoreJson({ ok: true });', 'Admin session route must not return the admin API key to browser code');
assertNotIncludes(adminSessionRoute, 'return NextResponse.json({ ok: true, apiKey', 'Admin session route must never expose the admin API key in JSON');
assertIncludes(adminSessionHelper, "scope: 'admin'", 'Admin session token must carry admin scope');
assertIncludes(adminSessionHelper, "apiKey: string", 'Admin session token must support server-side admin API forwarding');
assertIncludes(adminSessionHelper, "AES-GCM", 'Admin session token must encrypt admin API credentials');
assertIncludes(adminSessionHelper, 'ADMIN_SESSION_SECRET_WEAK_OR_MISSING', 'Admin session helper must fail closed on weak production secrets');
assertIncludes(adminSessionHelper, "process.env.NODE_ENV === 'production' ? '' : process.env.NEXTAUTH_SECRET", 'Admin session helper must not fall back to NEXTAUTH_SECRET in production');
assertIncludes(adminSessionHelper, 'readAdminSessionToken', 'Admin session helper must expose a server-side reader for the admin proxy');
assertIncludes(adminProxyRoute, 'readAdminSessionToken', 'Admin proxy must read the httpOnly admin session');
assertIncludes(adminProxyRoute, 'SERVER_API_BASE_URL', 'Admin proxy must use the server-only API base URL');
assertNotIncludes(adminProxyRoute, '@/app/lib/public-env', 'Admin proxy must not import public browser env helpers');
assertIncludes(adminProxyRoute, 'ADMIN_SESSION_REQUIRED', 'Admin proxy must reject missing admin sessions');
assertIncludes(adminProxyRoute, 'noStoreJson', 'Admin proxy rejection responses must be explicitly non-cacheable');
assertIncludes(adminProxyRoute, "return noStoreJson({ error: 'ADMIN_SESSION_REQUIRED' }", 'Admin proxy session errors must be non-cacheable');
assertIncludes(adminProxyRoute, "return noStoreJson({ error: 'INVALID_ADMIN_PROXY_PATH' }", 'Admin proxy path errors must be non-cacheable');
assertIncludes(adminProxyRoute, 'Authorization: `Bearer ${session.apiKey}`', 'Admin proxy must attach the admin API key only server-side');
assertIncludes(adminProxyRoute, 'rejectCrossOriginMutation(request)', 'Admin proxy must reject cross-origin mutating requests');
assertIncludes(adminProxyRoute, 'readLimitedProxyBody(request)', 'Admin proxy must use bounded request body reads');
assertIncludes(adminProxyRoute, "responseHeaders.set('Cache-Control', 'no-store", 'Admin proxy responses must be explicitly non-cacheable');
assertIncludes(adminSessionRoute, 'rejectCrossOriginRequest(request)', 'Admin session route must reject cross-origin session mutations');
assertIncludes(adminSessionRoute, 'SERVER_API_BASE_URL', 'Admin session route must use the server-only API base URL');
assertNotIncludes(adminSessionRoute, '@/app/lib/public-env', 'Admin session route must not import public browser env helpers');
assertIncludes(adminPage, '/api/admin/proxy/', 'Admin page must use the same-origin admin proxy');
assertNotIncludes(adminPage, 'PUBLIC_API_BASE_URL', 'Admin page must not call the backend admin API directly');
assertNotIncludes(adminPage, 'localStorage.getItem', 'Admin page must not load admin API keys from localStorage');
assertNotIncludes(adminPage, 'localStorage.setItem', 'Admin page must not store admin API keys in localStorage');
assertNotIncludes(adminPage, "headers: { 'Authorization'", 'Admin page must not build browser Authorization headers');
assertNotIncludes(adminAccessPage, 'localStorage.setItem', 'Admin login page must not store admin API keys in localStorage');
assertIncludes(webProviders, '/api/dashboard/oauth-session', 'Web providers must create dashboard sessions through the OAuth bridge');
assertNotIncludes(webProviders, '(session as any)?.apiKey', 'Web providers must not read API keys from browser-visible NextAuth sessions');

for (const label of [
  'Try-On Quality Review',
  'Low Quality',
  'High Latency',
  'Warnings',
  'Approved',
  'Rejected',
  'Cache Failed',
  'No Cache',
  'try-on cache ready',
  'regenerate cache',
]) {
  assertIncludes(adminPage, label, `Admin review UI must show ${label}`);
}

assertIncludes(sdkJs, "throw reportStartupError('INVALID_QUALITY');", 'Browser SDK must reject non-standard quality options');
assertIncludes(sdkJs, 'function sanitizeCssValue', 'Browser SDK must sanitize CSS values before generated markup');
assertIncludes(sdkJs, 'function sanitizeAssetUrl', 'Browser SDK must sanitize logo/image URLs before generated markup');
assertIncludes(sdkJs, 'function sanitizeServiceUrl', 'Browser SDK must sanitize API base URLs before authenticated fetches');
assertIncludes(sdkJs, 'function sanitizeNavigationUrl', 'Browser SDK must sanitize buy/checkout URLs before navigation');
assertIncludes(sdkJs, 'baseUrl: sanitizeServiceUrl', 'Browser SDK must sanitize configured API base URL');
assertIncludes(sdkJs, 'var buyUrl = sanitizeNavigationUrl', 'Browser SDK must sanitize buy URLs from options or product attributes');
assertNotIncludes(sdkJs, 'var buyUrl = options.buyUrl || options.checkoutUrl', 'Browser SDK must not use raw buy URLs');
assertIncludes(sdkJs, 'function isLocalHttpAsset', 'Browser SDK must keep local HTTP asset support isolated to development');
assertIncludes(sdkJs, "resolved.protocol === 'https:' || isLocalHttpAsset(resolved)", 'Browser SDK must require HTTPS asset URLs outside localhost');
assertIncludes(sdkJs, 'SUPPORTED_IMAGE_TYPES', 'Browser SDK must keep client upload types aligned with API image allowlist');
assertIncludes(sdkJs, 'function isSupportedImageFile', 'Browser SDK must reject unsupported image types before preview/upload');
assertIncludes(sdkJs, 'accept="image/jpeg,image/png,image/webp"', 'Browser SDK file input must not accept broad image/* uploads');
assertNotIncludes(sdkJs, 'accept="image/*"', 'Browser SDK must not advertise unsupported image types');
assertIncludes(sdkJs, '/expression\\s*\\(|javascript\\s*:|data\\s*:|@import|url\\s*\\(/i', 'Browser SDK CSS sanitizer must reject active CSS values');
assertIncludes(sdkJs, "logoUrl: sanitizeAssetUrl", 'Browser SDK must sanitize configurable logo URLs');
assertIncludes(sdkJs, '&#10003;', 'Browser SDK must use ASCII-safe entities for inline status icons');
assertIncludes(sdkJs, "drapixai:buy", 'Browser SDK must expose buy event');
assertIncludes(sdkJs, "onBuy", 'Browser SDK must support onBuy callback');
assertIncludes(sdkJs, "qualityMode: response.headers.get('x-drapixai-quality-mode')", 'Browser SDK must expose Standard quality metadata');
assertIncludes(sdkJs, "garmentSource: response.headers.get('x-drapixai-garment-source')", 'Browser SDK must expose garment source metadata');
assertIncludes(sdkJs, "garmentCacheStatus: response.headers.get('x-drapixai-garment-cache-status')", 'Browser SDK must expose cache status metadata');
assertIncludes(sdkJs, "garmentCacheVersion: response.headers.get('x-drapixai-garment-cache-version')", 'Browser SDK must expose cache version metadata');
assertIncludes(sdkInstallPage, "quality: 'standard'", 'SDK install page must document Standard-only usage');
assertIncludes(sdkInstallPage, 'enableDownload: true', 'SDK install snippets must show the default shopper download control');
assertIncludes(sdkInstallPage, 'set it to false when a brand wants only Buy and Share actions', 'SDK install page must explain when brands should disable shopper downloads');
assertIncludes(sdkInstallPage, 'quality, latency, and warning metadata', 'SDK install page must document response metadata');
assertIncludes(sdkInstallPage, 'Server-only storefront key', 'SDK install page must label permanent storefront keys as server-only');
assertIncludes(sdkInstallPage, 'five-minute token restricted to the requested DrapixAI-ready product', 'SDK install page must explain short-lived product scope');
assertIncludes(sdkInstallPage, 'Never place this key in HTML, JavaScript, a mobile binary, logs, or analytics.', 'SDK install page must forbid exposing permanent keys');
assertIncludes(sdkInstallPage, 'No Liquid editing or permanent storefront API key is required.', 'Shopify onboarding must use the Theme App Extension instead of exposing a permanent key snippet');
assertIncludes(analyticsRoute, "kind: 'manual'", 'Storefront API-key rotation must issue a persistent manual key');
assertIncludes(analyticsRoute, "router.get('/api-key/status'", 'Dashboard must be able to inspect storefront key readiness without retrieving the secret');
assertIncludes(accountRoute, "kind: 'manual', isActive: true", 'Store domain updates must keep active manual storefront keys domain-bound');
assertIncludes(sdkInstallPage, "tokenProvider: async function (productId)", 'Browser SDK snippets must fetch short-lived credentials from the brand backend');
assertIncludes(homePage, "tokenProvider: async function (productId)", 'Homepage SDK example must use short-lived shopper credentials');
assertIncludes(helpPage, "tokenProvider: async function (productId)", 'Help SDK examples must use short-lived shopper credentials');
assertIncludes(dashboardPage, "tokenProvider: async function (productId)", 'Dashboard install examples must use short-lived shopper credentials');
assertNotIncludes(homePage, "apiKey: 'your-api-key'", 'Homepage must not teach permanent browser API keys');
assertNotIncludes(helpPage, "apiKey: 'your-api-key'", 'Help must not teach permanent browser API keys');
assertNotIncludes(helpPage, 'YOUR_API_KEY', 'Help must not label long-lived keys as shopper credentials');
assertNotIncludes(dashboardPage, 'YOUR_STOREFRONT_API_KEY', 'Dashboard snippets must not expose permanent storefront keys in browser code');
assertIncludes(dashboardPage, 'enableDownload: true', 'Dashboard quick-start snippet must show the shopper download control');
assertIncludes(dashboardPage, "dashboardApiPath('analytics/sdk-preview-token')", 'Dashboard SDK preview must request a short-lived server-issued credential');
assertIncludes(dashboardPage, 'storefrontToken: previewPayload.token', 'Dashboard SDK preview must use only the short-lived preview credential');
assertIncludes(dashboardPage, 'baseUrl: PUBLIC_API_BASE_URL', 'Dashboard SDK preview must call the API service rather than the web origin');
assertIncludes(dashboardPage, 'if (!previewProductId) return;', 'Dashboard SDK preview must wait for a ready confirmed mapping');
assertIncludes(dashboardPage, 'Confirm a ready product mapping to unlock preview', 'Dashboard must explain why the SDK preview is unavailable');
assertIncludes(dashboardPage, "quality: 'standard'", 'Dashboard quick-start snippet must show Standard-only usage');
assertIncludes(sdkComponent, 'tokenProvider: (productId: string) => Promise<string>', 'React SDK component must require a server-backed short-lived token provider.');
assertNotIncludes(sdkComponent, 'apiKey?: string', 'React SDK component must not accept a browser API-key prop.');
assertIncludes(sdkComponent, 'enableDownload?: boolean', 'React SDK component must expose the shopper download toggle.');
assertIncludes(sdkComponent, 'enableDownload,', 'React SDK component must forward the shopper download toggle to the browser SDK.');
assertIncludes(sdkReactDoc, 'short-lived, product-scoped storefront token', 'React SDK docs must require short-lived shopper credentials.');
assertIncludes(sdkReactDoc, 'POST /sdk/storefront-token', 'React SDK docs must explain server-side storefront token exchange.');
assertIncludes(sdkReactDoc, 'DRAPIXAI_SERVER_KEY', 'React SDK docs must keep the permanent server key in a server-only variable.');
assertIncludes(sdkReactDoc, "'Cache-Control': 'no-store, private'", 'React SDK docs must prevent shopper-token responses from being cached.');
assertIncludes(sdkReactDoc, 'findPublicProductById', 'React SDK docs must require a brand-side product lookup before minting shopper tokens.');
assertIncludes(sdkReactDoc, "method: 'POST'", 'React SDK docs must request shopper tokens with POST.');
assertIncludes(sdkReactDoc, 'ORIGIN_FORBIDDEN', 'React SDK docs must reject cross-origin shopper-token requests.');
assertIncludes(sdkReactDoc, 'STOREFRONT_ORIGIN', 'React SDK docs must verify the configured storefront origin.');
assertNotIncludes(sdkReactDoc, 'storefront-token?productId=', 'React SDK docs must not teach a cacheable shopper-token GET endpoint.');
assertIncludes(sdkInstallPage, "method: 'POST'", 'SDK install snippets must request shopper tokens with POST.');
assertNotIncludes(sdkInstallPage, 'drapixai-token?productId=', 'SDK install snippets must not teach a cacheable shopper-token GET endpoint.');
assertIncludes(helpPage, "method: 'POST'", 'Help SDK examples must request shopper tokens with POST.');
assertIncludes(homePage, "method: 'POST'", 'Homepage SDK example must request shopper tokens with POST.');
assertNotIncludes(homePage, 'drapixai-token?productId=', 'Homepage must not teach a cacheable shopper-token GET endpoint.');
assertIncludes(dashboardPage, "method: 'POST'", 'Dashboard SDK examples must request shopper tokens with POST.');
assertNotIncludes(dashboardPage, 'drapixai-token?productId=', 'Dashboard must not teach a cacheable shopper-token GET endpoint.');
assertNotIncludes(helpPage, 'drapixai-token?productId=', 'Help SDK examples must not teach a cacheable shopper-token GET endpoint.');
assertIncludes(sdkReactDoc, 'confirmed DrapixAI product mapping', 'React SDK docs must require confirmed product mappings.');
assertIncludes(sdkReactDoc, 'approved cached garment asset', 'React SDK docs must describe cached garment try-on usage.');
assertIncludes(sdkReactDoc, 'Never place a DrapixAI server API key', 'React SDK docs must forbid permanent browser API-key exposure.');
assertNotIncludes(sdkReactDoc, 'apiKey="YOUR_API_KEY"', 'React SDK docs must not teach permanent browser API keys.');
assertIncludes(sdkJs, 'PERMANENT_API_KEY_FORBIDDEN', 'Browser SDK must reject permanent or retired API credentials.');
assertIncludes(sdkJs, 'normalizeStorefrontCredential', 'Browser SDK must normalize every shopper credential before sending it.');
assertIncludes(dashboardProxyRoute, 'readDashboardSessionToken', 'Dashboard proxy must read the httpOnly dashboard session');
assertIncludes(dashboardProxyRoute, 'SERVER_API_BASE_URL', 'Dashboard proxy must use the server-only API base URL');
assertIncludes(dashboardProxyRoute, 'DASHBOARD_SESSION_REQUIRED', 'Dashboard proxy must reject missing dashboard sessions');
assertIncludes(dashboardProxyRoute, 'isAllowedDashboardPath', 'Dashboard proxy must whitelist brand-management paths');
assertIncludes(dashboardProxyRoute, 'Authorization', 'Dashboard proxy must attach the API key only server-side');
assertIncludes(dashboardProxyRoute, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Dashboard proxy must read the server-only dashboard proxy token');
assertIncludes(dashboardProxyRoute, 'x-drapixai-dashboard-proxy-token', 'Dashboard proxy must forward the server-only proxy token');
assertIncludes(dashboardProxyRoute, 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED', 'Dashboard proxy must fail closed in production when proxy token is missing');
assertIncludes(dashboardProxyRoute, "responseHeaders.set('Cache-Control', 'no-store", 'Dashboard proxy responses must be explicitly non-cacheable');
assertIncludes(dashboardProxyRoute, 'noStoreJson', 'Dashboard proxy rejection responses must be explicitly non-cacheable');
assertIncludes(dashboardProxyRoute, "return noStoreJson({ error: 'DASHBOARD_SESSION_REQUIRED' }", 'Dashboard proxy session errors must be non-cacheable');
assertIncludes(dashboardProxyRoute, "return noStoreJson({ error: 'INVALID_DASHBOARD_PROXY_PATH' }", 'Dashboard proxy path errors must be non-cacheable');
assertIncludes(dashboardProxyRoute, 'rejectCrossOriginMutation(request)', 'Dashboard proxy must reject cross-origin mutating requests');
assertIncludes(dashboardProxyRoute, 'readLimitedProxyBody(request)', 'Dashboard proxy must use bounded request body reads');
assertIncludes(requestGuard, 'readLimitedProxyBody', 'Web request guard must cap proxied request bodies before buffering');
assertIncludes(requestGuard, 'PROXY_REQUEST_TOO_LARGE', 'Web request guard must reject oversized proxied bodies with a sanitized error');
assertIncludes(dashboardSessionRoute, 'rejectCrossOriginRequest(request)', 'Dashboard session route must reject cross-origin session mutations');
assertIncludes(dashboardSessionRoute, "sameSite: 'strict'", 'Dashboard session cookies must be SameSite Strict');
assertNotIncludes(dashboardSessionRoute, "sameSite: 'lax'", 'Dashboard session cookies must not use SameSite Lax');
assertIncludes(dashboardOauthSessionRoute, "sameSite: 'strict'", 'OAuth dashboard session cookies must be SameSite Strict');
assertNotIncludes(dashboardOauthSessionRoute, "sameSite: 'lax'", 'OAuth dashboard session cookies must not use SameSite Lax');
assertIncludes(dashboardSessionRoute, 'export async function GET(request: Request)', 'Dashboard session API-key reads must inspect the incoming request');
assertIncludes(dashboardSessionRoute, 'return noStoreJson({ ok: true });', 'Dashboard session responses must be non-cacheable');
assertNotIncludes(dashboardSessionRoute, 'ok: true, apiKey:', 'Dashboard session responses must never disclose permanent API keys to browser JavaScript');
assertIncludes(adminSessionRoute, 'return noStoreJson({ ok: true });', 'Admin session responses must be non-cacheable');
assertIncludes(dashboardOauthSessionRoute, 'return noStoreJson({ ok: true });', 'OAuth dashboard session bridge responses must be non-cacheable');
assertIncludes(requestGuard, 'CSRF_ORIGIN_MISMATCH', 'Web request guard must return a stable CSRF rejection code');
assertIncludes(requestGuard, 'NEXT_PUBLIC_WEB_BASE_URL', 'Web request guard must validate against the configured public web origin');
assertIncludes(requestGuard, 'NEXTAUTH_URL', 'Web request guard must support NextAuth URL as the expected origin');
assertIncludes(requestGuard, 'Cache-Control', 'Web request guard must provide no-store JSON responses for credential routes');
assertIncludes(requestGuard, 'no-store, private, no-cache, max-age=0, must-revalidate', 'No-store JSON helper must prevent credential response caching');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_TOKEN_HEADER', 'API must centralize dashboard proxy header handling');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_REQUIRED', 'API must reject dashboard management calls without the proxy token');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED', 'API must fail closed when the dashboard proxy token is missing in production');
assertIncludes(sdkRoute, 'requireDashboardProxy', 'SDK management routes must be protected by the dashboard proxy token');
assertIncludes(sdkRoute, "router.post('/garments', authMiddleware, requireDashboardProxy", 'Garment uploads must require dashboard proxy token');
assertIncludes(sdkRoute, "router.get('/catalog', authMiddleware, requireDashboardProxy", 'Catalog management must require dashboard proxy token');
assertIncludes(sdkRoute, "router.post('/matches/:garmentId/confirm', authMiddleware, requireDashboardProxy", 'Garment mapping confirmation must require dashboard proxy token');
assertIncludes(sdkRoute, "router.get('/result/:jobId', authMiddleware, requireLegacyAsyncRender, async", 'Legacy shopper result endpoint must fail closed unless its worker is explicitly available');
assertIncludes(sdkRoute, "error: 'LEGACY_ASYNC_RENDER_DISABLED'", 'Dead async render APIs must return an explicit gone response');
assertIncludes(apiServer, "requireExact('DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER', '0')", 'Production config must reject the dead async render queue');
assertIncludes(apiProductionExample, 'DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER=0', 'Production API env must keep the dead async render queue disabled');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER "0"', 'Environment validation must reject the dead async render queue');
assertIncludes(apiProductionExample, 'DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK=0', 'Production API env must keep local disk fallback disabled');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK "0"', 'Environment validation must reject local disk fallback in production');
assertIncludes(dashboardPage, '/api/dashboard/proxy/', 'Dashboard page must use the same-origin dashboard proxy for management calls');
assertIncludes(settingsPage, '/api/dashboard/proxy/', 'Settings page must use the same-origin dashboard proxy for account calls');
assertIncludes(settingsPage, 'payload?.reason', 'Settings page must display normalized account failure reason codes');
assertIncludes(homePage, '/api/dashboard/proxy/analytics/summary', 'Homepage profile summary must use the same-origin dashboard proxy');
assertIncludes(subscriptionPage, '/api/dashboard/proxy/analytics/summary', 'Subscription page must use the same-origin dashboard proxy');
assertIncludes(sdkInstallPage, '/api/dashboard/proxy/analytics/summary', 'SDK install summary must use the same-origin dashboard proxy');
assertIncludes(sdkInstallPage, '/api/dashboard/proxy/sdk/garments', 'SDK install garment readiness must use the same-origin dashboard proxy');
assertNotIncludes(dashboardPage, 'Authorization:', 'Dashboard page must not build browser Authorization headers');
assertNotIncludes(settingsPage, 'Authorization:', 'Settings page must not build browser Authorization headers');
assertNotIncludes(homePage, 'Authorization:', 'Homepage must not build browser Authorization headers for management APIs');
assertNotIncludes(homePage, 'sessionApiKey', 'Homepage must not read API keys from browser-visible NextAuth sessions');
assertNotIncludes(subscriptionPage, 'Authorization:', 'Subscription page must not build browser Authorization headers for management APIs');
assertNotIncludes(homePage, 'PUBLIC_API_BASE_URL}/analytics/summary', 'Homepage must not call analytics directly from the browser');
assertNotIncludes(subscriptionPage, 'PUBLIC_API_BASE_URL}/analytics/summary', 'Subscription page must not call analytics directly from the browser');
assertNotIncludes(sdkInstallPage, 'PUBLIC_API_BASE_URL}/analytics/summary', 'SDK install page must not call analytics directly from the browser');
assertNotIncludes(sdkInstallPage, 'PUBLIC_API_BASE_URL}/sdk/garments', 'SDK install page must not call garment management directly from the browser');
assertNotIncludes(dashboardPage, '`${PUBLIC_API_BASE_URL}/sdk/result', 'Dashboard result links must use the dashboard proxy');
assertIncludes(dashboardProxyRoute, "'result'", 'Dashboard proxy must allow authenticated result links');
assertIncludes(dashboardSessionRoute, 'validateApiKey', 'Dashboard session route must validate direct API keys before setting cookies');
assertIncludes(dashboardSessionRoute, 'SERVER_API_BASE_URL', 'Dashboard session route must use the server-only API base URL');
assertIncludes(dashboardSessionRoute, '/analytics/summary', 'Dashboard session validation must call the backend before trusting a key');
assertIncludes(dashboardSessionRoute, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Dashboard session validation must read the private proxy token');
assertIncludes(dashboardSessionRoute, 'x-drapixai-dashboard-proxy-token', 'Dashboard session validation must forward the private proxy token');
assertIncludes(dashboardSessionRoute, "process.env.NODE_ENV === 'production'", 'Dashboard session validation must fail closed in production when proxy token is missing');
assertIncludes(dashboardSessionRoute, "error: 'INVALID_API_KEY'", 'Dashboard session route must reject invalid direct API keys');
assertIncludes(read('apps/web/app/lib/dashboard-session.ts'), 'DASHBOARD_SESSION_SECRET_WEAK_OR_MISSING', 'Dashboard session helper must fail closed on weak production secrets');
assertIncludes(read('apps/web/app/lib/dashboard-session.ts'), 'DASHBOARD_SESSION_SECRET', 'Dashboard session helper must use an explicit dashboard session secret');
assertIncludes(read('apps/web/app/lib/dashboard-session.ts'), "process.env.NODE_ENV === 'production' ? '' : process.env.NEXTAUTH_SECRET", 'Dashboard session helper must not fall back to shared auth secrets in production');
assertIncludes(serverEnv, 'DRAPIXAI_API_URL', 'Web server routes must prefer private DRAPIXAI_API_URL for backend calls');
assertIncludes(serverEnv, 'NEXT_PUBLIC_API_BASE_URL', 'Web server routes may fall back to the public API base URL for local/dev deploys');
for (const [source, label] of [
  [dashboardPage, 'Dashboard page'],
  [settingsPage, 'Settings page'],
  [subscriptionPage, 'Subscription page'],
  [loginPage, 'Login page'],
  [registerPage, 'Register page'],
  [webProviders, 'Web providers'],
  [homePage, 'Homepage'],
] as const) {
  assertNotIncludes(source, "localStorage.getItem('apiKey'", `${label} must not load API keys from localStorage`);
  assertNotIncludes(source, "localStorage.setItem('apiKey'", `${label} must not persist API keys in localStorage`);
  assertNotIncludes(source, "localStorage.removeItem('apiKey'", `${label} must not depend on localStorage API-key cleanup`);
}

assertIncludes(plans, "quality: 'standard'", 'Every plan must resolve to Standard quality');
assertIncludes(pipeline, 'return "standard"', 'AI pipeline must normalize every request to Standard');
assertIncludes(aiSettings, 'DRAPIXAI_GARMENT_CONDITION_MAX_EDGE', 'AI settings must cap oversized garment conditioning work');
assertIncludes(aiProductionExample, 'DRAPIXAI_GARMENT_CONDITION_MAX_EDGE=1536', 'Production AI env must pin the garment conditioning ceiling');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_GARMENT_CONDITION_MAX_EDGE "1536"', 'Production validation must enforce the tested garment conditioning ceiling');
assertIncludes(pipeline, 'conditioned.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)', 'Oversized garment conditioning must use high-quality aspect-preserving resize');
assertIncludes(pipeline, 'self.scorer.choose_best(person, condition_cloth', 'Generation and scoring must use the same conditioned garment pixels');
assertIncludes(smokeTryon, 'quality="standard"', 'RunPod smoke try-on must execute Standard quality');
assertIncludes(smokeMatrix, '"candidate_count": 1', 'RunPod smoke matrix must record Standard candidate count');
assertNotIncludes(smokeTryon, 'enhanced_', 'RunPod smoke try-on must not use enhanced settings');
assertNotIncludes(smokeMatrix, 'enhanced_', 'RunPod smoke matrix must not use enhanced settings');
assertIncludes(upperBodyMatrix, 'MATRIX_REQUIRES_EXACTLY_50_CASES', 'Upper-body launch matrix must require exactly 50 cases');
assertIncludes(upperBodyMatrix, 'REMOTE_ASSET_URL_NOT_ALLOWED', 'Upper-body launch matrix must use reviewed local assets rather than mutable product URLs');
assertIncludes(upperBodyMatrix, 'MATRIX_RIGHTS_NOT_CONFIRMED', 'Upper-body launch matrix must require explicit asset-rights confirmation');
assertIncludes(upperBodyMatrix, 'DUPLICATE_GARMENT_SOURCE', 'Upper-body launch matrix must reject duplicate garment sources');
assertIncludes(upperBodyMatrix, 'MATRIX_REQUIRES_AT_LEAST_8_UNIQUE_PEOPLE', 'Upper-body launch matrix must cover multiple distinct people');
assertIncludes(upperBodyMatrix, 'DRAPIXAI_MATRIX_MIN_QUALITY_SCORE", "0.95"', 'Upper-body launch matrix must default to the 0.95 quality gate');
assertIncludes(upperBodyMatrix, 'CANDIDATE_COUNT_NOT_ONE', 'Upper-body launch matrix must enforce Standard-only single-candidate output');
assertIncludes(upperBodyMatrix, 'WARNINGS_PRESENT', 'Upper-body launch matrix must reject warning-bearing output');
assertIncludes(upperBodyMatrix, 'LATENCY_ABOVE_', 'Upper-body launch matrix must enforce the launch latency target');
assertNotIncludes(upperBodyMatrix, 'bypass_validation=True', 'Upper-body launch matrix must never bypass garment validation');

assertIncludes(validateEnv, 'require_equals DRAPIXAI_REQUIRE_GARMENT_CACHE "1"', 'API env validation must enforce cached garments');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON "0"', 'API env validation must enforce cached SDK generation path');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_SDK_GENERATION_SOURCE "original_verified"', 'API env validation must enforce direct-quality SDK generation source');
assertIncludes(validateEnv, 'DRAPIXAI_AI_SERVICE_TOKEN', 'Env validation must require API-to-AI service token');
assertIncludes(validateEnv, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Env validation must require the dashboard proxy token');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_DASHBOARD_PROXY_TOKEN 32', 'Env validation must require a strong dashboard proxy token');
assertIncludes(validateEnv, 'require_min_length JWT_SECRET 32', 'API env validation must require a strong JWT secret');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_AUTH_SYNC_TOKEN 32', 'Env validation must require a strong auth sync token');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_AI_SERVICE_TOKEN 32', 'Env validation must require a strong AI service token');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_STOREFRONT_TOKEN_SECRET 32', 'Shopify storefront tokens must use a dedicated strong secret');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_AUTH_SYNC_TOKEN', 'Production env set validation must compare auth sync token across API and web');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Production env set validation must compare dashboard proxy token across API and web');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_AI_SERVICE_TOKEN', 'Production env set validation must compare AI service token across API and AI');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_ADMIN_TOKEN', 'Production env set validation must compare admin token across API and AI');
assertIncludes(validateProductionEnvSet, 'git -C "$repo_root" check-ignore -q "$env_file"', 'Production env set validation must verify every real env file is ignored by Git');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_AUTH_SYNC_TOKEN', 'PowerShell env set validation must compare auth sync token across API and web');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'PowerShell env set validation must compare dashboard proxy token across API and web');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_AI_SERVICE_TOKEN', 'PowerShell env set validation must compare AI service token across API and AI');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_ADMIN_TOKEN', 'PowerShell env set validation must compare admin token across API and AI');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-RequiredKeys $apiEnv', 'PowerShell env set validation must validate the complete API profile');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-RequiredKeys $webEnv', 'PowerShell env set validation must validate the complete web profile');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-RequiredKeys $aiEnv', 'PowerShell env set validation must validate the complete AI profile');
assertIncludes(validateProductionEnvSetPowerShell, 'DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK = "0"', 'PowerShell env validation must reject production local-storage fallback');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-NumberAtLeast $apiEnv "DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE" 0.95', 'PowerShell env validation must enforce the API launch quality floor');
assertIncludes(validateProductionEnvSetPowerShell, 'DRAPIXAI_AUTO_REJECT_BAD_RESULTS = "1"', 'PowerShell production validation must require low-quality result rejection');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-NumberAtLeast $aiEnv "DRAPIXAI_MIN_QUALITY_SCORE" 0.95', 'PowerShell env validation must enforce the AI launch quality floor');
assertIncludes(validateProductionEnvSetPowerShell, 'git -C $repoRoot check-ignore -q $envFile', 'PowerShell env set validation must verify every real env file is ignored by Git');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_ADMIN_TOKEN 32', 'Env validation must require a strong admin token');
assertIncludes(validateEnv, 'require_min_length NEXTAUTH_SECRET 32', 'Web env validation must require a strong NextAuth secret');
assertIncludes(validateEnv, 'require_min_length DASHBOARD_SESSION_SECRET 32', 'Web env validation must require a strong dashboard session secret');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_ENV "production"', 'AI env validation must enable production fail-closed checks');
assertIncludes(validateEnv, 'ai|ai-reference)', 'AI env validation must expose a separate direct-process reference profile');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_ENV "staging"', 'Reference AI validation must reject production classification');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_GPU_PRESET "runpod-a100"', 'Reference AI validation must require the A100 reference preset');
assertIncludes(validateEnv, 'if [[ "$profile" == "ai" ]]', 'Only production AI validation may require release-container evidence');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_TRYON_ENGINE "catvton"', 'AI env validation must enforce CatVTON');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK "0"', 'AI env validation must keep CatVTON output safety enabled');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_CANDIDATE_COUNT "1"', 'AI env validation must enforce Standard-only candidate count');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_REVIEW_RETENTION_DAYS "0"', 'API env validation must prohibit persistent shopper review media');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_TRANSIENT_SPOOL_DIR "/dev/shm/drapixai-tryon-spool"', 'AI env validation must keep shopper media on volatile memory storage');
assertIncludes(validateProductionEnvSetPowerShell, 'DRAPIXAI_REVIEW_RETENTION_DAYS = "0"', 'Windows production env validation must prohibit persistent shopper review media');
assertIncludes(validateEnv, 'require_number_at_least DRAPIXAI_MIN_QUALITY_SCORE "0.95"', 'AI env validation must enforce launch quality threshold');
assertIncludes(aiEnvProfileTests, 'production_without_release_image', 'AI environment regression must reject unpinned production deployment');
assertIncludes(aiEnvProfileTests, 'reference_claiming_production', 'AI environment regression must reject false production classification');
assertIncludes(aiEnvProfileTests, 'reference_with_persistent_spool', 'AI environment regression must reject persistent shopper image spooling');
assertIncludes(launchWorkflow, 'bash deploy/scripts/test-ai-env-profiles.sh', 'Launch CI must execute AI environment boundary regressions on Linux');
assertIncludes(apiProductionExample, 'DRAPIXAI_REQUIRE_GARMENT_CACHE=1', 'API production example must require cached garments');
assertIncludes(apiProductionExample, 'DRAPIXAI_AUTH_SYNC_TOKEN=replace-with-the-same-web-api-auth-sync-token', 'API production example must include auth sync token');
assertIncludes(apiProductionExample, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN=replace-with-the-same-dashboard-proxy-token', 'API production example must include dashboard proxy token');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON=0', 'API production example must prefer cached assets');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_GENERATION_SOURCE=original_verified', 'API production example must use original garment source after cache validation');
assertIncludes(apiProductionExample, 'DRAPIXAI_AI_SERVICE_TOKEN=replace-with-a-long-random-secret', 'API production example must include AI service token');
assertIncludes(apiProductionExample, 'DRAPIXAI_STOREFRONT_TOKEN_SECRET=replace-with-a-different-long-random-secret', 'API production example must keep storefront signing separate from other secrets');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_STOREFRONT_TOKEN_SECRET', 32)", 'Shopify-enabled production startup must fail closed without a storefront signing secret');
assertNotIncludes(aiProductionExample, 'DRAPIXAI_ENHANCED_', 'AI production example must not expose enhanced-mode env names');
assertIncludes(aiProductionExample, 'DRAPIXAI_ENV=production', 'AI production example must set production mode');
assertIncludes(aiProductionExample, 'DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell', 'AI production example must target the primary RTX PRO 6000 production runtime');
assertIncludes(productionReadiness, 'RTX PRO 6000 Production Runtime', 'Production readiness guide must identify the primary RTX GPU runtime');
assertIncludes(productionReadiness, 'not the production source of truth', 'Production readiness guide must keep reference RunPod validation separate from production');
assertIncludes(productionReadiness, 'three-tenant batch leaves at least 20% VRAM headroom', 'Production readiness guide must retain the three-tenant GPU safety acceptance condition');
assertIncludes(productionReadiness, 'primary RTX PRO 6000 Blackwell runtime', 'Remaining launch evidence must target the primary production GPU');
assertNotIncludes(productionReadiness, 'after A100 direct/SDK parity', 'Production evidence must not retain the retired A100 promotion condition');
assertNotIncludes(productionReadiness, 'record its image, headers', 'Production evidence must not retain shopper output images by default');
assertIncludes(launchSupportPlaybook, 'RTX PRO 6000 production runtime passes', 'Launch support playbook must use the primary production GPU in its go-live criteria');
assertIncludes(workstationPreflight, 'rtx-pro-6000-blackwell', 'Workstation preflight must require the primary RTX GPU preset');
assertIncludes(workstationPreflight, 'DRAPIXAI_EXPECTED_GIT_REF', 'Workstation preflight must pin the exact release commit');
assertIncludes(workstationPreflight, 'DRAPIXAI_NVIDIA_CUDA_PROBE_IMAGE', 'Workstation preflight must verify Docker GPU access with a digest-pinned probe image');
assertIncludes(workstationPreflight, 'models/model-lock.json', 'Workstation preflight must require immutable model-lock evidence');
assertIncludes(workstationPreflight, 'verify-standard-release-profile.py', 'Workstation preflight must validate the Standard-only release profile');
assertIncludes(workstationPreflight, 'Production workstation checkout must be clean.', 'Workstation preflight must reject unreviewed production source changes');
assertIncludes(aiProductionExample, 'DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK=0', 'AI production example must keep the CatVTON safety checker enabled');
assertIncludes(aiServer, 'DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK must equal 0', 'AI production startup must fail closed if output safety is disabled');
assertIncludes(aiProductionExample, 'DRAPIXAI_AI_SERVICE_TOKEN=replace-with-the-same-api-ai-service-token', 'AI production example must include matching AI service token');
assertIncludes(webProductionExample, 'DRAPIXAI_AUTH_SYNC_TOKEN=replace-with-the-same-web-api-auth-sync-token', 'Web production example must include auth sync token');
assertIncludes(webProductionExample, 'DASHBOARD_SESSION_SECRET=replace-with-a-long-random-secret', 'Web production example must include explicit dashboard session secret');
assertIncludes(webProductionExample, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN=replace-with-the-same-dashboard-proxy-token', 'Web production example must include matching dashboard proxy token');
assertIncludes(initProductionEnv, '$authSyncToken = New-SecretValue', 'Production env initializer must generate an auth sync token');
assertIncludes(initProductionEnv, '$dashboardProxyToken = New-SecretValue', 'Production env initializer must generate a dashboard proxy token');
assertIncludes(initProductionEnv, '$dashboardSessionSecret = New-SecretValue', 'Production env initializer must generate a dashboard session secret');
assertIncludes(initProductionEnv, '$aiServiceToken = New-SecretValue', 'Production env initializer must generate an API-to-AI service token');
assertIncludes(initProductionEnv, '"DRAPIXAI_AUTH_SYNC_TOKEN" = $authSyncToken', 'Production env initializer must write the same auth sync token to API and web envs');
assertIncludes(initProductionEnv, '"DASHBOARD_SESSION_SECRET" = $dashboardSessionSecret', 'Production env initializer must write the dashboard session secret to the web env');
assertIncludes(initProductionEnv, '"DRAPIXAI_DASHBOARD_PROXY_TOKEN" = $dashboardProxyToken', 'Production env initializer must write the same dashboard proxy token to API and web envs');
assertIncludes(initProductionEnv, '"DRAPIXAI_AI_SERVICE_TOKEN" = $aiServiceToken', 'Production env initializer must write the same AI service token to API and AI envs');
assertIncludes(gitignore, 'deploy/env/*.production.env', 'Real production env files must stay out of Git');
assertIncludes(gitattributes, '*.sh text eol=lf', 'Linux deployment scripts must be exported with LF line endings');
assertIncludes(gitignore, '.next-review/', 'Git ignore must exclude Next review build artifacts');
assertIncludes(gitignore, 'output/', 'Generated catalog output must stay out of Git');
assertIncludes(gitignore, 'outputs/', 'Generated launch package outputs must stay out of Git');
assertIncludes(setupBatch, 'LEGACY_SETUP_DISABLED', 'Legacy destructive Setup.bat scaffold must stay disabled');
assertNotIncludes(setupBatch, 'your-super-secret-jwt-key', 'Legacy setup must not ship weak JWT examples');
assertNotIncludes(setupBatch, 'ALLOWED_ORIGINS="*"', 'Legacy setup must not write wildcard origins');
assertIncludes(nextConfig, 'poweredByHeader: false', 'Web app must disable the Next.js powered-by header');
assertIncludes(webProxy, 'Content-Security-Policy', 'Web proxy must send a nonce-based Content Security Policy');
assertIncludes(webProxy, 'DRAPIXAI_WEB_CSP_CONNECT_SRC', 'Web CSP must require explicit extra browser connect origins');
assertIncludes(webProxy, "'nonce-${nonce}'", 'Web CSP must use a fresh request nonce');
assertNotIncludes(webProxy, "'unsafe-inline'", 'Web CSP must not allow unsafe inline script or style execution');
assertIncludes(webProxy, "frame-ancestors 'none'", 'Web CSP must prevent clickjacking frame ancestors');
assertIncludes(webProxy, "object-src 'none'", 'Web CSP must block legacy plugin content');
assertIncludes(nextConfig, 'X-Content-Type-Options', 'Web app must send no-sniff protection');
assertIncludes(nextConfig, 'Referrer-Policy', 'Web app must send a referrer policy');
assertIncludes(nextConfig, 'Permissions-Policy', 'Web app must restrict sensitive browser APIs');
assertIncludes(nextConfig, 'X-Frame-Options', 'Web app must send legacy frame protection');
assertIncludes(nextConfig, 'Strict-Transport-Security', 'Web app must send production HSTS');
assertIncludes(nextConfig, 'privateNoIndexSources', 'Web app must define private noindex routes');
assertIncludes(nextConfig, 'X-Robots-Tag', 'Web app must send X-Robots-Tag on private app surfaces');
assertIncludes(nextConfig, "'/dashboard'", 'Dashboard page must be noindexed');
assertIncludes(nextConfig, "'/admin'", 'Admin page must be noindexed');
assertIncludes(nextConfig, "'/api/:path*'", 'API routes must be noindexed');
assertIncludes(nextConfig, 'includeSubDomains; preload', 'Web HSTS must cover subdomains and preload readiness');
assertIncludes(productionReadiness, 'Admin dashboard traffic must go through the same-origin Next admin proxy', 'Production readiness doc must call out admin proxy security');
assertIncludes(productionReadiness, 'same-origin Next dashboard proxy', 'Production readiness doc must call out dashboard proxy security');
assertIncludes(productionReadiness, 'must not be persisted in browser `localStorage`', 'Production readiness doc must call out browser API key persistence rules');
assertIncludes(productionReadiness, 'stable failure codes/reasons', 'Production readiness doc must call out sanitized account/store errors');
assertIncludes(productionReadiness, 'sanitize configurable CSS values and logo URLs', 'Production readiness doc must call out SDK markup sanitization');
assertIncludes(productionReadiness, 'production security headers from `next.config.js`', 'Production readiness doc must call out web security headers');
assertIncludes(productionReadiness, 'reject cross-origin session and proxy mutations', 'Production readiness doc must call out CSRF protection for cookie-backed routes');
assertIncludes(productionReadiness, 'shopper person photos and generated previews are transient-only', 'Production readiness doc must define transient-only shopper media');
assertIncludes(productionReadiness, 'tryon:purge-review-retention -- --dry-run', 'Production readiness doc must include retention purge dry-run command');
assertIncludes(read('apps/api/package.json'), 'email:send-test', 'API package must expose SMTP launch verification command');
assertIncludes(read('apps/api/package.json'), 'prisma:migrate:deploy', 'API package must expose repeatable production migration deployment');
assertIncludes(smtpTestScript, 'SMTP_TEST_TO', 'SMTP test command must support env-based recipient configuration');
assertIncludes(smtpTestScript, "event: log.event", 'SMTP test command must report the EmailLog event');
assertIncludes(smtpTestScript, "status: log.status", 'SMTP test command must report the EmailLog status');
assertIncludes(smtpTestScript, "log.status !== 'sent'", 'SMTP test command must fail unless EmailLog confirms sent status');
assertIncludes(smtpTestScript, 'SMTP verification requires an existing DrapixAI account email', 'SMTP test command must require a real account for audit logging');
assertIncludes(emailerService, 'Promise<EmailSendResult>', 'Email helper must return structured delivery status');
assertIncludes(emailerService, "error: 'SMTP_HOST_NOT_CONFIGURED'", 'Email helper must report missing SMTP config instead of silently passing');
assertIncludes(smtpTestScript, 'const redactSensitiveText =', 'SMTP launch verifier must redact sensitive error text');
assertNotIncludes(smtpTestScript, 'console.error(error);', 'SMTP launch verifier must not dump raw exception objects');
assertIncludes(smtpTestScript, 'error: result.error ? redactSensitiveText(result.error) : result.error', 'SMTP launch verifier must redact email send errors before logging');
assertIncludes(watermarkService, 'const escapeSvgText =', 'Watermark SVG text must be escaped');
assertIncludes(watermarkService, 'const sanitizeWatermarkColor =', 'Watermark SVG color must be allowlisted');
assertIncludes(watermarkService, 'const redactObjectKey =', 'Watermark logs must redact storage object keys');
assertNotIncludes(watermarkService, '`Downloading ${inputKey} from S3...`', 'Watermark logs must not print raw input object keys');
assertNotIncludes(sdkRoute, '`Uploaded session image to ${inputKey}`', 'SDK logs must not print raw shopper object keys');
assertNotIncludes(watermarkService, '`Uploading to ${outputKey}...`', 'Watermark logs must not print raw output object keys');
assertNotIncludes(watermarkService, "console.error('Watermark processing error:', error);", 'Watermark errors must not dump raw exception objects');
assertIncludes(emailerService, 'logId: log.id', 'Email helper must expose the EmailLog id for launch verification');
assertIncludes(productionReadiness, 'npm --prefix apps/api run email:send-test -- --to=admin@yourbrand.com', 'Production readiness doc must include SMTP launch verification command');
assertIncludes(read('apps/api/package.json'), 'tryon:purge-review-retention', 'API package must expose try-on retention purge command');
assertIncludes(read('apps/api/package.json'), 'privacy:verify-shopper-media', 'API package must expose shopper-media privacy evidence command');
assertIncludes(read('apps/api/package.json'), 'privacy:purge-legacy-media', 'API package must expose legacy media purge command');
assertIncludes(retentionPurgeScript, 'DEFAULT_RETENTION_DAYS = 0', 'Retention purge must default to immediate legacy-media deletion');
assertIncludes(retentionPurgeScript, '--confirm', 'Retention purge must require explicit confirmation before deleting');
assertIncludes(reviewRetentionService, 'DeleteObjectCommand', 'Retention service must delete S3 review images');
assertIncludes(reviewRetentionService, 'removeLocalStoredFile(storedUrl, REVIEW_PREFIX)', 'Retention service must guard local review image deletion');
assertIncludes(reviewRetentionService, "updates[field] = null", 'Retention service must clear only successfully deleted review URLs');
assertIncludes(apiServer, "cron.schedule('*/15 * * * *'", 'Legacy shopper-media cleanup must run automatically every 15 minutes');
assertIncludes(reviewRetentionService, "action: 'retention.tryon_review.completed'", 'Automatic retention must append deletion evidence to the audit chain');
assertIncludes(securityHelpers, 'removeLocalStoredFile', 'Security helper must support guarded local retention deletion');
assertIncludes(securityHelpers, 'cleanupExpiredUploadFiles', 'Interrupted Multer uploads must have a bounded failsafe cleanup');
assertIncludes(apiServer, "cron.schedule('*/5 * * * *'", 'Transient upload cleanup must run every five minutes');
assertIncludes(privacyPage, 'are not persistently stored', 'Privacy page must prohibit persistent shopper photo/result storage');
assertIncludes(privacyPage, '15-minute failsafe cleanup window', 'Privacy page must publish the interrupted-job cleanup deadline.');
assertIncludes(read('docs/public-launch-readiness-checklist.md'), '15-minute interrupted-job failsafe', 'Launch checklist must require evidence for the public transient-media policy.');
assertIncludes(privacyPage, 'privacy@drapixai.com', 'Privacy page must publish privacy contact');
assertIncludes(privacyPage, 'The launch app requests read_products only', 'Privacy policy must disclose Shopify least-privilege product access');
assertIncludes(privacyPage, 'does not request Shopify customer, order, payment, or checkout data', 'Privacy policy must disclose excluded Shopify protected data');
assertIncludes(privacyPage, 'mandatory shop-redact request', 'Privacy policy must disclose Shopify uninstall and redaction cleanup');
assertIncludes(sdkJs, 'is not persistently saved, and is never used to train AI models', 'SDK privacy copy must disclose transient-only processing and no training use');
assertIncludes(sdkJs, "form.append('shopper_consent', 'true')", 'Browser SDK must submit explicit shopper consent');
assertIncludes(sdkJs, "form.append('privacy_policy_version', '2026-08-04')", 'Browser SDK must bind consent to the current privacy policy');
assertIncludes(demoClient, "form.append('shopper_consent', 'true')", 'Public demo must submit explicit shopper consent');
assertIncludes(demoClient, "form.append('privacy_policy_version', '2026-08-04')", 'Public demo must bind consent to the current privacy policy');
assertIncludes(demoClient, 'is never used to train AI models', 'Public demo must disclose no-training treatment before upload');
assertIncludes(sdkRoute, "error: 'SHOPPER_CONSENT_REQUIRED'", 'Try-on API must reject requests without current explicit shopper consent');
assertIncludes(sdkRoute, 'personImageUrl: null', 'Try-on records must not persist shopper person photos');
assertIncludes(sdkRoute, 'resultImageUrl: null', 'Try-on records must not persist generated shopper previews');
assertNotIncludes(sdkRoute, 'const personReviewUrl = await uploadReviewImage', 'Try-on route must not upload shopper person photos for review');
assertNotIncludes(sdkRoute, 'const resultReviewUrl = await uploadReviewImage', 'Try-on route must not upload generated shopper previews for review');
assertIncludes(sdkRoute, "action: 'privacy.tryon_consent.accepted'", 'Consent must be recorded in the immutable audit chain');
assertIncludes(sdkRoute, "action: 'privacy.tryon_media.not_retained'", 'Non-retention must be recorded in the immutable audit chain');
assertIncludes(shopperMediaPrivacyVerifier, 'PERSISTENT_SHOPPER_MEDIA_REFERENCES', 'Privacy verifier must fail on database shopper-media references');
assertIncludes(shopperMediaPrivacyVerifier, 'ORPHANED_SHOPPER_MEDIA_OBJECTS', 'Privacy verifier must fail on orphaned shopper-media objects');
assertIncludes(shopperMediaPrivacyVerifier, 'LEGACY_RENDER_MEDIA_REFERENCES', 'Privacy verifier must fail on historical legacy render references');
assertIncludes(shopperMediaPrivacyVerifier, 'LEGACY_RENDER_MEDIA_OBJECTS', 'Privacy verifier must fail on historical legacy render objects');
assertIncludes(legacyRenderMediaPurge, 'process.argv.includes(\'--confirm\')', 'Legacy render purge must require explicit confirmation before deletion');
assertIncludes(legacyRenderMediaPurge, 'bucket === STORAGE_BUCKET', 'Legacy render purge must reject storage URLs outside the configured bucket');
assertIncludes(legacyRenderMediaPurge, 'privacy.legacy_render_media.purged', 'Legacy render purge must append immutable deletion evidence');
assertIncludes(productionReadiness, 'privacy:purge-legacy-media', 'Production readiness must require legacy media cleanup before privacy certification');
assertIncludes(shopperMediaPrivacyVerifier, 'CONSENT_AUDIT_EVIDENCE_MISSING', 'Privacy verifier must require consent audit evidence');
assertIncludes(aiServer, 'sanitized_validation_error', 'AI validation responses must not echo image payload input');
assertIncludes(aiServer, '"x-drapixai-training-use": "none"', 'AI service must expose the no-training contract');
assertIncludes(sdkJs, 'enableDownload: options.enableDownload !== false', 'Browser SDK must let brands disable shopper result downloads while keeping the default enabled');
assertIncludes(sdkJs, "config.enableDownload ? 'display:inline-flex;' : 'display:none;'", 'Browser SDK must hide the Download button when a brand disables downloads');
assertIncludes(sdkJs, 'if (downloadBtn && config.enableDownload)', 'Browser SDK must not bind download behavior when downloads are disabled');
assertIncludes(sdkReactDoc, '`enableDownload`', 'SDK docs must document the shopper download toggle');
assertIncludes(productionReadiness, 'npm run start:local', 'Production readiness doc must include one-command local stack startup');
assertIncludes(productionReadiness, 'localhost:5433', 'Production readiness doc must match the local Postgres port override');
assertIncludes(productionReadiness, 'prove-live-stack.ps1 -ApiUrl http://localhost:8000', 'Production readiness doc must include local live-stack proof command');
assertIncludes(productionReadiness, 'validate-production-env-set.sh', 'Production readiness doc must include cross-file env-set validation');
assertIncludes(productionReadiness, 'validate-production-env-set.ps1', 'Production readiness doc must include Windows cross-file env-set validation');
assertIncludes(cacheRegenerationScript, 'redactSensitiveText', 'Cache regeneration troubleshooting must redact sensitive connection strings');
assertIncludes(cacheRegenerationScript, 'formatLogError', 'Cache regeneration command must sanitize uncaught operational errors');
assertNotIncludes(cacheRegenerationScript, 'console.error(error);', 'Cache regeneration command must not dump raw exception objects');
assertIncludes(retentionPurgeScript, 'formatLogError', 'Retention purge command must sanitize uncaught operational errors');
assertIncludes(reviewRetentionService, 'formatLogError', 'Retention service must sanitize item-level deletion failures');
assertNotIncludes(retentionPurgeScript, 'console.error(error);', 'Retention purge command must not dump raw exception objects');
assertIncludes(cacheRegenerationScript, 'DATABASE_URL configured:', 'Cache regeneration troubleshooting may report whether DATABASE_URL exists');
assertNotIncludes(cacheRegenerationScript, 'DATABASE_URL=${process.env.DATABASE_URL', 'Cache regeneration troubleshooting must never print DATABASE_URL');
assertIncludes(productionReadiness, '- `DRAPIXAI_AUTH_SYNC_TOKEN`\n- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`\n- `DRAPIXAI_AI_URL`', 'Production readiness doc must list dashboard proxy token as a required API env');
assertIncludes(productionReadiness, '- `DRAPIXAI_AUTH_SYNC_TOKEN`\n- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`\n\nRequired only if Google login is enabled:', 'Production readiness doc must list dashboard proxy token as a required Web env');

assertIncludes(smokeTest, '/sdk/garments', 'Deployment smoke test must upload and cache garment assets');
assertIncludes(smokeTest, '/sdk/catalog/sync', 'Deployment smoke test must sync product catalog mapping');
assertIncludes(smokeTest, '/sdk/matches/${GARMENT_ID}/confirm', 'Deployment smoke test must confirm garment-product mapping');
assertIncludes(smokeTest, 'x-drapixai-dashboard-proxy-token', 'Deployment smoke test must send dashboard proxy token for management calls');
assertIncludes(smokeTest, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Deployment smoke test must support dashboard proxy token from env');
assertIncludes(smokeTest, 'DRAPIXAI_SMOKE_PREPARE_ACCOUNT', 'Deployment smoke test must explicitly opt into development-only storefront preparation');
assertIncludes(smokeTest, 'prepare-smoke-account.ts', 'Deployment smoke test must prepare its isolated storefront without weakening the public API');
assertIncludes(smokeAccountPrepare, "process.env.NODE_ENV === 'production'", 'Smoke storefront preparation must be impossible in production');
assertIncludes(smokeAccountPrepare, "DRAPIXAI_ALLOW_SMOKE_ACCOUNT_PREPARE !== '1'", 'Smoke storefront preparation must require an explicit server-side gate');
assertIncludes(smokeAccountPrepare, '/^deploy-smoke-[0-9]+@example\\.com$/', 'Smoke storefront preparation must accept only isolated test accounts');
assertIncludes(smokeTest, 'productId=${PRODUCT_ID}', 'Deployment smoke test must try on through product mapping');
assertIncludes(smokeTest, 'quality=standard', 'Deployment smoke test must request Standard quality');
assertIncludes(smokeTest, 'shopper_consent=true', 'Deployment smoke test must prove explicit shopper consent');
assertIncludes(smokeTest, 'privacy_policy_version=2026-08-04', 'Deployment smoke test must use the current privacy policy');
assertIncludes(smokeTest, 'GARMENT_CATEGORY="${GARMENT_CATEGORY:-shirt}"', 'Deployment smoke test must support the real garment category');
assertIncludes(smokeTest, '-F "category=${GARMENT_CATEGORY}"', 'Garment preprocessing must receive the configured garment category');
assertIncludes(smokeTest, '\\"category\\":\\"${GARMENT_CATEGORY}\\"', 'Catalog mapping must retain the configured garment category');
assertIncludes(runLaunchTryon, 'GARMENT_CATEGORY="tshirt"', 'Launch harness must classify the graphic tee test asset correctly');
assertIncludes(smokeTestPowerShell, '/sdk/garments', 'PowerShell smoke test must upload and cache garment assets');
assertIncludes(smokeTestPowerShell, '/sdk/catalog/sync', 'PowerShell smoke test must sync product catalog mapping');
assertIncludes(smokeTestPowerShell, '/sdk/matches/$GarmentId/confirm', 'PowerShell smoke test must confirm garment-product mapping');
assertIncludes(smokeTestPowerShell, 'x-drapixai-dashboard-proxy-token', 'PowerShell smoke test must send dashboard proxy token for management calls');
assertIncludes(smokeTestPowerShell, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'PowerShell smoke test must support dashboard proxy token from env');
assertIncludes(smokeTestPowerShell, 'productId=$ProductId', 'PowerShell smoke test must try on through product mapping');
assertIncludes(smokeTestPowerShell, 'quality=standard', 'PowerShell smoke test must request Standard quality');
assertIncludes(smokeTestPowerShell, 'shopper_consent=true', 'PowerShell smoke test must prove explicit shopper consent');
assertIncludes(smokeTestPowerShell, 'x-drapixai-garment-cache-status', 'PowerShell smoke test must assert SDK cache metadata headers');
assertIncludes(smokeTestPowerShell, 'http://localhost:3000', 'PowerShell smoke test must use local storefront origin by default');
assertIncludes(smokeTestPowerShell, 'DRAPIXAI_SMOKE_SKIP_TRYON=1', 'PowerShell smoke test must support local no-GPU onboarding/cache proof');
assertIncludes(smokeTest, 'assert-smoke-headers.py', 'Deployment smoke test must assert launch SDK response headers');
assertIncludes(smokeTestPowerShell, 'assert-smoke-headers.py', 'PowerShell smoke test must assert launch SDK response headers');
assertIncludes(smokeHeaderAssert, 'DRAPIXAI_LAUNCH_MIN_QUALITY_SCORE', 'Smoke header assertion must enforce configurable launch quality threshold');
assertIncludes(smokeHeaderAssert, 'DRAPIXAI_LAUNCH_TARGET_LATENCY_MS', 'Smoke header assertion must enforce configurable launch latency target');
assertIncludes(smokeHeaderAssert, 'original_verified_cache_gate', 'Smoke header assertion must require direct-quality cached garment source');
assertIncludes(smokeHeaderAssert, 'garment cache status must be verified', 'Smoke header assertion must require verified garment cache status');
assertIncludes(smokeHeaderAssert, 'SDK warnings must be empty for launch proof', 'Smoke header assertion must reject warning-bearing launch outputs');
assertIncludes(runLaunchTryon, 'Launch try-on gates failed', 'RunPod launch try-on test must enforce final direct and SDK launch gates');
assertIncludes(runLaunchTryon, 'direct quality', 'RunPod launch try-on test must enforce direct quality threshold');
assertIncludes(runLaunchTryon, 'SDK latency', 'RunPod launch try-on test must enforce SDK latency threshold');
assertIncludes(runLaunchTryon, '"runtime_profile": "runpod-reference"', 'RunPod evidence must identify itself as reference quality evidence');
assertIncludes(runLaunchTryon, '"production_runtime_equivalent": False', 'RunPod evidence must not claim Blackwell production-runtime equivalence');
assertIncludes(runLaunchTryon, '"quality_evidence_scope": "reference-quality-and-sdk-parity"', 'RunPod evidence must state its permitted launch-evidence scope');
assertIncludes(runLaunchTryon, '"--query-gpu=name,memory.total,driver_version"', 'RunPod evidence must record GPU and driver provenance');
assertIncludes(runLaunchTryon, '["git", "rev-parse", "HEAD"]', 'RunPod evidence must record the exact release commit');
assertIncludes(proveLiveShell, '"checks.database.ready" \'true\'', 'Live proof shell must verify DB through API readiness');
assertIncludes(proveLiveShell, '"checks.redis" \'true\'', 'Live proof shell must verify Redis through API readiness');
assertIncludes(proveLiveShell, '"checks.ai.status" \'"ready"\'', 'Live proof shell must verify AI through API readiness');
assertIncludes(proveLivePowerShell, 'Database ready through API', 'Live proof PowerShell must verify DB');
assertIncludes(proveLivePowerShell, 'Redis ready through API', 'Live proof PowerShell must verify Redis');
assertIncludes(proveLivePowerShell, 'AI ready through API', 'Live proof PowerShell must verify AI');
assertIncludes(proveLiveShell, '"services.storefront" \'true\'', 'Live proof shell must verify the storefront through web health');
assertIncludes(proveLiveShell, '"services.ai" \'true\'', 'Live proof shell must verify AI through web health');
assertIncludes(proveLivePowerShell, '$webHealth.status -eq "operational"', 'Live proof PowerShell must match the web health contract');
assertIncludes(proveLivePowerShell, 'Web AI ready', 'Live proof PowerShell must verify AI through web health');
assertIncludes(proveLiveShell, 'resolve_dashboard_proxy_token', 'Live proof shell must resolve dashboard proxy token for SDK smoke flow');
assertIncludes(proveLiveShell, 'DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token" bash', 'Live proof shell must pass dashboard proxy token to SDK smoke flow');
assertIncludes(localPreflight, 'Get-LocalSetting', 'Local preflight must read local .env port overrides');
assertIncludes(localPreflight, "(?m)^ Server:", 'Local preflight must require a reachable Docker Server rather than only the Docker client.');
assertIncludes(localPreflight, 'Test-LocalPortOpen', 'Local preflight must accept IPv4 or IPv6 localhost bindings');
assertIncludes(localPreflight, 'Test-DockerPublishedPort', 'Local preflight must verify Docker port bindings, not only open localhost ports');
assertIncludes(localPreflight, 'Get-PortOwnerDetail', 'Local preflight must report which container owns an occupied port');
assertIncludes(localPreflight, 'DRAPIXAI_POSTGRES_PORT=5433', 'Local preflight must show the operator how to recover from a Postgres port conflict');
assertIncludes(localPreflight, 'Docker port publish: drapixai-postgres $postgresPort', 'Local preflight must catch Postgres port conflicts');
assertIncludes(dockerCompose, '${DRAPIXAI_POSTGRES_PORT:-5432}:5432', 'Local compose must allow overriding Postgres host port');
assertIncludes(dockerCompose, '${DRAPIXAI_REDIS_PORT:-6379}:6379', 'Local compose must allow overriding Redis host port');
assertIncludes(dockerCompose, '${DRAPIXAI_MINIO_API_PORT:-9000}:9000', 'Local compose must allow overriding MinIO API host port');
assertIncludes(localPreflight, 'npm run dev:api', 'Local preflight must explain how to start the API after infra checks');
assertIncludes(localPreflight, 'npm run dev:web', 'Local preflight must explain how to start the web app after infra checks');
assertIncludes(localPreflight, 'prisma:migrate:deploy', 'Local preflight must explain how to repair a missing launch schema');
assertIncludes(localPreflight, 'uvicorn drapixai_ai.api.ai_server:app', 'Local preflight must explain how to start the AI API after infra checks');
assertIncludes(localPreflight, 'API dependencies ready', 'Local preflight must verify API connectivity to DB, Redis, and AI');
assertIncludes(localPreflight, 'Local runtime secrets', 'Local preflight must verify shared API/web session secrets');
assertIncludes(localStart, 'runtime\\local-stack.env', 'Local startup must persist shared API/web test secrets outside source config');
assertIncludes(localStart, 'RandomNumberGenerator', 'Local startup secrets must use a cryptographic RNG');
assertIncludes(localPreflight, 'AI model and worker ready', 'Local preflight must reject an AI API without an active worker');
assertIncludes(localPreflight, 'Web operational', 'Local preflight must verify the complete web health contract');
assertIncludes(rootPackageJson, 'start:local', 'Root package scripts must expose one-command local stack startup');
assertIncludes(localStart, 'Test-PortListening', 'Local stack starter must be idempotent by checking ports before starting services');
assertIncludes(localStart, 'Normalize-ProcessPathEnvironment', 'Local stack starter must tolerate duplicate PATH casing in automation shells');
assertIncludes(localStart, 'docker-compose up -d postgres redis minio', 'Local stack starter must bring up required infra');
assertIncludes(localStart, 'RedirectStandardOutput', 'Local stack starter must capture stdout logs');
assertIncludes(localStart, 'RedirectStandardError', 'Local stack starter must capture stderr logs separately');
assertIncludes(localStart, 'local-preflight.ps1', 'Local stack starter must run preflight after startup');
assertIncludes(localStart, 'drapixai_ai.api.ai_server:app', 'Local stack starter must start the AI API service');
assertIncludes(localStart, 'drapixai_ai.worker.gpu_worker', 'Local stack starter must start the RQ AI worker');
assertIncludes(localStart, 'Test-AiWorkerReady', 'Local stack starter must avoid duplicate AI workers');
assertIncludes(runpodPreflight, 'bash -n "$script"', 'RunPod preflight must syntax-check launch shell scripts');
assertIncludes(runpodPreflight, 'DRAPIXAI_EXPECTED_GIT_REF', 'RunPod preflight must support exact launch commit verification');
assertIncludes(runpodPreflight, '== Repo Version ==', 'RunPod preflight must print repo branch and commit');
assertIncludes(runpodPreflight, 'redact_url_credentials', 'RunPod preflight must redact credential-bearing service URLs');
assertNotIncludes(runpodPreflight, 'echo "$DRAPIXAI_REDIS_URL"', 'RunPod preflight must not print raw Redis URLs');
assertIncludes(runpodPreflight, 'deploy/scripts/smoke-test.sh', 'RunPod preflight must include deployment smoke shell syntax check');
assertIncludes(runpodPreflight, 'deploy/runpod/run-launch-tryon-test.sh', 'RunPod preflight must include launch try-on shell syntax check');
assertIncludes(runpodPreflight, 'deploy/runpod/start-redis.sh', 'RunPod preflight must syntax-check the hardened Redis launcher');
assertIncludes(runpodPreflight, 'deploy/runpod/prepare-security-candidate.sh', 'RunPod preflight must syntax-check the isolated security candidate installer');
assertIncludes(runpodPreflight, 'validate_upper_body_50_tooling.py', 'RunPod preflight must validate strict matrix manifest and catalog tooling');
assertIncludes(runpodPreflight, 'deploy/env/ai.runpod.env', 'RunPod preflight must use the isolated reference environment by default');
assertIncludes(runpodPreflight, '"$DRAPIXAI_AI_VALIDATION_PROFILE"', 'RunPod preflight must select the explicit reference validator');
assertIncludes(runpodCommon, 'deploy/env/ai.runpod.env', 'RunPod services must not reuse the production AI env file');
assertBefore(runpodCommon, 'source "$DRAPIXAI_AI_ENV_FILE"', 'export DRAPIXAI_VENV="${DRAPIXAI_VENV:-$DRAPIXAI_APP_ROOT/.venv}"', 'RunPod services must load the persisted venv path before selecting Python');
assertIncludes(runpodCommon, '/dev/shm/drapixai-tryon-spool', 'RunPod shopper images must spool only in volatile shared memory');
assertIncludes(runpodFreshSetup, 'deploy/env/ai.runpod.env', 'Fresh RunPod setup must create a separate reference env file');
assertIncludes(runpodFreshSetup, 'deploy/env/ai.staging.example', 'Fresh RunPod setup must start from staging-safe defaults');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_AI_VALIDATION_PROFILE" "ai-reference"', 'Fresh RunPod setup must persist reference validation scope');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_VENV" "$VENV_DIR"', 'Fresh RunPod setup must persist a non-default local venv path');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_ENV" "staging"', 'Fresh RunPod setup must not classify direct processes as production containers');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_TRANSIENT_SPOOL_DIR" "/dev/shm/drapixai-tryon-spool"', 'Fresh RunPod setup must keep shopper media off persistent storage');
assertNotIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_TRANSIENT_SPOOL_DIR" "$APP_ROOT/runtime/tryon-spool"', 'Fresh RunPod setup must not persist shopper inputs under the repository');
assertIncludes(runpodRedisStart, '--bind 127.0.0.1', 'RunPod Redis must listen only on localhost');
assertIncludes(runpodRedisStart, '--protected-mode yes', 'RunPod Redis must keep protected mode enabled');
assertIncludes(runpodRedisStart, '--save ""', 'RunPod Redis must not persist queued image payloads to snapshots');
assertIncludes(runpodRedisStart, 'runtime/redis', 'RunPod Redis runtime files must stay outside the source tree');
assertIncludes(aiRequirements, 'python-multipart==0.0.32', 'Public AI uploads must use the patched multipart parser');
assertIncludes(aiRequirements, 'requests==2.34.2', 'AI outbound HTTP must use the patched Requests release');
assertIncludes(aiRequirements, 'pillow==12.3.0', 'Public image decoding must use the patched Pillow release');
assertIncludes(aiRequirements, 'matplotlib==3.9.4', 'AI runtime must not install the yanked Matplotlib 3.9.1 release');
assertIncludes(aiRequirements, 'rembg==2.0.69', 'Embedded rembg must remain on the proven NumPy 1.26-compatible library release');
assertIncludes(aiSecurityCandidate, 'torch==2.12.1', 'Security candidate must pin its audited CUDA 12.6-compatible Torch release');
assertIncludes(aiSecurityCandidate, 'torchvision==0.27.1', 'Security candidate must pin the matching TorchVision release');
assertIncludes(aiSecurityCandidate, 'xformers==0.0.35', 'Security candidate must pin the CUDA 12.6-compatible xFormers release');
assertIncludes(aiSecurityCandidate, 'fastapi==0.139.0', 'Security candidate must resolve a patched Starlette runtime');
assertIncludes(aiSecurityCandidate, 'uvicorn[standard]==0.40.0', 'Security candidate must pin the audited ASGI server release');
assertIncludes(aiSecurityCandidate, 'huggingface_hub==1.23.0', 'Security candidate must satisfy Transformers 5 Hub requirements');
assertIncludes(aiSecurityCandidate, 'safetensors==0.8.0', 'Security candidate must satisfy Transformers 5 safetensors requirements');
assertIncludes(aiSecurityCandidate, 'rembg==2.0.69', 'Security candidate must retain the proven library-only rembg release');
assertIncludes(launchWorkflow, 'pip-audit==2.9.0', 'Launch CI must install a pinned Python audit tool');
assertIncludes(launchWorkflow, '--requirement drapixai_ai/requirements.security-candidate.txt', 'Launch CI must audit secure AI candidate pins');
assertNotIncludes(launchWorkflow, '--no-deps', 'Launch CI must audit the complete resolved Python dependency graph');
assertNotIncludes(launchWorkflow, '--disable-pip', 'Launch CI must resolve transitive Python dependencies');
assertIncludes(launchWorkflow, '--ignore-vuln PYSEC-2026-2274', 'Launch CI may suppress only the documented rembg path-traversal server advisory');
assertIncludes(launchWorkflow, '--ignore-vuln GHSA-55v6-g8pm-pw4c', 'Launch CI may suppress only the documented rembg SSRF/CORS server advisory');
assertIncludes(launchWorkflow, '--ignore-vuln PYSEC-2026-3447', 'Launch CI may suppress only the documented macOS sdist Setuptools advisory');
assertIncludes(launchWorkflow, '--ignore-vuln GHSA-rrmf-rvhw-rf47', 'Launch CI may suppress only the documented local-only Torch JIT advisory');
assertIncludes(aiRuntimeSecurityDoc, 'does not install or expose the rembg HTTP server', 'Security docs must explain why rembg server advisories are non-reachable');
assertIncludes(aiRuntimeSecurityDoc, 'does not build or publish source distributions at runtime', 'Security docs must explain why the Setuptools sdist advisory is non-reachable');
assertIncludes(aiRuntimeSecurityDoc, 'does not invoke `torch.jit.script`', 'Security docs must explain why the Torch JIT advisory is non-reachable');
assertIncludes(runpodSecurityCandidate, '-m pip_audit', 'RunPod candidate preparation must audit the complete resolved dependency graph');
assertIncludes(catvtonDownload, 'revision=model_revision', 'Every downloaded model snapshot must use an immutable revision');
assertIncludes(catvtonDownload, 'model-lock.json', 'Model preparation must write an auditable model lock');
assertIncludes(catvtonPrepare, '7818397f25613beedb3d861a34769f607cfcf3b1', 'Fresh setup must pin the CatVTON source commit');
assertIncludes(catvtonPrepare, 'git", "-C", str(CATVTON), "apply", "--check"', 'Fresh setup must apply the tracked CatVTON production patch fail-closed');
assertIncludes(catvtonProductionPatch, 'vae_ckpt="stabilityai/sd-vae-ft-mse"', 'Tracked CatVTON patch must add an injectable local VAE path');
assertIncludes(catvtonEngine, 'revision=settings.catvton_model_revision', 'CatVTON fallback download must remain revision-pinned');
assertIncludes(catvtonEngine, 'vae_ckpt=settings.catvton_vae_model', 'CatVTON must load the pinned local VAE');
assertIncludes(catvtonProductionPatch, 'AutoencoderKL.from_pretrained(vae_ckpt)', 'Tracked CatVTON patch must replace the unpinned remote VAE before runtime');
assertIncludes(runpodPreflight, 'Immutable model revisions verified.', 'RunPod preflight must verify the model lock');
assertIncludes(runpodStartAll, 'flock -n 9', 'RunPod AI supervisor must reject duplicate service sets');
assertIncludes(runpodStartAll, '"$DRAPIXAI_AI_VALIDATION_PROFILE"', 'RunPod AI supervisor must use the selected fail-closed validation profile');
assertIncludes(runpodStartAll, 'trap cleanup EXIT', 'RunPod AI supervisor must clean up child processes on exit');
assertIncludes(runpodStartAll, 'bash "$SCRIPT_DIR/start-ai-worker.sh" &', 'RunPod AI supervisor must own the worker process');
assertIncludes(runpodStartAll, 'wait -n "$API_PID" "$WORKER_PID"', 'RunPod AI supervisor must detect either child exiting');
assertIncludes(runpodSecurityCandidate, 'runtime/security-candidate', 'Secure AI candidate must install outside the production venv');
assertIncludes(runpodSecurityCandidate, 'https://download.pytorch.org/whl/cu126', 'Secure AI candidate must use the official CUDA 12.6 PyTorch index');
assertIncludes(runpodSecurityCandidate, 'xops.memory_efficient_attention', 'Secure AI candidate must prove an xFormers CUDA kernel');
assertIncludes(runpodSecurityCandidate, '"production_environment_changed": False', 'Secure AI candidate report must state that production was not modified');
assertIncludes(gitignore, '*.rdb', 'Redis snapshots must never be exported from the source tree');
assertIncludes(runLaunchTryon, 'API_ENV_FILE=', 'RunPod launch try-on test must know where the API env file lives');
assertIncludes(runLaunchTryon, 'AI_ENV_FILE=', 'RunPod launch try-on test must use the isolated reference AI env file');
assertIncludes(runLaunchTryon, 'read_env_value DRAPIXAI_AI_SERVICE_TOKEN "$AI_ENV_FILE"', 'RunPod direct proof must load its service token from the reference env');
assertIncludes(runLaunchTryon, 'read_env_value DRAPIXAI_DASHBOARD_PROXY_TOKEN "$API_ENV_FILE"', 'RunPod launch try-on test must load dashboard proxy token from API env');
assertIncludes(runLaunchTryon, 'DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token"', 'RunPod launch try-on test must pass dashboard proxy token to SDK smoke flow');
assertIncludes(runLaunchTryon, '"${AI_URL%/}/ai/tryon"', 'RunPod direct proof must use the warm authenticated AI service');
assertIncludes(runLaunchTryon, 'x-drapixai-service-token', 'RunPod direct proof must authenticate to the AI service');
assertNotIncludes(runLaunchTryon, '"$PYTHON_BIN" deploy/runpod/smoke_tryon.py', 'RunPod launch proof must not cold-load a duplicate model process');
assertIncludes(runpodSdkApiSetup, 'DRAPIXAI_ALLOW_SMOKE_ACCOUNT_PREPARE=1', 'RunPod development SDK stack must explicitly enable isolated smoke-account preparation');
assertIncludes(runpodSdkApiSetup, 'DRAPIXAI_ADMIN_PASSWORD=' + '$' + '(generate_secret)', 'RunPod SDK/API setup must generate a unique admin password');
assertNotIncludes(runpodSdkApiSetup, 'DRAPIXAI_ADMIN_PASSWORD=ChangeMe123!', 'RunPod SDK/API setup must not write a fixed admin password');
assertIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"', 'RunPod SDK/API setup must not default MinIO password to a fixed value');
assertIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"', 'RunPod SDK/API setup must not default Postgres password to a fixed value');
assertIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(generate_secret)}"', 'RunPod SDK/API setup must generate a MinIO password');
assertIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_secret)}"', 'RunPod SDK/API setup must generate a Postgres password');
assertIncludes(runpodSdkApiSetup, 'npm --prefix apps/api run prisma:migrate:deploy', 'RunPod setup must deploy versioned Prisma migrations');
assertNotIncludes(runpodSdkApiSetup, 'npm --prefix apps/api run prisma:push', 'RunPod production setup must not use unversioned schema push');
assertNotIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-drapixai-local-secret}"', 'RunPod SDK/API setup must not write a fixed MinIO password');
assertNotIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-drapixai}"', 'RunPod SDK/API setup must not write a fixed Postgres password');
assertIncludes(runpodFreshSetup, 'codex/catvton-runpod-clean', 'RunPod setup-fresh-runpod.sh must default to launch branch');
assertIncludes(runpodFreshSetup, 'require_for_backend "DRAPIXAI_S3_SECRET_ACCESS_KEY"', 'RunPod fresh setup must require explicit S3 secrets when S3 cache is enabled');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_S3_ACCESS_KEY_ID" ""', 'RunPod fresh setup must leave S3 access key blank for local cache');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_S3_SECRET_ACCESS_KEY" ""', 'RunPod fresh setup must leave S3 secret key blank for local cache');
assertIncludes(runpodFreshSetup, 'grep -Ev "(TOKEN|SECRET|PASSWORD|ACCESS_KEY)"', 'RunPod fresh setup troubleshooting must avoid dumping raw env secrets');
assertIncludes(runpodFreshSetup, 'DRAPIXAI_SETUP_SKIP_REPO_SYNC', 'RunPod fresh setup must support a reviewed source overlay without pulling over it');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK" "0"', 'RunPod setup must normalize CatVTON output safety on');
assertIncludes(runpodFreshSetup, 'upsert_env "DRAPIXAI_ENABLE_LOWER_BODY" "0"', 'RunPod setup must keep unverified lower-body support disabled');
assertIncludes(runpodPreflight, '$DRAPIXAI_CATVTON_BASE_MODEL/safety_checker', 'RunPod preflight must verify CatVTON safety model files');
assertIncludes(runpodPreflight, '$DRAPIXAI_CATVTON_BASE_MODEL/feature_extractor', 'RunPod preflight must verify the safety feature extractor');
assertIncludes(runpodPreflight, 'CatVTON/resource/img/NSFW.jpg', 'RunPod preflight must verify the safety replacement image');
assertIncludes(runpodFreshSetup, 'requires an existing Git checkout', 'Overlay-safe setup mode must fail closed when no repository exists');
assertNotIncludes(runpodFreshSetup, '${DRAPIXAI_S3_ACCESS_KEY_ID:-local-runpod}', 'RunPod fresh setup must not write fake S3 access key defaults');
assertNotIncludes(runpodFreshSetup, '${DRAPIXAI_S3_SECRET_ACCESS_KEY:-local-runpod}', 'RunPod fresh setup must not write fake S3 secret defaults');
assertNotIncludes(runpodFreshSetup, 'Env file: cat ', 'RunPod fresh setup troubleshooting must not recommend printing raw env files');
assertIncludes(read('deploy/runpod/prepare-runpod-for-launch.sh'), 'codex/catvton-runpod-clean', 'RunPod prepare wrapper must default to launch branch');
assertIncludes(read('deploy/runpod/README.md'), 'DRAPIXAI_LAUNCH_MIN_QUALITY_SCORE', 'RunPod README must document strict launch quality gates');
assertIncludes(read('deploy/runpod/README.md'), 'DRAPIXAI_EXPECTED_GIT_REF', 'RunPod README must document optional exact commit pinning');

assertIncludes(homePage, 'Garment-faithful virtual try-on for fashion storefronts', 'Homepage must state product-faithful storefront positioning');
assertIncludes(homePage, 'confirmed-product-id', 'Homepage SDK snippet must use confirmed product mapping');
assertIncludes(homePage, "quality: 'standard'", 'Homepage SDK snippet must show Standard quality');
assertIncludes(homePage, 'targets warm results in 10-12 seconds', 'Homepage must frame latency as a target');
assertNotIncludes(homePage, 'photorealistic', 'Homepage must not overpromise photorealism');
assertNotIncludes(homePage, 'Sub-10', 'Homepage must not promise sub-10s rendering');
assertNotIncludes(homePage, 'Works with any platform', 'Homepage must not overpromise universal platform support');
assertIncludes(demoClient, 'image/jpeg,image/png,image/webp', 'Public demo must advertise only supported browser image types');
assertIncludes(demoClient, "parsed.protocol !== 'https:'", 'Public demo must reject insecure external walkthrough URLs');
assertIncludes(demoClient, "host === 'player.vimeo.com'", 'Public demo must allowlist supported embedded video hosts');
assertNotIncludes(demoClient, 'Add `NEXT_PUBLIC_DEMO_VIDEO_URL`', 'Public demo must not expose internal deployment instructions to prospects');
assertIncludes(shopifyConnectClient, 'connectionMessageFor', 'Shopify onboarding must translate callback failures into merchant-safe messages');
assertIncludes(shopifyConnectClient, 'This secure connection link has expired', 'Shopify onboarding must explain expired links with a recovery path');
assertNotIncludes(shopifyConnectClient, "setMessage(payload?.error || 'SHOPIFY_LINK_FAILED')", 'Shopify onboarding must not display raw API error codes');

const shopifySchema = read('apps/api/prisma/schema.prisma');
const shopifyRoutes = read('apps/api/src/routes/shopify.ts');
const shopifyWebhookRoutes = read('apps/api/src/routes/shopify-webhooks.ts');
const shopifyStorefrontRoutes = read('apps/api/src/routes/shopify-storefront.ts');
const shopifyCrypto = read('apps/api/src/lib/shopify-crypto.ts');
const shopifyAuth = read('apps/api/src/lib/shopify-auth.ts');
const shopifyService = read('apps/api/src/services/shopify.ts');
const catalogPreparationService = read('apps/api/src/services/catalog-preparation.ts');
const shopifyRedactionService = read('apps/api/src/services/shopify-redaction.ts');
const catalogMatching = read('apps/api/src/lib/catalog-matching.ts');
const shopifyThemeBlock = read('apps/shopify/extensions/drapixai-tryon/blocks/tryon-button.liquid');
const shopifyThemeScript = read('apps/shopify/extensions/drapixai-tryon/assets/drapixai-theme.js');
const shopifyConfigValidator = read('apps/shopify/scripts/validate_shopify_config.py');
const shopifyAppConfig = read('apps/shopify/shopify.app.toml.example');
const dashboardProxy = read('apps/web/app/api/dashboard/proxy/[...path]/route.ts');
const shopifyLaunchDoc = read('docs/shopify-launch.md');
const apiKeyKindsMigration = read('apps/api/prisma/migrations/20260714143000_api_key_kinds/migration.sql');

assertNotIncludes(catalogMatching, 'Math.random()', 'Garment asset identifiers must not use Math.random');
assertIncludes(shopifySchema, 'model ShopifyInstallation', 'Prisma must persist Shopify installations');
assertIncludes(shopifySchema, 'kind                String               @default("dashboard")', 'API keys must be separated by operational purpose');
assertIncludes(shopifySchema, '@@index([userId, kind, isActive])', 'Key-kind rotation lookups must be indexed');
assertIncludes(apiKeyKindsMigration, 'SET "kind" = \'shopify\'', 'Existing Shopify storefront keys must be migrated to the Shopify key kind');
assertIncludes(apiKeyKindsMigration, '"ApiKey_userId_kind_isActive_idx"', 'API-key kind migration must install its lookup index');
assertIncludes(shopifySchema, 'encryptedAccessToken', 'Shopify offline tokens must only use encrypted storage');
assertIncludes(shopifySchema, 'model ShopifyWebhookEvent', 'Shopify webhooks must be idempotent and auditable');
assertIncludes(shopifySchema, 'model CatalogPreparationLease', 'Shopify preparation workers must use a database-backed lease');
assertIncludes(shopifySchema, 'preparationNextAttemptAt DateTime?', 'Shopify preparation must persist retry scheduling');
assertIncludes(shopifyCrypto, "createCipheriv('aes-256-gcm'", 'Shopify secrets must use AES-256-GCM');
assertIncludes(shopifyAuth, 'timingSafeEqual', 'Shopify HMAC and state checks must use timing-safe comparison');
assertIncludes(shopifyAuth, 'verifyShopifyAppProxyQuery', 'Shopify storefront bootstrap must verify Shopify app-proxy signatures');
assertIncludes(shopifyAuth, 'Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= maxAgeSeconds', 'App-proxy signatures must have a bounded replay window');
assertIncludes(shopifyRoutes, 'verifyShopifyQueryHmac', 'Shopify OAuth callback must verify Shopify HMAC');
assertIncludes(shopifyRoutes, "process.env.NODE_ENV === 'production'", 'Production Shopify install requests must require a signed Shopify query');
assertIncludes(shopifyRoutes, 'SHOPIFY_REQUIRED_SCOPES_MISSING', 'Shopify OAuth must reject incomplete scope grants');
assertIncludes(shopifyRoutes, 'if (useLegacyInstallFlow)', 'Shopify-managed installation must own scopes unless legacy flow is explicitly enabled');
assertIncludes(shopifyRoutes, 'linkTokenExpiresAt', 'Shopify account links must expire');
assertIncludes(shopifyRoutes, 'requireDashboardProxy', 'Shopify management routes must require dashboard proxy authentication');
assertIncludes(shopifyWebhookRoutes, 'verifyShopifyWebhookHmac', 'Shopify webhook bodies must be authenticated');
assertIncludes(shopifyWebhookRoutes, "topic === 'app/uninstalled'", 'Shopify uninstall must deactivate the integration');
assertIncludes(shopifyWebhookRoutes, "topic === 'shop/redact'", 'Shopify shop-redact must delete Shopify-origin data');
assertIncludes(shopifyWebhookRoutes, "status: { in: ['received', 'failed'] }", 'Failed Shopify webhooks must remain retryable');
assertIncludes(shopifyWebhookRoutes, "status: 'processing', receivedAt:", 'Stale in-progress Shopify webhooks must be reclaimable after a crash');
assertIncludes(shopifyWebhookRoutes, "error.code === 'P2002'", 'Concurrent Shopify webhook deliveries must be idempotent');
assertIncludes(shopifyWebhookRoutes, 'redactShopifyInstallationData(prisma, installation)', 'Shop redaction must invoke physical Shopify asset cleanup');
assertIncludes(shopifyWebhookRoutes, '/^SHOPIFY_[A-Z0-9_]+$/', 'Webhook failure records must not persist raw upstream error details');
assertNotIncludes(shopifyWebhookRoutes, 'JSON.parse(rawBody', 'Shopify compliance handlers must not retain unnecessary customer payload data');
assertIncludes(shopifyRedactionService, '/ai/garment/cache/delete', 'Shop redaction must delete the AI garment cache');
assertIncludes(shopifyRedactionService, 'removeLocalStoredFile(storedUrl, \'garments\')', 'Shop redaction must guard local garment asset deletion');
assertIncludes(shopifyRedactionService, 'DeleteObjectCommand', 'Shop redaction must delete S3 garment assets');
assertIncludes(shopifyRedactionService, 'transaction.garmentMatch.deleteMany', 'Shop redaction must remove Shopify garment mappings');
assertIncludes(shopifyRedactionService, 'transaction.garment.deleteMany', 'Shop redaction must remove Shopify-derived garment records');
assertIncludes(shopifyRedactionService, 'transaction.catalogProduct.deleteMany', 'Shop redaction must remove Shopify catalog records');
assertIncludes(shopifyRedactionService, 'transaction.apiKey.deleteMany', 'Shop redaction must remove the storefront API key');
assertIncludes(shopifyRedactionService, "shopDomain: 'redacted.invalid'", 'Shop redaction must remove merchant domains from retained webhook audit rows');
assertIncludes(aiServer, '@app.post("/ai/garment/cache/delete")', 'AI service must expose authenticated garment-cache deletion');
assertIncludes(aiServer, 'Worker.all(connection=connection)', 'AI readiness must require a registered RQ worker');
assertIncludes(aiServer, '"worker_ready": worker_ready', 'AI readiness response must expose worker availability');
assertIncludes(aiServer, 'status_code=200 if model_ready and worker_ready else 503', 'AI readiness must return 503 until model and worker are both ready');
assertIncludes(garmentCacheService, 'def delete(self, key: str) -> bool:', 'AI garment cache must support physical deletion');
assertIncludes(garmentCacheDeleteValidation, 'assert cache.delete(key) is True', 'AI cache deletion must have a no-GPU physical deletion regression test');
assertIncludes(garmentCacheService, 'def purge_expired(self, limit: int = 1_000)', 'AI garment cache must delete expired physical cache assets');
assertIncludes(garmentCacheService, 'drapixai-expires-at', 'S3 cache assets must carry an explicit expiry timestamp');
assertIncludes(garmentCacheExpiryValidation, 'assert cache.get(key) is None', 'Expired garment caches must not be readable through fallback storage');
assertIncludes(aiServer, '_purge_expired_garment_cache_loop', 'AI API must schedule bounded garment cache cleanup');
assertIncludes(inputValidation, 'INPUT_MUST_BE_PLAIN_TEXT', 'API must reject executable or markup input in plain-text fields');
assertIncludes(inputValidation, "key === '__proto__'", 'API must reject prototype-pollution input keys');
assertIncludes(inputValidationTests, 'SELECT * FROM users', 'Input-validation regression must cover SQL-like text input');
assertIncludes(garmentSkinDetectionValidation, 'assert_not_model_worn(graphic)', 'Garment onboarding must permit skin-toned printed graphics');
assertIncludes(garmentSkinDetectionValidation, 'assert_not_model_worn(beige)', 'Garment onboarding must permit skin-toned garment fabric');
assertIncludes(garmentSkinDetectionValidation, 'Model-worn garment must be rejected', 'Garment onboarding must still reject model-worn source images');
assertIncludes(neutralGarmentScorerValidation, '_assert_neutral_garment((18, 18, 18), "black")', 'Quality scoring must retain black neutral fabric as garment foreground');
assertIncludes(neutralGarmentScorerValidation, '_assert_neutral_garment((238, 238, 238), "off-white")', 'Quality scoring must retain off-white fabric as garment foreground');
assertIncludes(runpodPreflight, 'validate_tryon_scorer_neutral_garments', 'RunPod preflight must execute neutral-garment scorer regressions');
assertIncludes(shopifyStorefrontRoutes, "Cache-Control', 'no-store, private'", 'Shopify storefront configuration must never be cached');
assertIncludes(shopifyStorefrontRoutes, "process.env.NODE_ENV === 'production'", 'Production must disable the legacy permanent storefront-key endpoint');
assertIncludes(shopifyStorefrontRoutes, "status(410).json({ error: 'SHOPIFY_APP_PROXY_REQUIRED' })", 'Legacy Shopify storefront configuration must fail closed in production');
assertIncludes(shopifyStorefrontRoutes, "router.get(['/storefront/proxy', '/storefront/proxy/']", 'Shopify must expose a signed app-proxy bootstrap route');
assertIncludes(shopifyStorefrontRoutes, 'issueStorefrontToken', 'The Shopify app proxy must issue a short-lived storefront credential');
assertIncludes(shopifyStorefrontRoutes, 'expiresInSeconds: 300', 'Shopify storefront bootstrap must communicate its five-minute expiry');
assertIncludes(shopifyService, 'products(first: 100', 'Shopify sync must import catalog products');
assertIncludes(shopifyService, 'variants(first: 100)', 'Shopify sync must import product variants');
assertIncludes(shopifyService, 'fetchRemainingProductVariants', 'Shopify sync must paginate products with more than 100 variants');
assertIncludes(shopifyService, "status: 'archived'", 'Shopify sync must archive products removed from the source store');
assertIncludes(shopifyService, 'recomputeGarmentMatchesForUser', 'Shopify sync must invalidate mappings after source products are archived');
assertIncludes(shopifyService, "source = `shopify:${installation.shopDomain}`", 'Shopify catalog records must retain source ownership');
assertIncludes(shopifyService, 'buildShopifyThemeEditorUrl', 'Shopify onboarding must provide a Theme Editor activation deep link');
assertIncludes(shopifyService, 'queueShopifyCatalogPreparation', 'Shopify synchronization must queue eligible products for preparation');
assertIncludes(catalogPreparationService, "redirect: 'manual'", 'Shopify image ingestion must reject redirect-based host bypasses');
assertIncludes(catalogPreparationService, 'if (total > MAX_IMAGE_BYTES)', 'Shopify image ingestion must enforce a streaming byte limit');
assertIncludes(catalogPreparationService, 'limitInputPixels: MAX_IMAGE_PIXELS', 'Shopify image ingestion must cap decoded image pixels');
assertIncludes(catalogPreparationService, 'admin_bypass: false', 'Automatic Shopify preparation must never bypass garment validation');
assertIncludes(catalogPreparationService, "status: 'pending'", 'Automatically prepared Shopify garments must remain pending review');
assertIncludes(catalogPreparationService, 'confirmedProductId: null', 'Automatic Shopify preparation must not confirm product mappings');
assertIncludes(catalogPreparationService, "preparationStatus: 'review_required'", 'Prepared Shopify products must enter an explicit review state');
assertIncludes(catalogPreparationService, 'preparationNextAttemptAt: canRetry', 'Transient preparation failures must use bounded retry scheduling');
assertIncludes(catalogPreparationService, 'if (!lease) return { busy: true', 'Overlapping preparation batches must fail safely');
assertIncludes(catalogPreparationService, 'userId !== undefined ? { userId } : {}', 'Merchant-triggered preparation must support tenant-scoped queue selection');
assertIncludes(catalogPreparationService, 'Number.isFinite(limit)', 'Preparation batch limits must fail safely for malformed input');
assertIncludes(catalogPreparationService, 'Number.isSafeInteger(value)', 'Preparation security limits must reject unsafe environment values');
assertIncludes(shopifyRoutes, 'processShopifyCatalogPreparationBatch(prisma, requestedLimit, req.user.id)', 'Merchant-triggered preparation must never process or disclose another tenant\'s products');
assertIncludes(catalogMatching, "throw new Error('GARMENT_NOT_APPROVED')", 'Product mapping confirmation must require an approved cached garment');
assertIncludes(catalogMatching, "status: 'confirmed'", 'Storefront resolution must require a confirmed mapping');
assertIncludes(catalogMatching, "garment?.status === 'ready' && garment.cacheKey", 'Storefront resolution must fail closed for unapproved or uncached garments');
assertNotIncludes(catalogMatching, 'garmentId: productIdOrGarmentId', 'Product IDs must not bypass confirmed garment mapping');
assertIncludes(apiServer, "process.env.DRAPIXAI_SHOPIFY_AUTO_PREPARE === '1'", 'Automatic Shopify preparation must be explicitly enabled');
assertIncludes(apiProductionExample, 'DRAPIXAI_GARMENT_APPROVAL_REQUIRED=1', 'Production must require garment approval');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_GARMENT_APPROVAL_REQUIRED "1"', 'Production validation must reject disabled garment approval');
assertIncludes(apiProductionExample, 'DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE=0.95', 'API production defaults must reject sub-0.95 visual results');
assertIncludes(apiProductionExample, 'DRAPIXAI_AUTO_REJECT_BAD_RESULTS=1', 'API production defaults must reject low-quality results');

assert.equal(
  shouldAutoRejectTryOn({ qualityScore: 0.949, warnings: [] }),
  true,
  'Scores below 0.95 must never be publishable',
);
assert.equal(
  shouldAutoRejectTryOn({ qualityScore: 0.95, warnings: [] }),
  false,
  'A clean score at the 0.95 floor should be publishable',
);
assertIncludes(validateEnv, 'require_number_at_least DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE "0.95"', 'API env validation must enforce the public visual-quality floor');
assertIncludes(shopifyLaunchDoc, 'Keep `DRAPIXAI_SHOPIFY_AUTO_PREPARE=0` while the AI worker is offline.', 'Shopify launch docs must support safe catalog sync while GPU preparation is offline');
assertIncludes(shopifyThemeBlock, 'data-drapixai-shopify', 'Theme App Extension must expose a stable SDK mount point');
assertIncludes(shopifyThemeScript, "'/apps/drapixai?product_id='", 'Theme extension must bootstrap through Shopify\'s signed product-scoped app proxy');
assertIncludes(shopifyThemeScript, 'tokenProvider: async function (requestedProductId)', 'Theme extension must refresh its short-lived product token before try-on');
assertIncludes(shopifyThemeScript, 'config.token', 'Theme extension must use the short-lived storefront credential');
assertNotIncludes(shopifyThemeScript, '/shopify/storefront/config?shop=', 'Theme extension must not request a permanent storefront API key');
assertIncludes(shopifyThemeScript, "quality: 'standard'", 'Shopify theme extension must enforce Standard quality');
assertIncludes(shopifyThemeScript, 'adaptBrandTheme: true', 'Shopify widget must adapt to the merchant theme');
assertIncludes(shopifyAppConfig, '[app_proxy]', 'Shopify app configuration must declare an app proxy');
assertIncludes(shopifyAppConfig, 'url = "https://api.drapixai.com/shopify/storefront/proxy"', 'Shopify app proxy must target the signed storefront bootstrap endpoint');
assertIncludes(shopifyConfigValidator, 'tomllib.load', 'Shopify config validation must use a structured TOML parser');
assertIncludes(shopifyConfigValidator, 'ALLOWED_SCOPES = {"read_products"}', 'Shopify config validation must enforce least-privilege product scope');
assertIncludes(shopifyConfigValidator, 'REQUIRED_COMPLIANCE_TOPICS', 'Shopify config validation must require mandatory privacy webhooks');
assertIncludes(shopifyConfigValidator, 'parsed.scheme != "https"', 'Shopify config validation must reject non-HTTPS endpoints');
assertIncludes(shopifyConfigValidator, 'client_id still contains a placeholder', 'Shopify config validation must reject undeployed placeholder credentials');
assertIncludes(loginPage, 'getSafeNextPath', 'Login must preserve a safe Shopify installation return path');
assertIncludes(registerPage, 'getSafeNextPath', 'Registration must preserve a safe Shopify installation return path');
assertIncludes(loginPage, "!requested.startsWith('//')", 'Login must reject protocol-relative return URLs');
assertIncludes(registerPage, "!value.startsWith('//')", 'Registration must reject protocol-relative return URLs');
assertIncludes(dashboardProxy, "allowedShopifyActions", 'Dashboard proxy must explicitly allow Shopify management actions');
assertIncludes(apiKeyAuth, "const GENERIC_STOREFRONT_TOKEN_PREFIX = 'dpxsf_'", 'Generic storefronts must use recognizable short-lived credentials');
assertIncludes(apiKeyAuth, "expiresIn: '5m'", 'Shopper credentials must expire after five minutes');
assertIncludes(apiKeyAuth, 'productIds: input.productIds', 'Shopper credentials must carry explicit product scope');
assertNotIncludes(apiKeyAuth.slice(apiKeyAuth.indexOf('export const resolveActiveApiKey'), apiKeyAuth.indexOf('export const resolveSdkApiKey')), 'resolveStorefrontToken', 'General API authentication must not accept shopper credentials');
assertIncludes(sdkRoute, "router.post('/storefront-token', serverApiKeyMiddleware", 'Brands must exchange server keys for shopper tokens server-side');
assertIncludes(sdkRoute, 'TOKEN_PRODUCT_SCOPE_DENIED', 'SDK routes must reject products outside shopper token scope');
assertIncludes(authorizationLib, "brand_member: new Set(['tenant:read'])", 'Brand members must not inherit tenant management rights');
assertIncludes(authorizationLib, 'authenticatedUserId === resourceUserId', 'Tenant ownership checks must fail closed across users');
assertIncludes(securitySchema, 'model SecurityAuditLog', 'Security audit records must be represented in the database schema');
assertIncludes(auditMigration, 'SecurityAuditLog_immutable_update', 'Database must reject security audit updates');
assertIncludes(auditMigration, 'SecurityAuditLog_immutable_delete', 'Database must reject security audit deletes');
assertIncludes(auditLog, 'pg_advisory_xact_lock', 'Audit hash-chain appends must serialize concurrent writers');
assertIncludes(auditLog, 'verifySecurityAuditChain', 'Operators must be able to verify the immutable audit chain');
assertIncludes(apiDockerfile, 'USER nonroot', 'API container must run as the distroless non-root user');
assertIncludes(webDockerfile, 'USER nonroot', 'Web container must run as the distroless non-root user');
assertIncludes(apiDockerfile, 'gcr.io/distroless/nodejs22-debian12:nonroot', 'API runtime must use a supported distroless Node LTS image');
assertIncludes(webDockerfile, 'gcr.io/distroless/nodejs22-debian12:nonroot', 'Web runtime must use a supported distroless Node LTS image');
assertNotIncludes(apiDockerfile, 'node:20', 'API container must not reintroduce the EOL Node 20 runtime');
assertNotIncludes(webDockerfile, 'node:20', 'Web container must not reintroduce the EOL Node 20 runtime');
assertIncludes(nodeVersion, '22', 'Local and CI runtime selection must target supported Node 22 LTS');
assertIncludes(rootPackage, '"node": ">=22 <25"', 'Repository packages must reject EOL Node runtimes');
assertIncludes(apiPackage, '"express": "5.2.1"', 'API must use Express 5 async rejection propagation');
assertIncludes(apiPackage, '"test:async-errors"', 'API must expose behavioral async error propagation verification');
assertIncludes(runpodSdkApiSetup, 'setup_22.x', 'RunPod API setup must install supported Node 22 LTS');
assertIncludes(runpodSdkApiSetup, '[[ "$major" -ge 22 ]]', 'RunPod API setup must reject EOL Node runtimes');
assertIncludes(apiDockerfile, 'npm ci --include=dev', 'API build stage must install compiler dependencies before pruning them');
assertIncludes(webDockerfile, 'npm ci --include=dev', 'Web build stage must install compiler dependencies before pruning them');
assertIncludes(apiDockerfile, 'apt-get install -y --no-install-recommends openssl', 'API container must include the OpenSSL runtime required by Prisma');
assertIncludes(apiDockerfile, 'apt-get install -y --no-install-recommends libssl3', 'API runtime must overlay the current security-patched OpenSSL library');
assertIncludes(webDockerfile, 'apt-get install -y --no-install-recommends libssl3', 'Web runtime must overlay the current security-patched OpenSSL library');
assertIncludes(containerScanScript, 'docker save --output', 'Container scanning must export an immutable image archive');
assertIncludes(containerScanScript, '--input /scan/image.tar', 'Container scanning must inspect the exported archive');
assertNotIncludes(containerScanScript, '/var/run/docker.sock', 'Container scanners must not receive Docker daemon control');
assertIncludes(aiDockerfile, 'USER 10001:10001', 'AI container must run as a dedicated non-root user');
assertIncludes(aiDockerfile, 'pytorch/pytorch:2.11.0-cuda12.8-cudnn9-devel@sha256:53ab3de62f6101d1e42f9be28623ab7a468a24c070d632f211ed576e30b6abd3', 'AI runtime must pin the Blackwell-capable CUDA 12.8 PyTorch image by digest');
assertNotIncludes(aiDockerfile, 'runpod/pytorch:2.4.0', 'Production AI image must not inherit the retired A100 CUDA 12.4 base');
assertIncludes(aiDockerfile, 'DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell', 'AI image must default to the primary RTX PRO 6000 production preset');
assertIncludes(aiDockerfile, 'sys.version_info[:2] != (3, 12)', 'AI image must assert the pinned Python 3.12 runtime contract at build time');
assertIncludes(aiDockerfile, 'import sys', 'AI image must import sys before enforcing its Python runtime contract');
assertNotIncludes(validateEnv, 'fi  require_equals', 'AI environment validation must keep the RTX guard as valid Bash syntax');
assertIncludes(validateEnv, 'DRAPIXAI_GPU_PRESET:-}" == "rtx-pro-6000-blackwell', 'Digest pinning must apply to the RTX production preset without breaking the legacy reference runtime');
assertIncludes(publishReleaseImages, 'DRAPIXAI_AI_RUNTIME_IMAGE', 'Release publishing must use the digest-pinned Blackwell AI base image.');
assertIncludes(edgeCompose, 'DRAPIXAI_API_RELEASE_IMAGE', 'Production edge Compose must deploy the immutable API release image.');
assertIncludes(edgeCompose, 'DRAPIXAI_WEB_RELEASE_IMAGE', 'Production edge Compose must deploy the immutable web release image.');
assertIncludes(aiCompose, 'DRAPIXAI_AI_RELEASE_IMAGE', 'Production AI Compose must deploy the immutable Standard CatVTON release image.');
assertNotIncludes(aiCompose, 'ai-lower-worker:', 'Production AI Compose must exclude uncertified lower-body services.');
assertNotIncludes(aiCompose, 'Dockerfile.lower-body', 'Production AI Compose must not retain an uncertified lower-body build path.');
assertNotIncludes(aiCompose, 'build:', 'Production AI Compose must never rebuild application images during deployment.');
assertNotIncludes(edgeCompose, 'dockerfile: apps/api/Dockerfile', 'Production edge Compose must not rebuild the API during deployment.');
assertNotIncludes(edgeCompose, 'dockerfile: apps/web/Dockerfile', 'Production edge Compose must not rebuild the web app during deployment.');
assertIncludes(publishReleaseImages, 'scan-container-images.sh', 'Release publishing must block unscanned images.');
assertIncludes(publishReleaseImages, 'docker build --platform linux/amd64', 'Release publishing must build the approved Linux runtime architecture.');
assertIncludes(publishReleaseImages, 'docker push', 'Release publishing must push approved artifacts to the registry.');
assertIncludes(publishReleaseImages, 'docker buildx imagetools inspect', 'Release publishing must resolve registry digests after push.');
assertIncludes(publishReleaseImages, 'status --porcelain', 'Release publishing must require a clean release checkout.');
assertIncludes(startProductionRelease, 'up -d --no-build', 'Production startup must never rebuild release artifacts.');
assertIncludes(startProductionRelease, 'docker compose --env-file', 'Production startup must render only private environment inputs.');
assertIncludes(startProductionRelease, 'must be an immutable registry image reference pinned by sha256', 'Production startup must reject mutable image references.');
assertIncludes(stagingAiCompose, 'DRAPIXAI_AI_RELEASE_IMAGE', 'Staging AI Compose must deploy the same immutable Standard release artifact class as production.');
assertNotIncludes(stagingAiCompose, 'build:', 'Staging AI Compose must not rebuild the release artifact.');
assertNotIncludes(stagingEdgeCompose, 'build:', 'Staging edge Compose must not rebuild API or web release artifacts.');
assertIncludes(stagingImagesEnvExample, 'DRAPIXAI_RELEASE_COMMIT=', 'Staging image inputs must record the exact release commit.');
assertIncludes(stagingImagesEnvExample, 'DRAPIXAI_AI_RELEASE_IMAGE=', 'Staging image inputs must provide the immutable AI release artifact.');
assertIncludes(stagingImagesEnvExample, 'DRAPIXAI_AI_RUNTIME_IMAGE=pytorch/pytorch:', 'Staging image inputs must retain the digest-pinned AI base-image provenance.');
assertIncludes(stagingTopologyVerifier, 'staging Compose must deploy immutable release artifacts without source builds', 'Staging topology verification must reject source builds.');
assertIncludes(stagingReleaseImageVerifier, 'org.opencontainers.image.revision', 'Staging runtime verification must prove the image revision label.');
assertIncludes(stagingImagesEnvExample, 'DRAPIXAI_POSTGRES_IMAGE=postgres:', 'Staging Compose must pin the PostgreSQL image before service startup.');
assertIncludes(stagingImagesEnvExample, 'DRAPIXAI_REDIS_IMAGE=redis:', 'Staging Compose must pin the Redis image before service startup.');
assertIncludes(gitignore, 'deploy/staging/.images.env', 'The real staging Compose input file must remain out of Git');
assertIncludes(aiProductionExample, 'DRAPIXAI_AI_RUNTIME_IMAGE=pytorch/pytorch:', 'Production AI environment must pin an official PyTorch runtime image');
assertIncludes(validateEnv, 'require_pinned_pytorch_runtime_image', 'AI production validation must reject unpinned runtime images');
assertIncludes(validateEnv, 'require_digest_pinned_release_image', 'Production validation must reject mutable application release images.');
assertIncludes(apiProductionExample, 'DRAPIXAI_API_RELEASE_IMAGE=', 'API production environment must select an immutable release artifact.');
assertIncludes(apiProductionExample, 'DRAPIXAI_WEB_RELEASE_IMAGE=', 'Edge Compose inputs must include the immutable web artifact.');
assertIncludes(webProductionExample, 'DRAPIXAI_WEB_RELEASE_IMAGE=', 'Web production environment must select an immutable release artifact.');
assertIncludes(aiProductionExample, 'DRAPIXAI_AI_RELEASE_IMAGE=', 'AI production environment must select an immutable Standard CatVTON artifact.');
assertIncludes(workstationPreflight, 'driver_version', 'RTX workstation preflight must check the host NVIDIA driver version');
assertIncludes(workstationPreflight, 'parts[0] < 570', 'RTX workstation preflight must reject drivers older than the Blackwell-supported release');
assertIncludes(edgeCompose, 'read_only: true', 'Production edge services must use read-only root filesystems');
assertIncludes(edgeCompose, 'cap_drop:', 'Production edge services must drop Linux capabilities');
assertIncludes(aiCompose, 'internal: true', 'AI queue and worker network must remain private');
assertIncludes(securityReleaseGate, 'No public launch with unresolved critical or high findings.', 'Security release gate must block unresolved high-risk findings');
assertIncludes(liveSecurityBoundaryTest, "DRAPIXAI_SECURITY_TEST_ENVIRONMENT !== 'staging'", 'Live security boundary tests must refuse non-staging environments');
assertIncludes(liveSecurityBoundaryTest, "apiHost === 'api.drapixai.com'", 'Live security boundary tests must refuse the production API hostname');
assertIncludes(liveSecurityBoundaryTest, "url: 'http://127.0.0.1:8080/internal-only'", 'Live security boundary tests must prove localhost webhook SSRF rejection');
assertIncludes(liveSecurityBoundaryTest, "method: 'OPTIONS'", 'Live security boundary tests must probe hostile-origin CORS preflight');
assertIncludes(liveSecurityBoundaryTest, "assert.ok(rateLimitStatuses.includes(429)", 'Live security boundary tests must prove rate-limit enforcement');
assertIncludes(securityReleaseGate, 'DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A', 'Security release gate must document the public API token required for SSRF and rate-limit probes');
assertIncludes(stagingPentest, 'target_host', 'Staging pentest helper must inspect the target host before scanning');
assertIncludes(stagingPentest, 'Refusing to scan a non-staging host', 'Staging pentest helper must reject non-staging targets');
assertIncludes(stagingPentest, 'DRAPIXAI_PENTEST_ENVIRONMENT', 'Staging pentest helper must require the staging environment guard');
assertIncludes(stagingPentest, 'DRAPIXAI_PENTEST_AUTHORIZATION_ID', 'Staging pentest helper must require a written authorization reference');
assertIncludes(stagingPentest, '--pids-limit 512', 'Staging pentest helper must limit scanner process creation');
assertIncludes(stagingPentest, '--memory 4g', 'Staging pentest helper must cap scanner memory use');
assertIncludes(stagingCertification, 'DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT', 'Staging certification runner must require a staging environment guard');
assertIncludes(stagingCertification, 'Refusing certification against a non-staging API host', 'Staging certification runner must refuse production targets');
assertIncludes(stagingCertification, 'status --porcelain', 'Staging certification runner must require a clean release checkout');
assertIncludes(stagingCertification, 'test:security:live', 'Staging certification runner must execute live tenant-security checks');
assertIncludes(stagingCertification, 'edge-private-listeners', 'Staging certification must collect private-listener evidence from the edge host.');
assertIncludes(stagingCertification, 'DRAPIXAI_GPU_MTLS_EVIDENCE', 'Staging certification must require separate GPU mTLS evidence.');
assertIncludes(stagingCertification, 'GPU mTLS no-client handshake was rejected.', 'Staging certification must require proof that a GPU request without the client certificate failed.');
assertIncludes(stagingCertification, 'GPU mTLS API-client handshake returned HTTP 200.', 'Staging certification must require proof that the dedicated API client certificate succeeds.');
assertIncludes(mtlsApiHandshakeVerifier, "--noproxy '*'", 'GPU mTLS handshake verifier must bypass public HTTP proxies.');
assertIncludes(mtlsApiHandshakeVerifier, 'DRAPIXAI_MTLS_CLIENT_CERT', 'GPU mTLS handshake verifier must present the dedicated API client certificate.');
assertIncludes(mtlsApiHandshakeVerifier, 'GPU mTLS no-client handshake was rejected.', 'GPU mTLS handshake verifier must record a rejected no-client request.');
assertIncludes(mtlsApiHandshakeVerifier, 'GPU mTLS API-client handshake returned HTTP 200.', 'GPU mTLS handshake verifier must require a successful dedicated-client health response.');
assertIncludes(proxyReadme, 'verify-mtls-api-handshake.sh', 'GPU mTLS operator guide must document the live API-host handshake verifier.');
assertIncludes(proxyReadme, 'Do not use `curl -k`', 'GPU mTLS operator guide must forbid insecure certificate bypasses.');
assertIncludes(securityReleaseGate, 'no-client access is rejected', 'Security release gate must require a live no-client GPU mTLS rejection.');
assertIncludes(securityReleaseGate, 'certificate receives `/health` HTTP `200`', 'Security release gate must require a live dedicated-client GPU mTLS success.');
assertIncludes(securityReleaseGate, 'three-tenant public API batch', 'Security release gate must require a three-tenant GPU certification run.');
assertIncludes(stagingCertification, 'DRAPIXAI_GPU_RELEASE_IMAGE_EVIDENCE', 'Staging certification must require separate GPU release-image evidence.');
assertIncludes(stagingCertification, 'edge-release-images', 'Staging certification must verify the running edge image artifacts.');
assertIncludes(stagingCertification, 'privacy:verify-shopper-media', 'Staging certification runner must execute the shopper-media privacy check');
assertIncludes(stagingCertification, 'benchmark-three-tenant-public-api.py', 'Staging certification runner must execute the three-tenant public certification');
assertIncludes(stagingCertification, 'runtime/launch-evidence', 'Staging certification runner must keep evidence in the ignored evidence directory');
assertIncludes(stagingCertification, 'write_summary "FAIL"', 'Staging certification runner must retain a redacted failure summary');
assertIncludes(stagingCertificationTemplate, 'DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT=staging', 'Staging certification template must lock the environment to staging');
assertIncludes(stagingCertificationTemplate, 'DRAPIXAI_THREE_TENANT_MANIFEST', 'Staging certification template must require a token-free three-tenant manifest reference');
assertIncludes(stagingCertificationTemplate, 'DRAPIXAI_STAGING_IMAGES_ENV=', 'Staging certification template must require the release artifact record.');
assertIncludes(gitignore, 'deploy/staging/certification.env', 'Git must ignore copied staging certification credentials');
assertIncludes(publicThreeTenantBenchmark, 'x-drapixai-timing-json', 'Public three-tenant benchmark must collect GPU timing evidence');
assertIncludes(publicThreeTenantBenchmark, 'worker batch was', 'Public three-tenant benchmark must reject a worker that does not form the target batch');
assertIncludes(publicThreeTenantBenchmark, 'GPU headroom', 'Public three-tenant benchmark must reject unsafe GPU VRAM headroom');
assertIncludes(publicThreeTenantBenchmark, '--retain-output-images', 'Public three-tenant benchmark must make image retention an explicit opt-in');
assertIncludes(publicThreeTenantBenchmark, 'output_images_retained', 'Public three-tenant benchmark must record whether it retained images');
assertIncludes(launchGateReport, 'validateEvidenceArtifact', 'Complete launch reports must validate external evidence artifacts');
assertIncludes(launchGateReport, 'evidence artifact sha256 does not match', 'Complete launch reports must reject altered evidence artifacts');
assertIncludes(launchGateReport, 'runtime/launch-evidence', 'Complete launch reports must keep evidence inside the ignored local evidence root');
assertIncludes(launchGateReport, 'isStrictDescendant', 'Complete launch reports must block traversal or symlink escapes from the evidence root');
assertIncludes(launchEvidenceRecorder, 'EVIDENCE_RECORD_COMMIT_MISMATCH', 'Evidence recorder must refuse a release record for another commit');
assertIncludes(launchEvidenceRecorder, 'MUST_REMAIN_UNDER_RUNTIME_LAUNCH_EVIDENCE', 'Evidence recorder must reject artifact paths outside the private evidence root');
assertIncludes(launchEvidenceRecorder, 'UNKNOWN_RELEASE_EVIDENCE_GATE', 'Evidence recorder must reject unknown or non-launch gates');
assertIncludes(launchEvidenceRecorder, 'fs.renameSync', 'Evidence recorder must replace release evidence atomically');
assert.ok(
  Object.values(launchEvidenceTemplate.gates).every((gate) => gate.evidence?.startsWith('runtime/launch-evidence/') && gate.sha256 === 'REPLACE_WITH_ARTIFACT_SHA256'),
  'Launch-evidence template must require a local artifact path and SHA-256 placeholder for every external gate',
);

const publicApiRoute = read('apps/api/src/routes/v1.ts');
const publicApiSpec = read('apps/api/src/openapi/v1.ts');
const webhookService = read('apps/api/src/services/webhooks.ts');
const publicApiMigration = read('apps/api/prisma/migrations/20260729180000_public_api_v1/migration.sql');
const publicApiDocs = read('docs/public-api-v1.md');
const threeTenantPublicApiBenchmark = read('deploy/scripts/benchmark-three-tenant-public-api.py');
const pricingPage = read('apps/web/app/pricing/page.tsx');
const developerDocsPage = read('apps/web/app/docs/page.tsx');
assertIncludes(apiServer, "app.use('/v1', v1Routes)", 'Public API must expose a stable versioned route');
assertIncludes(publicApiRoute, "req.url = '/tryon'", 'Public API and storefront SDK must share one Standard try-on handler');
assertNotIncludes(publicApiRoute, '/ai/tryon', 'Public API must not create a second direct AI quality path');
assertIncludes(publicApiRoute, "req.headers['idempotency-key']", 'Paid API generation must require idempotency');
assertIncludes(publicApiRoute, "error: 'IDEMPOTENT_RESPONSE_NOT_RETAINED'", 'Public API must not persist or regenerate completed shopper preview bytes');
assertIncludes(publicApiRoute, "where: { id, userId: req.user.id }", 'Public try-on lookups must remain tenant-scoped');
assertIncludes(publicApiRoute, "requireScope('api:tryon')", 'Public try-on routes must enforce least-privilege scopes');
assertIncludes(publicApiRoute, "requireScope('api:webhooks')", 'Webhook management must enforce least-privilege scopes');
assertIncludes(apiKeyAuth, "audience: 'drapixai-public-api'", 'Public access tokens must have a distinct audience');
assertIncludes(apiKeyAuth, 'environment !== getApiEnvironment()', 'Live and sandbox API tokens must fail closed across environments');
assertIncludes(sdkRoute, "storefront.scopes?.includes('api:tryon')", 'Public API tokens must not bypass scopes through legacy SDK paths');
assertIncludes(webhookService, "createCipheriv('aes-256-gcm'", 'Webhook signing secrets must be encrypted at rest');
assertIncludes(webhookService, "DrapixAI-Signature", 'Webhook deliveries must carry an HMAC signature');
assertIncludes(webhookService, 'safePostJson', 'Webhook delivery must use SSRF-resistant DNS-pinned transport');
assertIncludes(publicApiMigration, 'ApiIdempotencyRecord_userId_route_keyHash_key', 'Idempotency keys must be unique inside each tenant');
assertIncludes(publicApiMigration, 'WebhookDelivery_endpointId_eventId_key', 'Webhook event delivery must be deduplicated per endpoint');
assertIncludes(publicApiSpec, "openapi: '3.1.0'", 'Public API must publish a machine-readable OpenAPI contract');
assertIncludes(publicApiDocs, 'Live and sandbox are separate deployments', 'Public API docs must require infrastructure isolation');
assertIncludes(threeTenantPublicApiBenchmark, 'ThreadPoolExecutor(max_workers=3)', 'Staging certification must submit three tenants concurrently');
assertIncludes(threeTenantPublicApiBenchmark, 'TRYON_REQUEST_FAILED', 'Three-tenant benchmark must record redacted API failure evidence.');
assertIncludes(threeTenantPublicApiBenchmark, 'failure_result(', 'Three-tenant benchmark must write a report even when an individual request fails.');
assertIncludes(threeTenantPublicApiBenchmark, 'cross_response.status_code != 404', 'Staging certification must prove cross-tenant result isolation');
assertIncludes(threeTenantPublicApiBenchmark, 'shopper_consent', 'Three-tenant certification must use the privacy consent contract');
assertNotIncludes(threeTenantPublicApiBenchmark, '"token":', 'Three-tenant benchmark manifests must not embed tenant tokens');
assertIncludes(publicApiSpec, "'x-drapixai-usage-billing'", 'OpenAPI must define successful-result billing semantics');
assertIncludes(publicApiSpec, 'HTTP 422 quality-gate rejection', 'OpenAPI must state that quality rejections do not consume usage');
assertIncludes(publicApiDocs, '| Starter | $49 | 1,000 |', 'Public API docs must publish Starter API pricing');
assertIncludes(publicApiDocs, '| Growth | $199 | 7,500 |', 'Public API docs must publish Growth API pricing');
assertIncludes(publicApiDocs, '| Pro | $499 | 25,000 |', 'Public API docs must publish Pro API pricing');
assertIncludes(publicApiDocs, 'a duplicate idempotency key after an already-counted result', 'Public API docs must prevent duplicate-key double billing');
assertIncludes(pricingPage, "price: '$49'", 'Pricing page must publish the Starter monthly price');
assertIncludes(pricingPage, "volume: '1,000 successful try-ons / month'", 'Pricing page must match the Starter API quota');
assertIncludes(pricingPage, "price: '$199'", 'Pricing page must publish the Growth monthly price');
assertIncludes(pricingPage, "volume: '7,500 successful try-ons / month'", 'Pricing page must match the Growth API quota');
assertIncludes(pricingPage, "price: '$499'", 'Pricing page must publish the Pro monthly price');
assertIncludes(pricingPage, "volume: '25,000 successful try-ons / month'", 'Pricing page must match the Pro API quota');
assertIncludes(pricingPage, 'The first successful, publishable HTTP 200 try-on result.', 'Pricing page must explain which API result consumes quota');
assertIncludes(pricingPage, 'shopper preview bytes are not retained.', 'Pricing page must explain privacy-safe duplicate billing behavior');
assertIncludes(developerDocsPage, 'API usage pricing', 'Developer quickstart must expose API pricing');
assertIncludes(developerDocsPage, 'No automatic overages at launch.', 'Developer quickstart must disclose the hard quota policy');
assertIncludes(validateEnv, 'require_base64_bytes DRAPIXAI_WEBHOOK_ENCRYPTION_KEY 32', 'Linux production validation must enforce a 256-bit webhook encryption key');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY "1"', 'Linux production validation must require AWS workload identity');
assertIncludes(apiServer, 'Production live API must not configure AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY', 'Live API startup must reject static AWS credentials.');
assertIncludes(validateEnv, 'Production API must use AWS workload identity instead of static AWS access keys', 'Linux production validation must reject static AWS credentials.');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-OptionalEmpty $apiEnv "AWS_ACCESS_KEY_ID"', 'Windows production validation must reject static AWS credentials.');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Base64Bytes $apiEnv "DRAPIXAI_WEBHOOK_ENCRYPTION_KEY" 32', 'Windows production validation must enforce a 256-bit webhook encryption key');
assertIncludes(validateProductionEnvSet, 'require_digest_image', 'Linux production env-set validation must enforce immutable application image references.');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-DigestPinnedImage', 'Windows production validation must enforce immutable application image references.');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-ExactValue $apiEnv "DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY" "1"', 'Windows production validation must require AWS workload identity');
assertIncludes(initProductionEnv, '"DRAPIXAI_API_ENVIRONMENT" = "live"', 'Production environment initialization must explicitly select the live API boundary');

const tryOnConcurrency = read('apps/api/src/lib/tryon-concurrency.ts');
const externalSecrets = read('apps/api/src/lib/external-secrets.ts');
const apiBootstrap = read('apps/api/src/bootstrap.ts');
const operationalMetrics = read('apps/api/src/lib/operational-metrics.ts');
const cloudflareWaf = read('deploy/cloudflare/main.tf');
const isolationVerifier = read('deploy/scripts/verify-environment-isolation.mjs');
const migrationWrapper = read('deploy/scripts/migrate-with-evidence.sh');
const restoreWrapper = read('deploy/scripts/restore-postgres-backup.sh');
const privateListenerVerifier = read('deploy/scripts/verify-private-listeners.sh');
const aiClient = read('apps/api/src/lib/ai-client.ts');
const mtlsProxyTemplate = read('deploy/workstation/internal-proxy/drapixai-ai-mtls.conf.template');
const mtlsProxyVerifier = read('deploy/workstation/internal-proxy/verify-mtls-proxy.sh');
const monitoringAlerts = read('deploy/monitoring/drapixai-alerts.yml');
const securityOperations = read('docs/security-operations-runbook.md');
assertIncludes(publicApiRoute, 'serverKeyRateLimit', 'Public token issuance must have API-key rate limiting');
assertIncludes(publicApiRoute, 'apiKeyRateLimit', 'Public routes must have API-key-level rate limiting');
assertIncludes(publicApiRoute, 'tenantRateLimit', 'Public routes must have tenant-level rate limiting');
assertIncludes(tryOnConcurrency, "drapixai:tryon-concurrency:tenant:", 'GPU capacity must be partitioned by tenant');
assertIncludes(tryOnConcurrency, "DRAPIXAI_MAX_CONCURRENT_TRYONS", 'Global GPU concurrency must be configurable');
assertIncludes(distributedSecurityTest, 'An expired GPU slot must be reclaimed', 'Distributed security tests must prove that crashed-worker concurrency leases expire safely.');
assertIncludes(tryOnConcurrency, "DRAPIXAI_TENANT_MAX_CONCURRENT_TRYONS", 'Per-tenant GPU concurrency must be configurable');
assertIncludes(tryOnConcurrency, "ZREMRANGEBYSCORE", 'Crashed GPU leases must expire automatically');
assertIncludes(sdkRoute, 'acquireTryOnSlot(user.id)', 'SDK and public API generation must acquire a tenant GPU slot');
assertIncludes(sdkRoute, 'releaseTryOnSlot(slot.lease)', 'GPU slots must be released after generation');
assertIncludes(webhookService, "data: { status: 'processing' }", 'Webhook delivery must atomically enter processing state');
assertIncludes(webhookService, "status: 'processing', updatedAt: { lte: staleClaimAt }", 'Crashed webhook claims must be reclaimable');
assertIncludes(externalSecrets, 'SecretsManagerClient', 'Production secrets must support AWS Secrets Manager');
assertIncludes(externalSecrets, "provider === 'mounted-file'", 'Production secrets must support a read-only orchestrator mount');
assertIncludes(apiBootstrap, "await loadExternalSecrets()", 'Managed secrets must load before the API server imports');
assertIncludes(apiDockerfile, 'dist/bootstrap.js', 'The production API container must enter through managed-secret bootstrap');
assertIncludes(cloudflareWaf, 'http_request_firewall_managed', 'Cloudflare must execute a managed WAF ruleset');
assertIncludes(cloudflareWaf, 'http_ratelimit', 'Cloudflare must enforce coarse edge rate limits');
assertIncludes(isolationVerifier, 'Environment isolation verification PASSED', 'Sandbox and production resources must have an executable isolation gate');
assertIncludes(migrationWrapper, 'pg_dump', 'Production migration tooling must back up PostgreSQL first');
assertIncludes(migrationWrapper, 'pg_restore --list', 'Production migration tooling must verify the backup catalog');
assertIncludes(migrationWrapper, 'DRAPIXAI_EXPECTED_DATABASE_NAME', 'Migration tooling must require an exact database identity');
assertIncludes(migrationWrapper, 'DRAPIXAI_CHANGE_APPROVAL_ID', 'Migration tooling must require an approved change reference');
assertIncludes(migrationWrapper, 'SELECT current_database()', 'Migration tooling must prove the connected database identity before backup or migration');
assertIncludes(restoreWrapper, 'DRAPIXAI_EXPECTED_DATABASE_NAME', 'Restore tooling must require an exact database identity');
assertIncludes(restoreWrapper, 'DRAPIXAI_RESTORE_APPROVAL_ID', 'Restore tooling must require a recovery authorization reference');
assertIncludes(restoreWrapper, 'SELECT current_database()', 'Restore tooling must prove the connected database identity before destructive restore');
assertIncludes(securityOperations, 'DRAPIXAI_CHANGE_APPROVAL_ID', 'Recovery runbook must document migration approval evidence');
assertIncludes(securityOperations, 'DRAPIXAI_RESTORE_APPROVAL_ID', 'Recovery runbook must document restore approval evidence');
assertIncludes(privateListenerVerifier, 'private service port', 'Deployment must verify private services are not on wildcard listeners');
assertIncludes(apiServer, "requireExact('DRAPIXAI_AI_MTLS_ENABLED', '1')", 'Production API must require API-to-GPU mTLS.');
assertIncludes(aiClient, 'cert: fs.readFileSync(certPath)', 'AI client must load its dedicated client certificate.');
assertIncludes(aiClient, 'key: fs.readFileSync(keyPath)', 'AI client must load its dedicated client private key.');
assertIncludes(aiClient, 'rejectUnauthorized: true', 'AI client must reject an untrusted GPU TLS certificate.');
assertIncludes(sdkRoute, 'aiFetch(', 'SDK try-on must use the mTLS-aware AI client.');
assertIncludes(mtlsProxyTemplate, 'ssl_verify_client on;', 'GPU proxy must require an API client certificate.');
assertIncludes(mtlsProxyTemplate, 'proxy_pass http://127.0.0.1:', 'GPU proxy must forward only to loopback AI service.');
assertIncludes(mtlsProxyVerifier, 'mTLS proxy port is exposed on a wildcard address', 'GPU proxy verifier must reject wildcard mTLS listeners.');
assertIncludes(mtlsProxyVerifier, 'wildcard HTTP listener', 'GPU proxy verifier must reject the default public HTTP listener.');
assertIncludes(operationalMetrics, 'drapixai_auth_failures_total', 'Operational metrics must expose authentication failures');
assertIncludes(operationalMetrics, 'drapixai_gpu_queue_depth', 'Operational metrics must expose GPU queue growth');
assertIncludes(monitoringAlerts, 'DrapixAIGpuQueueCritical', 'Monitoring must page on a critical GPU queue');
assertIncludes(monitoringAlerts, 'DrapixAIWebhookDeliveryFailures', 'Monitoring must alert on webhook failures');
assertIncludes(securityOperations, '## Key rotation', 'Operations must document key rotation');
assertIncludes(securityOperations, '## Breach response', 'Operations must document breach response');
assertIncludes(securityOperations, '## Backup and restore', 'Operations must document backup restore');
assertIncludes(securityOperations, '## Customer deletion', 'Operations must document customer deletion');
assertIncludes(launchWorkflow, 'gitleaks_8.30.1_linux_x64.tar.gz', 'CI must scan repository history for secrets');
assertIncludes(launchWorkflow, '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb', 'The secret scanner download must be checksum pinned');

console.log('Launch readiness tests passed.');
