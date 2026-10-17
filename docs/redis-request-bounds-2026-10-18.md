# Redis request deadlines and recovery — 18 October 2026

Work packages 4–5, 8 and 15; baseline `bec14101ec25baf7fb2bf52d105f056a192a230c`. **Implemented and locally tested; live infrastructure/outage and GPU acceptance gates remain open.** This follows the [atomic counter fix](atomic-rate-limits-2026-10-18.md).

## Finding and scope

The API Redis clients used node-redis 4.7.1 defaults: reconnect attempts and offline queuing. Rate-limit and concurrency admission awaited connection/commands without a total deadline. A loopback TCP peer accepting connections but returning no Redis handshake or command replies left both handlers waiting beyond the test's 4.5-second watchdog. Readiness/admin wrappers already bounded some response waits, but did not dispose the Redis transport or its queued commands. Metrics and the disabled-in-production legacy enqueue path also used the same unbounded client pattern.

Severity: **medium availability/resource containment weakness under a dependency failure**. Public traffic during such a fault could accumulate waiting work. No externally triggered Redis failure, production outage, exhausted process or DDoS capacity was demonstrated. A separate malformed-reply fixture found that coercing a concurrency reply with `Number()` could interpret `null` as a successful lease; ordinary Redis execution of the reviewed script does not return null, so this is fail-closed hardening rather than a demonstrated normal-protocol exploit.

## Changes and affected files

`apps/api/src/lib/request-redis.ts` centralizes request handling using the existing client library:

- One **three-second budget** covers connection/handshake and callback completion. TCP/TLS connection attempts also have a one-second connection timeout. Event-loop blocking can delay timers; this is not a real-time guarantee.
- Offline queuing and automatic reconnect/replay are disabled. Each purpose reuses a healthy connection; after failure, a later request creates a fresh generation. There is no internal retry of an uncertain command.
- Each purpose admits at most **256 pending Redis requests**, with a matching bounded client command queue. Overflow rejects before allocating another transport. This is not a GPU concurrency setting or evidence that 256 try-ons are supported.
- Failure retires that generation and closes an established transport. Generation checks reject late results and prevent an expired connection attempt from dispatching an application command when it finally connects. A late failure cannot retire a newer recovered connection.
- Socket errors are handled and logged through the existing redaction function. Test cleanup uses the existing test-only entry points.

| Consumer | Integration |
|---|---|
| `lib/rate-limit.ts` | Existing atomic expiry/counter Lua runs through the shared boundary. Production still returns 503 without admitting the request; non-production memory fallback is preserved. |
| `lib/tryon-concurrency.ts` | Acquisition/release are bounded. Only exact numeric replies 0/1/2 are accepted; unknown replies deny admission. Lease time is calculated after connection readiness, rather than consuming its lifetime while connecting. Existing limits, Lua policy and lease duration are unchanged. |
| `server.ts` | Readiness and authenticated metrics reads use bounded Redis operations. Metrics receive a narrow bounded-read adapter; their database behavior is unchanged. |
| `routes/admin.ts` | Redis health and queue-depth reads share one bounded operation. Failed collection reports unavailable rather than a healthy dependency. |
| `routes/sdk.ts` | Legacy enqueue is bounded and is not automatically replayed. Its production-disable guard is unchanged; no inference settings or job/accounting rules were changed. |

The existing `operation-timeout.ts` remains for database waits. Redis no longer relies on a response-only wrapper that leaves an offline Redis backlog running. No dependency, lockfile, credential, migration or configuration variable was added.

## Verification and practical limits

| Test | Result |
|---|---|
| Initial reproductions | **75/80 passed** before implementation; silent handshake and stalled-command cases for both admission paths exceeded the watchdog, and the malformed concurrency reply was accepted. Evidence: `runtime/launch-evidence/redis-request-bounds-2026-10-18/before.txt`. Five failures are not five separate exploitable vulnerabilities. |
| Final boundary suite | **84/84 passed**, including all preceding auth/session/authorization/JWT/upload/Origin/outbound and atomic-counter cases. A connection crossing a window boundary consumes the new rate-limit bucket, preserving the previous after-connect clock policy. Existing launch CI runs this suite. |
| Native client/transport | Real node-redis against disposable loopback TCP peers: silent handshakes and stalled replies fail closed; established sockets close; only one failed command is sent, with no background reconnect/replay; a later request uses a new connection successfully. The watchdog is 4.5 seconds around the real three-second policy. Peers speak minimal RESP and do not claim to execute Redis Lua or emulate failover/TLS. |
| Deadline/generation faults | Synthetic delayed connect plus delayed command share one budget. A connection completing after expiry dispatches no application command. A late old-generation failure leaves the recovered generation usable. Shortened fixture timers cover these orderings; native cases separately exercise the real policy duration. |
| Capacity and error handling | The 257th pending operation rejects without disrupting 256 admitted operations; capacity becomes available afterwards. Falsy rejection values remain failures. Malformed lease replies cannot authorize GPU dispatch. |
| Actual Redis integration | Fresh password-protected loopback Redis container passed the existing three-tenant lease/reclamation tests and counter tests: 32 claims across two clients, expiry/orphan repair and real ACL failures, and 24 middleware requests admitting five/rejecting 19. Image `sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`; the container was removed. This is healthy-service integration, separate from the synthetic native transport faults. |
| Compiler and launch checks | API TypeScript and full launch-readiness suite passed after updating consumers and source contracts. Existing workflows exercise the new cases; no weaker or duplicate CI gate was added. |

The first integration compiler run identified the metrics consumer still expecting a raw client; it was corrected to the bounded-read adapter. The first source-contract run still expected per-file socket handlers; those assertions now verify the shared handler and each consumer's use of it. Neither failed preliminary check was reported as verification success.

Logs and the committed-file/CI verification record are retained under ignored `runtime/launch-evidence/redis-request-bounds-2026-10-18/`. Local transport fixtures override the Redis URL to their own ephemeral `127.0.0.1` listener and never connect to operator Redis. The disposable real Redis suite separately requires its existing explicit loopback/disposable approval guard. Prior successful CI is not evidence for this later patch; verify its exact commit.

## Deployment and remaining evidence

A command already sent to Redis may have taken effect before its reply is lost; disconnecting does not roll it back. A timed-out rate-limit request is not admitted. An uncertain lease is not returned to the caller and may remain until its existing expiry/reclamation. Failed release remains bounded and relies on lease expiry. An uncertain legacy enqueue must be reconciled through its job/usage state, never blindly retried. This work does not certify exactly-once queue dispatch, change legacy billing reconciliation or enable legacy production traffic.

OS-level DNS resolution is not proven cancellable by this application wrapper. Late application dispatch is guarded and late connected transports are disposed, but resolver/thread-pool behavior, actual TLS/ACLs, Redis eviction/failover, process loss, sustained bursts, clock skew and ingress buffering require live drills. The pending-request cap is per client purpose, not a complete host/connection admission limit. Database waits/cancellation, real monitoring delivery and GPU lease validity throughout real jobs still require their own evidence.

No Standard CatVTON weights, inference code/settings, scoring or worker capacity changed. Protected profile SHA-256 remains `b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`; all original 22 launch gates remain required. Four simultaneous independently scored >=0.95/no-warning outputs with visual/reference review, latency/headroom/isolation/soak, live staging/security/drills, AI dependency/OpenSSL remediation review, independent penetration testing, legal/model-rights and pilot/founder approval remain open.

Library behavior was checked against the installed 4.7.1 code/types and its [versioned client configuration](https://github.com/redis/node-redis/blob/redis%404.7.1/docs/client-configuration.md) and [FAQ](https://github.com/redis/node-redis/blob/redis%404.7.1/docs/FAQ.md). These references explain offline queuing/reconnection; the tests above supply application-specific evidence.
