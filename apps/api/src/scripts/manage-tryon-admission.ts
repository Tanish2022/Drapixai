import { createClient } from 'redis';
import { ADMISSION_KEYS, acknowledgeTryOnWorkersIdle, admissionEpoch, reconcileTerminalTryOn, redisRunId } from '../lib/tryon-concurrency';

async function main() {
  let text = ''; for await (const chunk of process.stdin) { text += chunk.toString(); if (Buffer.byteLength(text) > 4096) throw new Error('INPUT_LIMIT'); }
  const input = JSON.parse(text) as { action?: string; expectedRunId?: string; reference?: string; confirmation?: string; token?: string };
  if (!['status', 'acknowledge-worker-idle', 'release-terminal-work'].includes(input.action || '')) throw new Error('ACTION_INVALID');
  if (!process.env.REDIS_URL) throw new Error('EXPLICIT_REDIS_TARGET_REQUIRED');
  const client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on('error', () => undefined);
  const timer = setTimeout(() => { if (client.isOpen) void client.disconnect().catch(() => undefined); }, 10_000);
  try {
    await client.connect(); const runId = await redisRunId(client);
    if (input.action === 'status') {
      console.log(JSON.stringify({ readOnly: true, runId, acknowledged: await client.get(ADMISSION_KEYS.guard) === `${admissionEpoch()}:${runId}`, activeAndHeld: await client.zCard(ADMISSION_KEYS.global), dispatched: await client.hLen(ADMISSION_KEYS.work), uncertain: await client.hLen(ADMISSION_KEYS.uncertain) }));
    } else {
      const required = input.action === 'acknowledge-worker-idle' ? 'I_VERIFIED_ALL_AI_WORKERS_IDLE' : 'I_VERIFIED_THIS_AI_JOB_TERMINAL';
      if (input.confirmation !== required || process.env.DRAPIXAI_TRYON_INTAKE_ENABLED !== '0') throw new Error('PAUSED_INTAKE_AND_OPERATOR_PROOF_REQUIRED');
      const result = input.action === 'acknowledge-worker-idle'
        ? await acknowledgeTryOnWorkersIdle(client, input.expectedRunId || '', input.reference || '')
        : await reconcileTerminalTryOn(client, input.token || '', input.expectedRunId || '', input.reference || '');
      console.log(JSON.stringify({ passed: true, action: input.action, reference: input.reference, ...result }));
    }
  } finally { clearTimeout(timer); if (client.isOpen) await client.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('TRYON_ADMISSION_OPERATOR_REFUSED'); process.exitCode = 1; });
