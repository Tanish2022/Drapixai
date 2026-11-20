import 'dotenv/config';
import { loadExternalSecrets } from './lib/external-secrets';
import { normalizeNeonStagingUrl } from './lib/neon-staging';

const main = async () => {
  const loaded = await loadExternalSecrets();
  if (process.env.DRAPIXAI_REQUIRE_NEON_STAGING === '1') {
    process.env.DATABASE_URL = normalizeNeonStagingUrl(process.env.DATABASE_URL, 'runtime');
    if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('STAGING_STORAGE_WORKLOAD_IDENTITY_REQUIRED');
    }
  }
  if (loaded > 0) {
    console.log(`Loaded ${loaded} allowlisted secrets from the configured managed provider.`);
  }
  await import('./server');
};

main().catch((error) => {
  console.error('API bootstrap failed:', error instanceof Error ? error.message : 'BOOTSTRAP_FAILED');
  process.exit(1);
});
