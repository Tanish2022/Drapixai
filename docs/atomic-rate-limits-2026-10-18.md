# Atomic Redis rate-limit counters — 18 October 2026

Work packages 4–5 and 8; baseline `4efd68ab224af7ed9c77125c1ea36b2721788fd4`. **Repository fix and disposable-Redis verification; live rate-limit/capacity approval remains open.** No Standard CatVTON or original launch-gate changes.

## Finding and remediation

The shared fixed-window limiter issued `INCR`, then separately issued `PEXPIRE` only for the first request. A process/connection failure between those commands could leave a permanent Redis key. An explicit expiry-command denial reproduced this in real disposable Redis: `INCR` succeeded and the key's `PTTL` remained `-1`. Subsequent requests to that bucket did not repair it because its count was already greater than one.

Severity: **low, resource-retention/reliability weakness**, dependent on a failure or permissions problem. The fixed-window suffix still changed next window, so this did not prove a permanent account lockout or rate-limit bypass. No production outage, malicious traffic or exhausted Redis instance was tested.

`apps/api/src/lib/rate-limit.ts` now consumes the counter through one constant, single-key Lua script:

- A missing key is created as zero with a millisecond expiry in the same `SET` command, **before** incrementing.
- A persistent existing key receives an expiry **before** incrementing; its previous count is preserved.
- An existing expiring key keeps its expiry; requests cannot slide the window or extend storage retention.
- The script returns the incremented count. Invalid replies fail closed in production through the existing 503 path.

The operation is isolated from other Redis clients. Expiry-first ordering also matters on script errors: Redis does not undo previous writes merely because a later command fails. If expiry creation/repair is denied, the script stops before incrementing. A pre-existing orphan that cannot be repaired stays unchanged and requires operator correction; this patch does not claim to erase every historical rate-limit key.

Request limits, route/identity hashing, UTC window numbering, reset/remaining/retry headers, the one-second cleanup allowance and production fail-closed policy are preserved. Development/test memory fallback retains its existing behavior. The script uses explicit `KEYS[1]`, not a dynamically constructed script or multi-key transaction. No new dependency, database migration or production configuration variable is added.

## Verification

| Check | Evidence |
|---|---|
| Before/after behavior | Before the fix, **73/75** boundary cases passed: expiry failure left a synthetic persistent counter; a malformed counter reply was not rejected. After the fix **75/75 passed**, including all previous authentication, session, authorization, upload, JWT, Origin and outbound regressions. The malformed reply is fault-containment coverage, not a demonstrated normal Redis protocol vulnerability. |
| Real concurrent clients | The real Lua script, invoked by two independent Redis clients, returned exactly counts **1–32** for 32 simultaneous claims on one fixture key, with a positive TTL afterwards. |
| Repair and expiry | An orphaned count 17 became 18 with an expiry; an already bounded count 9 became 10 without extending expiry. A short-lived consumed key physically disappeared. |
| Real command-denial negative control | A synthetic ACL identity could execute `INCR` but not expiry setup. Old separate commands left a persistent key; the fixed script created no new key when `SET PX` was denied and did not increment an existing orphan when `PEXPIRE` was denied. Invalid expiry input also failed before creating a new key. This is a command-failure test, not a production process-kill or Redis failover drill. |
| Actual middleware | **24 concurrent requests admitted exactly five and returned 429 for 19**, stored count 24, emitted bounded retry/remaining headers and left an expiring key. Only the application's bucket clock was frozen to avoid a test boundary race; Redis used its real expiry clock. |
| Integration | Existing three-tenant concurrency/lease reclamation and webhook claim checks passed in the same disposable Redis run. API TypeScript and full launch-readiness checks pass. Existing CI distributed-security and launch jobs execute the new cases without a new workflow or package script. |

Local Redis image: `sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`. The harness created its own password-protected, resource-bounded container, published only an ephemeral `127.0.0.1` port and removed it afterwards. Only exact fixture keys and a new random ACL identity were cleaned up; no database was flushed and no existing ACL user was modified. Test connection cleanup is guarded to test mode.

Changes are in `rate-limit.ts`, `apps/api/src/scripts/rate-limit-redis-tests.ts`, its existing `distributed-security-control-tests.ts` caller, launch source contracts and `scripts/test-security-boundaries.cjs`. Ignored local evidence: `runtime/launch-evidence/atomic-rate-limits-2026-10-18/`. Post-push CI must match the committed patch; prior green jobs are not evidence for these changes.

## Deployment and limits

The application Redis identity needs `EVAL` and the script's `PTTL`, `SET`, `PEXPIRE` and `INCR` permissions on its rate-limit namespace, alongside its separately reviewed existing commands. It does **not** need ACL-management permission; that is used only by the disposable negative-control fixture. Test least-privilege permissions on staging; a denied script must produce 503, not a local fallback in production.

Only accessed orphaned buckets can be repaired by this code. Inventory historical keys and correct their TTLs through an approved operator procedure; do not delete arbitrary counters, which could reset active limits. Per-replica clock skew, fixed-window boundary bursts, real ingress/proxy trust, Redis eviction/failover, slow incoming requests, aggregate capacity and alert delivery remain deployment tests. Atomicity is not durability across every failure mode or DDoS certification.

References: [Redis Lua execution and command errors](https://redis.io/docs/latest/develop/programmability/eval-intro/), [Redis transaction error/rollback behavior](https://redis.io/docs/latest/develop/using-commands/transactions/) and [PTTL semantics](https://redis.io/docs/latest/commands/pttl/). No OWASP/ASVS or launch gate is declared complete by this local fix. AI dependency remediation, live staging, independent penetration testing, legal/pilot approvals and GPU quality/parity/four-request evidence remain required.
