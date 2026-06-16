import assert from 'assert';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd(), '../..');

const read = (relativePath: string) => {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
};

const assertIncludes = (source: string, expected: string, label: string) => {
  assert.ok(source.includes(expected), label);
};

const assertNotIncludes = (source: string, unexpected: string, label: string) => {
  assert.ok(!source.includes(unexpected), label);
};

const sdkRoute = read('apps/api/src/routes/sdk.ts');
const apiServer = read('apps/api/src/server.ts');
const adminRoute = read('apps/api/src/routes/admin.ts');
const publicRoute = read('apps/api/src/routes/public.ts');
const adminPage = read('apps/web/app/admin/page.tsx');
const sdkJs = read('apps/web/public/sdk.js');
const sdkInstallPage = read('apps/web/app/sdk-install/page.tsx');
const plans = read('apps/api/src/lib/plans.ts');
const pipeline = read('drapixai_ai/pipeline/tryon_pipeline.py');
const aiServer = read('drapixai_ai/api/ai_server.py');
const aiSettings = read('drapixai_ai/configs/settings.py');
const cacheRegenerationScript = read('apps/api/src/scripts/regenerate-garment-caches.ts');
const smokeTryon = read('deploy/runpod/smoke_tryon.py');
const smokeMatrix = read('deploy/runpod/smoke_matrix.py');
const smokeTest = read('deploy/scripts/smoke-test.sh');
const validateEnv = read('deploy/scripts/validate-env.sh');
const aiProductionExample = read('deploy/env/ai.production.example');
const apiProductionExample = read('deploy/env/api.production.example');
const homePage = read('apps/web/app/page.tsx');
const proveLiveShell = read('deploy/scripts/prove-live-stack.sh');
const proveLivePowerShell = read('deploy/scripts/prove-live-stack.ps1');

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

assertIncludes(aiSettings, 'ai_service_token', 'AI settings must include internal service token');
assertIncludes(aiServer, 'x-drapixai-service-token', 'AI server must read internal service token header');
assertIncludes(aiServer, 'AI_SERVICE_TOKEN_REQUIRED', 'AI server must reject protected calls without token');
assertIncludes(sdkRoute, 'const AI_SERVICE_TOKEN = process.env.DRAPIXAI_AI_SERVICE_TOKEN', 'SDK API route must load AI service token');
assertIncludes(sdkRoute, 'x-drapixai-service-token', 'SDK API route must forward AI service token');
assertIncludes(publicRoute, 'x-drapixai-service-token', 'Public demo route must forward AI service token');
assertIncludes(cacheRegenerationScript, 'x-drapixai-service-token', 'Cache regeneration script must forward AI service token');
assertIncludes(apiServer, 'DRAPIXAI_EXPOSE_READY_DETAILS', 'API readiness details must be opt-in for production');

assertIncludes(adminRoute, "filter === 'low_quality'", 'Admin API must support low quality review filter');
assertIncludes(adminRoute, "filter === 'high_latency'", 'Admin API must support high latency review filter');
assertIncludes(adminRoute, "filter === 'warnings'", 'Admin API must support warnings review filter');
assertIncludes(adminRoute, "filter === 'cache_failed'", 'Admin API must support cache failure garment filter');
assertIncludes(adminRoute, "data: { status: 'approved'", 'Admin API must support try-on approval');
assertIncludes(adminRoute, "data: { status: 'rejected'", 'Admin API must support try-on rejection');

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
assertIncludes(sdkJs, "drapixai:buy", 'Browser SDK must expose buy event');
assertIncludes(sdkJs, "onBuy", 'Browser SDK must support onBuy callback');
assertIncludes(sdkJs, "qualityMode: response.headers.get('x-drapixai-quality-mode')", 'Browser SDK must expose Standard quality metadata');
assertIncludes(sdkJs, "garmentSource: response.headers.get('x-drapixai-garment-source')", 'Browser SDK must expose garment source metadata');
assertIncludes(sdkJs, "garmentCacheStatus: response.headers.get('x-drapixai-garment-cache-status')", 'Browser SDK must expose cache status metadata');
assertIncludes(sdkJs, "garmentCacheVersion: response.headers.get('x-drapixai-garment-cache-version')", 'Browser SDK must expose cache version metadata');
assertIncludes(sdkInstallPage, "quality: 'standard'", 'SDK install page must document Standard-only usage');
assertIncludes(sdkInstallPage, 'quality, latency, and warning metadata', 'SDK install page must document response metadata');

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
assertIncludes(validateEnv, 'require_equals DRAPIXAI_TRYON_ENGINE "catvton"', 'AI env validation must enforce CatVTON');
assertIncludes(validateEnv, 'require_equals DRAPIXAI_CANDIDATE_COUNT "1"', 'AI env validation must enforce Standard-only candidate count');
assertIncludes(validateEnv, 'require_number_at_least DRAPIXAI_MIN_QUALITY_SCORE "0.9"', 'AI env validation must enforce launch quality threshold');
assertIncludes(apiProductionExample, 'DRAPIXAI_REQUIRE_GARMENT_CACHE=1', 'API production example must require cached garments');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON=0', 'API production example must prefer cached assets');
assertIncludes(apiProductionExample, 'DRAPIXAI_SDK_GENERATION_SOURCE=original_verified', 'API production example must use original garment source after cache validation');
assertIncludes(apiProductionExample, 'DRAPIXAI_AI_SERVICE_TOKEN=replace-with-a-long-random-secret', 'API production example must include AI service token');
assertNotIncludes(aiProductionExample, 'DRAPIXAI_ENHANCED_', 'AI production example must not expose enhanced-mode env names');
assertIncludes(aiProductionExample, 'DRAPIXAI_AI_SERVICE_TOKEN=replace-with-the-same-api-ai-service-token', 'AI production example must include matching AI service token');

assertIncludes(smokeTest, '/sdk/garments', 'Deployment smoke test must upload and cache garment assets');
assertIncludes(smokeTest, '/sdk/catalog/sync', 'Deployment smoke test must sync product catalog mapping');
assertIncludes(smokeTest, '/sdk/matches/${GARMENT_ID}/confirm', 'Deployment smoke test must confirm garment-product mapping');
assertIncludes(smokeTest, 'productId=${PRODUCT_ID}', 'Deployment smoke test must try on through product mapping');
assertIncludes(smokeTest, 'quality=standard', 'Deployment smoke test must request Standard quality');
assertIncludes(proveLiveShell, "data.get('checks', {}).get('database', {}).get('ready') is True", 'Live proof shell must verify DB through API readiness');
assertIncludes(proveLiveShell, "data.get('checks', {}).get('redis') is True", 'Live proof shell must verify Redis through API readiness');
assertIncludes(proveLiveShell, "data.get('checks', {}).get('ai', {}).get('status') == 'ready'", 'Live proof shell must verify AI through API readiness');
assertIncludes(proveLivePowerShell, 'Database ready through API', 'Live proof PowerShell must verify DB');
assertIncludes(proveLivePowerShell, 'Redis ready through API', 'Live proof PowerShell must verify Redis');
assertIncludes(proveLivePowerShell, 'AI ready through API', 'Live proof PowerShell must verify AI');

assertIncludes(homePage, 'Standard upper-body AI try-on infrastructure', 'Homepage must state current Standard upper-body scope');
assertIncludes(homePage, 'confirmed-product-id', 'Homepage SDK snippet must use confirmed product mapping');
assertIncludes(homePage, "quality: 'standard'", 'Homepage SDK snippet must show Standard quality');
assertIncludes(homePage, '10-12s warm latency target', 'Homepage must frame latency as a target');
assertNotIncludes(homePage, 'photorealistic', 'Homepage must not overpromise photorealism');
assertNotIncludes(homePage, 'Sub-10', 'Homepage must not promise sub-10s rendering');
assertNotIncludes(homePage, 'Works with any platform', 'Homepage must not overpromise universal platform support');

console.log('Launch readiness tests passed.');
