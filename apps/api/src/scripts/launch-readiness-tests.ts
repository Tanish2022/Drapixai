import assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

const gitLsFiles = () => {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
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

const sdkRoute = read('apps/api/src/routes/sdk.ts');
const apiServer = read('apps/api/src/server.ts');
const authRoute = read('apps/api/src/routes/auth.ts');
const adminRoute = read('apps/api/src/routes/admin.ts');
const analyticsRoute = read('apps/api/src/routes/analytics.ts');
const accountRoute = read('apps/api/src/routes/account.ts');
const publicRoute = read('apps/api/src/routes/public.ts');
const securityHelpers = read('apps/api/src/lib/security.ts');
const remoteFetchHelpers = read('apps/api/src/lib/remote-fetch.ts');
const dashboardProxyAuth = read('apps/api/src/lib/dashboard-proxy-auth.ts');
const plansLib = read('apps/api/src/lib/plans.ts');
const rateLimit = read('apps/api/src/lib/rate-limit.ts');
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
const loginPage = read('apps/web/app/auth/login/page.tsx');
const registerPage = read('apps/web/app/auth/register/page.tsx');
const forgotPasswordPage = read('apps/web/app/auth/forgot-password/page.tsx');
const forgotPasswordForm = read('apps/web/app/auth/forgot-password/ForgotPasswordForm.tsx');
const webProviders = read('apps/web/app/providers.tsx');
const sdkJs = read('apps/web/public/sdk.js');
const sdkInstallPage = read('apps/web/app/sdk-install/page.tsx');
const dashboardSessionRoute = read('apps/web/app/api/dashboard/session/route.ts');
const dashboardOauthSessionRoute = read('apps/web/app/api/dashboard/oauth-session/route.ts');
const dashboardProxyRoute = read('apps/web/app/api/dashboard/proxy/[...path]/route.ts');
const nextAuthRoute = read('apps/web/app/api/auth/[...nextauth]/route.ts');
const plans = read('apps/api/src/lib/plans.ts');
const pipeline = read('drapixai_ai/pipeline/tryon_pipeline.py');
const aiServer = read('drapixai_ai/api/ai_server.py');
const aiSettings = read('drapixai_ai/configs/settings.py');
const cacheRegenerationScript = read('apps/api/src/scripts/regenerate-garment-caches.ts');
const retentionPurgeScript = read('apps/api/src/scripts/purge-tryon-review-retention.ts');
const smtpTestScript = read('apps/api/src/scripts/send-test-email.ts');
const emailerService = read('apps/api/src/services/emailer.ts');
const smokeTryon = read('deploy/runpod/smoke_tryon.py');
const smokeMatrix = read('deploy/runpod/smoke_matrix.py');
const smokeTest = read('deploy/scripts/smoke-test.sh');
const smokeTestPowerShell = read('deploy/scripts/smoke-test.ps1');
const smokeHeaderAssert = read('deploy/scripts/assert-smoke-headers.py');
const validateEnv = read('deploy/scripts/validate-env.sh');
const validateProductionEnvSet = read('deploy/scripts/validate-production-env-set.sh');
const validateProductionEnvSetPowerShell = read('deploy/scripts/validate-production-env-set.ps1');
const aiProductionExample = read('deploy/env/ai.production.example');
const apiProductionExample = read('deploy/env/api.production.example');
const webProductionExample = read('deploy/env/web.production.example');
const nextConfig = read('apps/web/next.config.js');
const homePage = read('apps/web/app/page.tsx');
const privacyPage = read('apps/web/app/privacy/page.tsx');
const proveLiveShell = read('deploy/scripts/prove-live-stack.sh');
const proveLivePowerShell = read('deploy/scripts/prove-live-stack.ps1');
const localPreflight = read('deploy/scripts/local-preflight.ps1');
const localStart = read('deploy/scripts/start-local-stack.ps1');
const runpodPreflight = read('deploy/runpod/preflight.sh');
const runLaunchTryon = read('deploy/runpod/run-launch-tryon-test.sh');
const runpodSdkApiSetup = read('deploy/runpod/setup-sdk-api-stack.sh');
const productionReadiness = read('deploy/production-readiness.md');
const dockerCompose = read('docker-compose.yml');
const rootPackageJson = read('package.json');
const gitignore = read('.gitignore');
const setupBatch = read('Setup.bat');
const initProductionEnv = read('deploy/scripts/init-production-env.ps1');

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
  'x-drapixai-garment-source',
  'x-drapixai-garment-cache-status',
  'x-drapixai-garment-cache-version',
]) {
  assertIncludes(apiServer, header, `API CORS must expose ${header}`);
  assertIncludes(sdkRoute, header, `SDK try-on must return ${header}`);
}

assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_VERSION', 'SDK must know the expected garment cache version');
assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_WIDTH', 'SDK must know expected garment cache width');
assertIncludes(sdkRoute, 'const EXPECTED_GARMENT_CACHE_HEIGHT', 'SDK must know expected garment cache height');
assertIncludes(sdkRoute, 'normalizeSdkQuality', 'SDK must normalize and reject non-Standard quality requests server-side');
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
assertIncludes(sdkRoute, "router.get('/status/:jobId', authMiddleware", 'SDK status endpoint must remain authenticated');
assertIncludes(sdkRoute, "router.get('/result/:jobId', authMiddleware", 'SDK result endpoint must remain authenticated');
assertIncludes(sdkRoute, "router.delete('/job/:jobId', authMiddleware", 'SDK job cancellation endpoint must remain authenticated');
assertIncludes(sdkRoute, 'if (!(await enforceSdkRequestDomain(req, res))) return;', 'SDK feedback/result endpoints must enforce registered storefront domains');
assertIncludes(sdkRoute, "res.setHeader('x-drapixai-warnings', latencyWarnings.join(','))", 'SDK route must not expose cache operation notes in storefront warning headers');

assertIncludes(aiSettings, 'ai_service_token', 'AI settings must include internal service token');
assertIncludes(aiServer, 'x-drapixai-service-token', 'AI server must read internal service token header');
assertIncludes(aiServer, 'AI_SERVICE_TOKEN_REQUIRED', 'AI server must reject protected calls without token');
assertIncludes(aiServer, 'PRODUCTION_CONFIG_INVALID', 'AI server must fail closed when production secrets are missing');
assertIncludes(aiServer, '_validate_image_bytes', 'AI server must validate image payloads before queueing work');
assertIncludes(sdkRoute, 'const AI_SERVICE_TOKEN = process.env.DRAPIXAI_AI_SERVICE_TOKEN', 'SDK API route must load AI service token');
assertIncludes(sdkRoute, 'x-drapixai-service-token', 'SDK API route must forward AI service token');
assertIncludes(publicRoute, 'x-drapixai-service-token', 'Public demo route must forward AI service token');
assertIncludes(cacheRegenerationScript, 'x-drapixai-service-token', 'Cache regeneration script must forward AI service token');
assertIncludes(apiServer, 'DRAPIXAI_EXPOSE_READY_DETAILS', 'API readiness details must be opt-in for production');
assertIncludes(apiServer, 'requireProductionConfig();', 'API server must validate production config on startup');
assertIncludes(apiServer, 'DRAPIXAI_CORS_ORIGINS must list explicit production origins', 'API server must reject wildcard production CORS');
assertIncludes(apiServer, "requireSecret('JWT_SECRET', 32)", 'API server must enforce a strong JWT secret in production');
assertIncludes(apiServer, 'DRAPIXAI_AUTH_SYNC_TOKEN', 'API server must require auth sync token in production');
assertIncludes(apiServer, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'API server must require dashboard proxy token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_TOKEN', 32)", 'API server must require admin token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12)", 'API server must require admin password in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32)", 'API server must require AI service token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_DASHBOARD_PROXY_TOKEN', 32)", 'API server must enforce a strong dashboard proxy token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AUTH_SYNC_TOKEN', 32)", 'API server must enforce a strong auth sync token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_AI_SERVICE_TOKEN', 32)", 'API server must enforce a strong AI service token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_TOKEN', 32)", 'API server must enforce a strong admin token in production');
assertIncludes(apiServer, "requireSecret('DRAPIXAI_ADMIN_PASSWORD', 12)", 'API server must enforce a strong admin password in production');
assertIncludes(apiServer, "error.type === 'entity.parse.failed'", 'API server must return sanitized JSON for malformed JSON requests');
assertIncludes(apiServer, "error.message === 'CORS_ORIGIN_NOT_ALLOWED'", 'API server must return sanitized JSON for blocked CORS origins');
assertIncludes(apiServer, 'status = 403;', 'API server must return 403 for blocked CORS origins');
assertIncludes(apiServer, "res.status(404).json({ error: 'NOT_FOUND' });", 'API server must return JSON 404s');
assertIncludes(apiServer, "redis.on('error'", 'API server Redis client must handle socket errors without crashing');
assertIncludes(authRoute, "router.post('/password-reset/request-otp'", 'Auth route must expose password reset OTP request');
assertIncludes(authRoute, "router.post('/password-reset/confirm'", 'Auth route must expose password reset confirmation');
assertIncludes(authRoute, "purpose: 'password_reset'", 'Password reset must use a dedicated OTP purpose');
assertIncludes(authRoute, "error: 'INVALID_OR_EXPIRED_OTP'", 'Password reset must not disclose account existence through OTP failures');
assertIncludes(authRoute, "return res.json({ ok: true });", 'Password reset request must avoid account enumeration');
assertIncludes(emailerService, 'password_reset', 'Emailer must support password reset OTP copy');
assertIncludes(forgotPasswordPage, 'ForgotPasswordForm', 'Forgot password page must render the reset form');
assertIncludes(forgotPasswordForm, '/auth/password-reset/request-otp', 'Forgot password form must request reset OTPs');
assertIncludes(forgotPasswordForm, '/auth/password-reset/confirm', 'Forgot password form must confirm reset OTPs');
assertIncludes(forgotPasswordForm, 'without revealing whether the email is registered', 'Forgot password UI must avoid account enumeration copy');
assertNotIncludes(forgotPasswordForm, 'Password reset is not self-serve yet', 'Forgot password page must not expose launch TODO copy');
assertNotIncludes(forgotPasswordForm, 'should be replaced with a real reset flow', 'Forgot password page must not ship stale TODO copy');
assertIncludes(authRoute, 'x-drapixai-auth-sync-token', 'Google OAuth sync must require a server-to-server token');
assertIncludes(authRoute, 'AUTH_SYNC_TOKEN_REQUIRED', 'Google OAuth sync must reject missing auth sync token when configured');
assertIncludes(nextAuthRoute, 'DRAPIXAI_AUTH_SYNC_TOKEN', 'NextAuth route must read the auth sync token');
assertIncludes(nextAuthRoute, 'x-drapixai-auth-sync-token', 'NextAuth route must forward the auth sync token');
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
assertIncludes(securityHelpers, 'buildUploadPath', 'API must build local upload paths through a guarded helper');
assertIncludes(securityHelpers, 'readLocalUploadFile', 'API must read local upload files through a guarded helper');
assertIncludes(securityHelpers, 'UPLOAD_PATH_OUTSIDE_ROOT', 'API upload helper must fail closed when paths escape the upload root');
assertIncludes(sdkRoute, 'buildUploadPath', 'SDK local upload fallback must guard upload paths');
assertIncludes(sdkRoute, 'sanitizePathSegment', 'SDK local upload fallback must sanitize path segments');
assertIncludes(sdkRoute, 'readLocalUploadFile', 'SDK local image reads must stay inside the upload root');
assertIncludes(adminRoute, 'readLocalUploadFile', 'Admin local image reads must stay inside the upload root');
assertIncludes(sdkRoute, 'isAllowedImageUpload(file)', 'SDK uploads must use strict image upload validation');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(personFile)', 'SDK try-on must validate person upload content bytes');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(clothFile)', 'SDK try-on must validate cloth upload content bytes when supplied');
assertIncludes(sdkRoute, 'isAllowedImageFileContent(req.file)', 'SDK garment onboarding must validate garment upload content bytes');
assertIncludes(sdkRoute, 'INVALID_IMAGE_CONTENT', 'SDK routes must reject invalid uploaded image content');
assertIncludes(sdkRoute, 'resolveActiveApiKey', 'SDK routes must use the shared API-key resolver');
assertIncludes(sdkRoute, "redis.on('error'", 'SDK Redis client must handle socket errors without crashing');
assertIncludes(publicRoute, 'isAllowedImageUpload(file)', 'Public demo uploads must use strict image upload validation');
assertIncludes(publicRoute, 'isAllowedImageFileContent(personFile)', 'Public demo must validate person upload content bytes');
assertIncludes(publicRoute, 'isAllowedImageFileContent(clothFile)', 'Public demo must validate garment upload content bytes');
assertIncludes(publicRoute, 'INVALID_IMAGE_CONTENT', 'Public demo must reject invalid uploaded image content');
assertIncludes(sdkRoute, 'sanitizeUpstreamError', 'SDK try-on must sanitize upstream AI errors');
assertIncludes(publicRoute, 'sanitizeUpstreamError', 'Public demo must sanitize upstream AI errors');
assertNotIncludes(sdkRoute, "file.mimetype.startsWith('image/')", 'SDK uploads must not trust broad image/* MIME values');
assertNotIncludes(sdkRoute, "authorization?.replace('Bearer ', '')", 'SDK routes must not hand-roll bearer parsing');
assertNotIncludes(sdkRoute, "path.join(UPLOAD_ROOT", 'SDK local fallback paths must not join raw values against upload root');
assertNotIncludes(sdkRoute, "originalUrl.replace('local:', '')", 'SDK original garment reads must not trust raw local paths');
assertNotIncludes(sdkRoute, "garment.thumbnailUrl.replace('local:', '')", 'SDK thumbnail reads must not trust raw local paths');
assertNotIncludes(publicRoute, "file.mimetype.startsWith('image/')", 'Public uploads must not trust broad image/* MIME values');
assertIncludes(sdkRoute, 'router.use(createRateLimitMiddleware(600, 15 * 60 * 1000));', 'SDK API must rate limit public auth and try-on routes');
assertIncludes(rateLimit, "req.ip || 'unknown'", 'Rate limiting must rely on Express trusted proxy IP handling');
assertNotIncludes(rateLimit, "req.headers['x-forwarded-for']", 'Rate limiting must not trust spoofable x-forwarded-for directly');
assertIncludes(analyticsRoute, 'resolveActiveApiKey', 'Analytics routes must use the shared API-key resolver');
assertIncludes(analyticsRoute, 'router.use(analyticsRateLimit);', 'Analytics routes must be rate limited');
assertIncludes(analyticsRoute, 'router.use(requireDashboardProxy);', 'Analytics routes must require the same-origin dashboard proxy token');
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
assertIncludes(remoteFetchHelpers, "redirect: 'error'", 'Remote fetch helper must reject redirects');
assertIncludes(remoteFetchHelpers, 'safeFetchBuffer', 'Remote fetch helper must support guarded binary image fetches');
assertIncludes(accountRoute, 'safeFetchText', 'Account store verification and feed sync must use safe remote fetches');
assertIncludes(accountRoute, 'FEED_URL_HTTPS_REQUIRED', 'Catalog feed URLs must require HTTPS');
assertIncludes(accountRoute, 'allowInsecureStoreVerification', 'Store verification must make HTTP fallback explicit and local-only');
assertIncludes(accountRoute, "process.env.NODE_ENV !== 'production' && process.env.DRAPIXAI_ALLOW_INSECURE_STORE_VERIFICATION === '1'", 'Store verification HTTP fallback must be disabled in production');
assertIncludes(accountRoute, 'const urlsToCheck = allowInsecureVerification ? [`https://${domain}`, `http://${domain}`] : [`https://${domain}`];', 'Production store verification must check HTTPS only');
assertIncludes(accountRoute, 'allowedProtocols: allowedVerificationProtocols', 'Store verification protocol allowlist must follow HTTPS-only launch policy');
assertNotIncludes(accountRoute, "allowedProtocols: ['https:', 'http:']", 'Store verification must not always permit insecure HTTP');
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
assertNotIncludes(adminRoute, "authorization?.replace('Bearer ', '')", 'Admin routes must not hand-roll bearer parsing');
assertNotIncludes(adminRoute, "storedUrl.replace('local:', '')", 'Admin image reads must not trust raw local paths');
assertNotIncludes(adminRoute, "garment.thumbnailUrl.replace('local:', '')", 'Admin thumbnail reads must not trust raw local paths');
assertIncludes(adminRoute, "filter === 'high_latency'", 'Admin API must support high latency review filter');
assertIncludes(adminRoute, "filter === 'warnings'", 'Admin API must support warnings review filter');
assertIncludes(adminRoute, "filter === 'cache_failed'", 'Admin API must support cache failure garment filter');
assertIncludes(adminRoute, "data: { status: 'approved'", 'Admin API must support try-on approval');
assertIncludes(adminRoute, "data: { status: 'rejected'", 'Admin API must support try-on rejection');
assertIncludes(adminSessionRoute, 'createAdminSessionToken(apiKey)', 'Admin session route must store the API key only in the httpOnly session token');
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
assertIncludes(sdkInstallPage, 'quality, latency, and warning metadata', 'SDK install page must document response metadata');
assertIncludes(dashboardProxyRoute, 'readDashboardSessionToken', 'Dashboard proxy must read the httpOnly dashboard session');
assertIncludes(dashboardProxyRoute, 'SERVER_API_BASE_URL', 'Dashboard proxy must use the server-only API base URL');
assertIncludes(dashboardProxyRoute, 'DASHBOARD_SESSION_REQUIRED', 'Dashboard proxy must reject missing dashboard sessions');
assertIncludes(dashboardProxyRoute, 'isAllowedDashboardPath', 'Dashboard proxy must whitelist brand-management paths');
assertIncludes(dashboardProxyRoute, 'Authorization', 'Dashboard proxy must attach the API key only server-side');
assertIncludes(dashboardProxyRoute, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Dashboard proxy must read the server-only dashboard proxy token');
assertIncludes(dashboardProxyRoute, 'x-drapixai-dashboard-proxy-token', 'Dashboard proxy must forward the server-only proxy token');
assertIncludes(dashboardProxyRoute, 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED', 'Dashboard proxy must fail closed in production when proxy token is missing');
assertIncludes(dashboardProxyRoute, "responseHeaders.set('Cache-Control', 'no-store", 'Dashboard proxy responses must be explicitly non-cacheable');
assertIncludes(dashboardProxyRoute, 'rejectCrossOriginMutation(request)', 'Dashboard proxy must reject cross-origin mutating requests');
assertIncludes(dashboardProxyRoute, 'readLimitedProxyBody(request)', 'Dashboard proxy must use bounded request body reads');
assertIncludes(requestGuard, 'readLimitedProxyBody', 'Web request guard must cap proxied request bodies before buffering');
assertIncludes(requestGuard, 'PROXY_REQUEST_TOO_LARGE', 'Web request guard must reject oversized proxied bodies with a sanitized error');
assertIncludes(dashboardSessionRoute, 'rejectCrossOriginRequest(request)', 'Dashboard session route must reject cross-origin session mutations');
assertIncludes(dashboardSessionRoute, 'export async function GET(request: Request)', 'Dashboard session API-key reads must inspect the incoming request');
assertIncludes(dashboardSessionRoute, 'return noStoreJson({ ok: true, apiKey: session.apiKey });', 'Dashboard session API-key reads must be non-cacheable');
assertIncludes(dashboardSessionRoute, 'return noStoreJson({ ok: true, apiKey });', 'Dashboard session login responses must be non-cacheable');
assertIncludes(adminSessionRoute, 'return noStoreJson({ ok: true });', 'Admin session responses must be non-cacheable');
assertIncludes(dashboardOauthSessionRoute, 'return noStoreJson({ ok: true });', 'OAuth dashboard session bridge responses must be non-cacheable');
assertIncludes(requestGuard, 'CSRF_ORIGIN_MISMATCH', 'Web request guard must return a stable CSRF rejection code');
assertIncludes(requestGuard, 'NEXT_PUBLIC_WEB_BASE_URL', 'Web request guard must validate against the configured public web origin');
assertIncludes(requestGuard, 'NEXTAUTH_URL', 'Web request guard must support NextAuth URL as the expected origin');
assertIncludes(requestGuard, 'Cache-Control', 'Web request guard must provide no-store JSON responses for credential routes');
assertIncludes(requestGuard, 'no-store, no-cache, max-age=0, must-revalidate', 'No-store JSON helper must prevent credential response caching');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_TOKEN_HEADER', 'API must centralize dashboard proxy header handling');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_REQUIRED', 'API must reject dashboard management calls without the proxy token');
assertIncludes(dashboardProxyAuth, 'DASHBOARD_PROXY_TOKEN_NOT_CONFIGURED', 'API must fail closed when the dashboard proxy token is missing in production');
assertIncludes(sdkRoute, 'requireDashboardProxy', 'SDK management routes must be protected by the dashboard proxy token');
assertIncludes(sdkRoute, "router.post('/garments', authMiddleware, requireDashboardProxy", 'Garment uploads must require dashboard proxy token');
assertIncludes(sdkRoute, "router.get('/catalog', authMiddleware, requireDashboardProxy", 'Catalog management must require dashboard proxy token');
assertIncludes(sdkRoute, "router.post('/matches/:garmentId/confirm', authMiddleware, requireDashboardProxy", 'Garment mapping confirmation must require dashboard proxy token');
assertIncludes(sdkRoute, "router.get('/result/:jobId', authMiddleware, async", 'Shopper result endpoint must stay available through storefront auth and domain checks');
assertIncludes(dashboardPage, '/api/dashboard/proxy/', 'Dashboard page must use the same-origin dashboard proxy for management calls');
assertIncludes(settingsPage, '/api/dashboard/proxy/', 'Settings page must use the same-origin dashboard proxy for account calls');
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
assertIncludes(smokeTryon, 'quality="standard"', 'RunPod smoke try-on must execute Standard quality');
assertIncludes(smokeMatrix, '"candidate_count": 1', 'RunPod smoke matrix must record Standard candidate count');
assertNotIncludes(smokeTryon, 'enhanced_', 'RunPod smoke try-on must not use enhanced settings');
assertNotIncludes(smokeMatrix, 'enhanced_', 'RunPod smoke matrix must not use enhanced settings');

assertIncludes(validateEnv, 'require_equals DRAPIXAI_REQUIRE_GARMENT_CACHE "1"', 'API env validation must enforce cached garments');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON "0"', 'API env validation must enforce cached SDK generation path');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_SDK_GENERATION_SOURCE "original_verified"', 'API env validation must enforce direct-quality SDK generation source');
assertIncludes(validateEnv, 'DRAPIXAI_AI_SERVICE_TOKEN', 'Env validation must require API-to-AI service token');
assertIncludes(validateEnv, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Env validation must require the dashboard proxy token');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_DASHBOARD_PROXY_TOKEN 32', 'Env validation must require a strong dashboard proxy token');
assertIncludes(validateEnv, 'require_min_length JWT_SECRET 32', 'API env validation must require a strong JWT secret');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_AUTH_SYNC_TOKEN 32', 'Env validation must require a strong auth sync token');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_AI_SERVICE_TOKEN 32', 'Env validation must require a strong AI service token');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_AUTH_SYNC_TOKEN', 'Production env set validation must compare auth sync token across API and web');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Production env set validation must compare dashboard proxy token across API and web');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_AI_SERVICE_TOKEN', 'Production env set validation must compare AI service token across API and AI');
assertIncludes(validateProductionEnvSet, 'require_match DRAPIXAI_ADMIN_TOKEN', 'Production env set validation must compare admin token across API and AI');
assertIncludes(validateProductionEnvSet, 'git -C "$repo_root" check-ignore -q "$env_file"', 'Production env set validation must verify every real env file is ignored by Git');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_AUTH_SYNC_TOKEN', 'PowerShell env set validation must compare auth sync token across API and web');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'PowerShell env set validation must compare dashboard proxy token across API and web');
assertIncludes(validateProductionEnvSetPowerShell, 'Assert-Match DRAPIXAI_AI_SERVICE_TOKEN', 'PowerShell env set validation must compare AI service token across API and AI');
assertIncludes(validateProductionEnvSetPowerShell, 'git -C $repoRoot check-ignore -q $envFile', 'PowerShell env set validation must verify every real env file is ignored by Git');
assertIncludes(validateEnv, 'require_min_length DRAPIXAI_ADMIN_TOKEN 32', 'Env validation must require a strong admin token');
assertIncludes(validateEnv, 'require_min_length NEXTAUTH_SECRET 32', 'Web env validation must require a strong NextAuth secret');
assertIncludes(validateEnv, 'require_min_length DASHBOARD_SESSION_SECRET 32', 'Web env validation must require a strong dashboard session secret');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_ENV "production"', 'AI env validation must enable production fail-closed checks');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_TRYON_ENGINE "catvton"', 'AI env validation must enforce CatVTON');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_CANDIDATE_COUNT "1"', 'AI env validation must enforce Standard-only candidate count');
assertIncludes(validateEnv, 'require_number_at_least DRAPIXAI_MIN_QUALITY_SCORE "0.9"', 'AI env validation must enforce launch quality threshold');
assertIncludes(apiProductionExample, 'DRAPIXAI_REQUIRE_GARMENT_CACHE=1', 'API production example must require cached garments');
assertIncludes(apiProductionExample, 'DRAPIXAI_AUTH_SYNC_TOKEN=replace-with-the-same-web-api-auth-sync-token', 'API production example must include auth sync token');
assertIncludes(apiProductionExample, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN=replace-with-the-same-dashboard-proxy-token', 'API production example must include dashboard proxy token');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON=0', 'API production example must prefer cached assets');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_GENERATION_SOURCE=original_verified', 'API production example must use original garment source after cache validation');
assertIncludes(apiProductionExample, 'DRAPIXAI_AI_SERVICE_TOKEN=replace-with-a-long-random-secret', 'API production example must include AI service token');
assertNotIncludes(aiProductionExample, 'DRAPIXAI_ENHANCED_', 'AI production example must not expose enhanced-mode env names');
assertIncludes(aiProductionExample, 'DRAPIXAI_ENV=production', 'AI production example must set production mode');
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
assertIncludes(gitignore, '.next-review/', 'Git ignore must exclude Next review build artifacts');
assertIncludes(gitignore, 'output/', 'Generated catalog output must stay out of Git');
assertIncludes(gitignore, 'outputs/', 'Generated launch package outputs must stay out of Git');
assertIncludes(setupBatch, 'LEGACY_SETUP_DISABLED', 'Legacy destructive Setup.bat scaffold must stay disabled');
assertNotIncludes(setupBatch, 'your-super-secret-jwt-key', 'Legacy setup must not ship weak JWT examples');
assertNotIncludes(setupBatch, 'ALLOWED_ORIGINS="*"', 'Legacy setup must not write wildcard origins');
assertIncludes(nextConfig, 'poweredByHeader: false', 'Web app must disable the Next.js powered-by header');
assertIncludes(nextConfig, 'Content-Security-Policy', 'Web app must send a Content Security Policy');
assertIncludes(nextConfig, "frame-ancestors 'none'", 'Web CSP must prevent clickjacking frame ancestors');
assertIncludes(nextConfig, "object-src 'none'", 'Web CSP must block legacy plugin content');
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
assertIncludes(productionReadiness, 'sanitize configurable CSS values and logo URLs', 'Production readiness doc must call out SDK markup sanitization');
assertIncludes(productionReadiness, 'production security headers from `next.config.js`', 'Production readiness doc must call out web security headers');
assertIncludes(productionReadiness, 'reject cross-origin session and proxy mutations', 'Production readiness doc must call out CSRF protection for cookie-backed routes');
assertIncludes(productionReadiness, 'shopper person photos and generated try-on preview images may be retained for up to 30 days', 'Production readiness doc must define launch retention policy');
assertIncludes(productionReadiness, 'tryon:purge-review-retention -- --dry-run', 'Production readiness doc must include retention purge dry-run command');
assertIncludes(read('apps/api/package.json'), 'email:send-test', 'API package must expose SMTP launch verification command');
assertIncludes(smtpTestScript, 'SMTP_TEST_TO', 'SMTP test command must support env-based recipient configuration');
assertIncludes(smtpTestScript, "event: log.event", 'SMTP test command must report the EmailLog event');
assertIncludes(smtpTestScript, "status: log.status", 'SMTP test command must report the EmailLog status');
assertIncludes(smtpTestScript, "log.status !== 'sent'", 'SMTP test command must fail unless EmailLog confirms sent status');
assertIncludes(smtpTestScript, 'SMTP verification requires an existing DrapixAI account email', 'SMTP test command must require a real account for audit logging');
assertIncludes(emailerService, 'Promise<EmailSendResult>', 'Email helper must return structured delivery status');
assertIncludes(emailerService, "error: 'SMTP_HOST_NOT_CONFIGURED'", 'Email helper must report missing SMTP config instead of silently passing');
assertIncludes(emailerService, 'logId: log.id', 'Email helper must expose the EmailLog id for launch verification');
assertIncludes(productionReadiness, 'npm --prefix apps/api run email:send-test -- --to=admin@yourbrand.com', 'Production readiness doc must include SMTP launch verification command');
assertIncludes(read('apps/api/package.json'), 'tryon:purge-review-retention', 'API package must expose try-on retention purge command');
assertIncludes(retentionPurgeScript, 'DEFAULT_RETENTION_DAYS = 30', 'Retention purge must default to 30 days');
assertIncludes(retentionPurgeScript, '--confirm', 'Retention purge must require explicit confirmation before deleting');
assertIncludes(retentionPurgeScript, 'DeleteObjectCommand', 'Retention purge must delete S3 review images');
assertIncludes(retentionPurgeScript, 'removeLocalStoredFile(storedUrl, REVIEW_PREFIX)', 'Retention purge must guard local review image deletion');
assertIncludes(retentionPurgeScript, 'personImageUrl: null', 'Retention purge must clear retained person review URLs');
assertIncludes(retentionPurgeScript, 'resultImageUrl: null', 'Retention purge must clear retained result review URLs');
assertIncludes(securityHelpers, 'removeLocalStoredFile', 'Security helper must support guarded local retention deletion');
assertIncludes(privacyPage, 'retained for up to 30 days', 'Privacy page must define shopper photo/result retention window');
assertIncludes(privacyPage, 'privacy@drapixai.com', 'Privacy page must publish privacy contact');
assertIncludes(sdkJs, 'quality review, fraud prevention, and support', 'SDK privacy copy must match retention/review use');
assertIncludes(productionReadiness, 'npm run start:local', 'Production readiness doc must include one-command local stack startup');
assertIncludes(productionReadiness, 'localhost:5433', 'Production readiness doc must match the local Postgres port override');
assertIncludes(productionReadiness, 'prove-live-stack.ps1 -ApiUrl http://localhost:8000', 'Production readiness doc must include local live-stack proof command');
assertIncludes(productionReadiness, 'validate-production-env-set.sh', 'Production readiness doc must include cross-file env-set validation');
assertIncludes(productionReadiness, 'validate-production-env-set.ps1', 'Production readiness doc must include Windows cross-file env-set validation');
assertIncludes(productionReadiness, '- `DRAPIXAI_AUTH_SYNC_TOKEN`\n- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`\n- `DRAPIXAI_AI_URL`', 'Production readiness doc must list dashboard proxy token as a required API env');
assertIncludes(productionReadiness, '- `DRAPIXAI_AUTH_SYNC_TOKEN`\n- `DRAPIXAI_DASHBOARD_PROXY_TOKEN`\n\nRequired only if Google login is enabled:', 'Production readiness doc must list dashboard proxy token as a required Web env');

assertIncludes(smokeTest, '/sdk/garments', 'Deployment smoke test must upload and cache garment assets');
assertIncludes(smokeTest, '/sdk/catalog/sync', 'Deployment smoke test must sync product catalog mapping');
assertIncludes(smokeTest, '/sdk/matches/${GARMENT_ID}/confirm', 'Deployment smoke test must confirm garment-product mapping');
assertIncludes(smokeTest, 'x-drapixai-dashboard-proxy-token', 'Deployment smoke test must send dashboard proxy token for management calls');
assertIncludes(smokeTest, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'Deployment smoke test must support dashboard proxy token from env');
assertIncludes(smokeTest, 'productId=${PRODUCT_ID}', 'Deployment smoke test must try on through product mapping');
assertIncludes(smokeTest, 'quality=standard', 'Deployment smoke test must request Standard quality');
assertIncludes(smokeTestPowerShell, '/sdk/garments', 'PowerShell smoke test must upload and cache garment assets');
assertIncludes(smokeTestPowerShell, '/sdk/catalog/sync', 'PowerShell smoke test must sync product catalog mapping');
assertIncludes(smokeTestPowerShell, '/sdk/matches/$GarmentId/confirm', 'PowerShell smoke test must confirm garment-product mapping');
assertIncludes(smokeTestPowerShell, 'x-drapixai-dashboard-proxy-token', 'PowerShell smoke test must send dashboard proxy token for management calls');
assertIncludes(smokeTestPowerShell, 'DRAPIXAI_DASHBOARD_PROXY_TOKEN', 'PowerShell smoke test must support dashboard proxy token from env');
assertIncludes(smokeTestPowerShell, 'productId=$ProductId', 'PowerShell smoke test must try on through product mapping');
assertIncludes(smokeTestPowerShell, 'quality=standard', 'PowerShell smoke test must request Standard quality');
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
assertIncludes(proveLiveShell, '"checks.database.ready" \'true\'', 'Live proof shell must verify DB through API readiness');
assertIncludes(proveLiveShell, '"checks.redis" \'true\'', 'Live proof shell must verify Redis through API readiness');
assertIncludes(proveLiveShell, '"checks.ai.status" \'"ready"\'', 'Live proof shell must verify AI through API readiness');
assertIncludes(proveLivePowerShell, 'Database ready through API', 'Live proof PowerShell must verify DB');
assertIncludes(proveLivePowerShell, 'Redis ready through API', 'Live proof PowerShell must verify Redis');
assertIncludes(proveLivePowerShell, 'AI ready through API', 'Live proof PowerShell must verify AI');
assertIncludes(proveLiveShell, 'resolve_dashboard_proxy_token', 'Live proof shell must resolve dashboard proxy token for SDK smoke flow');
assertIncludes(proveLiveShell, 'DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token" bash', 'Live proof shell must pass dashboard proxy token to SDK smoke flow');
assertIncludes(localPreflight, 'Get-LocalSetting', 'Local preflight must read local .env port overrides');
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
assertIncludes(localPreflight, 'uvicorn drapixai_ai.api.ai_server:app', 'Local preflight must explain how to start the AI API after infra checks');
assertIncludes(rootPackageJson, 'start:local', 'Root package scripts must expose one-command local stack startup');
assertIncludes(localStart, 'Test-PortListening', 'Local stack starter must be idempotent by checking ports before starting services');
assertIncludes(localStart, 'docker-compose up -d postgres redis minio', 'Local stack starter must bring up required infra');
assertIncludes(localStart, 'RedirectStandardOutput', 'Local stack starter must capture stdout logs');
assertIncludes(localStart, 'RedirectStandardError', 'Local stack starter must capture stderr logs separately');
assertIncludes(localStart, 'local-preflight.ps1', 'Local stack starter must run preflight after startup');
assertIncludes(localStart, 'drapixai_ai.api.ai_server:app', 'Local stack starter must start the AI API service');
assertIncludes(runpodPreflight, 'bash -n "$script"', 'RunPod preflight must syntax-check launch shell scripts');
assertIncludes(runpodPreflight, 'DRAPIXAI_EXPECTED_GIT_REF', 'RunPod preflight must support exact launch commit verification');
assertIncludes(runpodPreflight, '== Repo Version ==', 'RunPod preflight must print repo branch and commit');
assertIncludes(runpodPreflight, 'deploy/scripts/smoke-test.sh', 'RunPod preflight must include deployment smoke shell syntax check');
assertIncludes(runpodPreflight, 'deploy/runpod/run-launch-tryon-test.sh', 'RunPod preflight must include launch try-on shell syntax check');
assertIncludes(runLaunchTryon, 'API_ENV_FILE=', 'RunPod launch try-on test must know where the API env file lives');
assertIncludes(runLaunchTryon, 'read_env_value DRAPIXAI_DASHBOARD_PROXY_TOKEN "$API_ENV_FILE"', 'RunPod launch try-on test must load dashboard proxy token from API env');
assertIncludes(runLaunchTryon, 'DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token"', 'RunPod launch try-on test must pass dashboard proxy token to SDK smoke flow');
assertIncludes(runpodSdkApiSetup, 'DRAPIXAI_ADMIN_PASSWORD=' + '$' + '(generate_secret)', 'RunPod SDK/API setup must generate a unique admin password');
assertNotIncludes(runpodSdkApiSetup, 'DRAPIXAI_ADMIN_PASSWORD=ChangeMe123!', 'RunPod SDK/API setup must not write a fixed admin password');
assertIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"', 'RunPod SDK/API setup must not default MinIO password to a fixed value');
assertIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"', 'RunPod SDK/API setup must not default Postgres password to a fixed value');
assertIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(generate_secret)}"', 'RunPod SDK/API setup must generate a MinIO password');
assertIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(generate_secret)}"', 'RunPod SDK/API setup must generate a Postgres password');
assertNotIncludes(runpodSdkApiSetup, 'MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-drapixai-local-secret}"', 'RunPod SDK/API setup must not write a fixed MinIO password');
assertNotIncludes(runpodSdkApiSetup, 'POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-drapixai}"', 'RunPod SDK/API setup must not write a fixed Postgres password');
assertIncludes(read('deploy/runpod/setup-fresh-runpod.sh'), 'codex/catvton-runpod-clean', 'RunPod setup-fresh-runpod.sh must default to launch branch');
assertIncludes(read('deploy/runpod/prepare-runpod-for-launch.sh'), 'codex/catvton-runpod-clean', 'RunPod prepare wrapper must default to launch branch');
assertIncludes(read('deploy/runpod/README.md'), 'DRAPIXAI_LAUNCH_MIN_QUALITY_SCORE', 'RunPod README must document strict launch quality gates');
assertIncludes(read('deploy/runpod/README.md'), 'DRAPIXAI_EXPECTED_GIT_REF', 'RunPod README must document optional exact commit pinning');

assertIncludes(homePage, 'Standard upper-body AI try-on infrastructure', 'Homepage must state current Standard upper-body scope');
assertIncludes(homePage, 'confirmed-product-id', 'Homepage SDK snippet must use confirmed product mapping');
assertIncludes(homePage, "quality: 'standard'", 'Homepage SDK snippet must show Standard quality');
assertIncludes(homePage, '10-12s warm latency target', 'Homepage must frame latency as a target');
assertNotIncludes(homePage, 'photorealistic', 'Homepage must not overpromise photorealism');
assertNotIncludes(homePage, 'Sub-10', 'Homepage must not promise sub-10s rendering');
assertNotIncludes(homePage, 'Works with any platform', 'Homepage must not overpromise universal platform support');

console.log('Launch readiness tests passed.');
