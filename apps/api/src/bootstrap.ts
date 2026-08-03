import 'dotenv/config';
import { loadExternalSecrets } from './lib/external-secrets';

const main = async () => {
  const loaded = await loadExternalSecrets();
  if (loaded > 0) {
    console.log(`Loaded ${loaded} allowlisted secrets from the configured managed provider.`);
  }
  await import('./server');
};

main().catch((error) => {
  console.error('API bootstrap failed:', error instanceof Error ? error.message : 'BOOTSTRAP_FAILED');
  process.exit(1);
});
