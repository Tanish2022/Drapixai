# Outbound request containment — 17 October 2026

Scope: work packages 5 and 8, with regression evidence for package 2. **Implemented and locally verified; live application/operational gates remain open.** No inference settings, model dependencies or public-launch decisions are changed.

## Verified gaps

The previous `apps/api/src/lib/remote-fetch.ts` used socket inactivity timeouts. Catalog-feed retrieval, store ownership verification, remote garment-cache preparation and webhook delivery all use this helper. A destination sending occasional bytes could extend a response indefinitely. DNS resolution occurred before any timeout. Rejected redirects were drained without a body/time bound. These are medium-severity resource-containment weaknesses requiring an outbound operation to a controlled or slow destination, not a demonstrated breach of a deployed service.

The empty-response tests also identified that constructing a Fetch `Response` from a zero-length Buffer for HTTP 204/205 throws inside the stream-end handler. Those responses now use a null body, and response-construction errors reject through the promise instead of escaping that event handler. No production process was intentionally crashed.

## Remediation

- A single validated deadline covers DNS waiting, connection/TLS, upload and complete response reception. Its `AbortSignal` reaches the real Node `ClientRequest`. Timeout errors retain the existing `REMOTE_FETCH_TIMEOUT` code.
- A DNS answer arriving after expiration cannot start a late connection. Rejected redirects, excessive responses and response-construction failures also abort the request, closing its transport.
- The old socket inactivity timers are removed; there is one total-time budget. Defaults remain 8,000 milliseconds, and caller-specific time/byte limits retain their numeric values. A caller's `timeoutMs` now limits the whole operation rather than only socket inactivity. Slow integrations may time out sooner, as intended.
- Noninteger, nonpositive, nonfinite or overflowing time limits and invalid byte limits fail before DNS/transport with `REMOTE_FETCH_LIMITS_INVALID`. Zero no longer silently falls back to a larger default.
- Existing HTTPS policy, private-address rejection, all-answer DNS validation, connection pinning, byte caps and redirect rejection remain. Webhook signatures, payloads, attempt counts and retry/backoff rules are unchanged; the new service test confirms that a DNS timeout reaches the existing retry path.

No new runtime dependencies or parallel timeout service was added. `withOperationTimeout` elsewhere does not cancel operations and is not used as a substitute for transport cancellation.

## Verification

| Check | Result and scope |
|---|---|
| Exact baseline negative control | The actual `013b1199e0d3854369b26d8641b96068c47bbb4e` outbound module was substituted **in memory**, leaving source files intact. It passed 30/40 and failed the ten new negative/compatibility cases as expected. The bounded fixture shut down correctly. Output: `runtime/launch-evidence/outbound-containment-2026-10-17/baseline-boundaries.txt`. |
| Fixed security suite | **40/40 passed**. Existing OAuth/MFA, authorization, JWT, upload, Origin, rate-limit and SSRF cases remain, alongside ten new cases for deadline, cleanup, response compatibility and retry behavior plus a normal POST positive control. |
| Slow response | Synthetic GET and POST streams continue sending bytes inside the old inactivity window. The total deadline rejects and closes the transport. |
| DNS | Never-settling lookup returns a timeout; a delayed answer cannot initiate any late connection. |
| Native Node HTTP | A disposable loopback server and real `ClientRequest`/`IncomingMessage` verify slow GET/POST socket closure, redirect socket closure and successful ordinary POST. Only the transport adapter maps the synthetic public test hostname to that loopback server. This does not test public DNS or TLS certificates. |
| Empty responses | HTTP 204 and 205 return the correct status and empty text without an event-handler exception. |
| Retry integration | Real `processPendingWebhookDeliveries` code with synthetic delivery/database/DNS adapters records `retrying`, attempt count 1, timeout error, null response code and a future retry time. It does not mark the failed delivery delivered. The fixture shortens timers; it is not a provider delivery test. |
| Compiler and launch contracts | API `tsc --noEmit` and the complete launch-readiness suite passed. The existing Linux CI entry point already invokes this security suite. |

The native fixtures use only ephemeral `127.0.0.1` listeners; all network tests use synthetic bytes. No external target, customer database, merchant endpoint or GPU was exercised. Fixture safety timers prevent the old implementation from hanging verification indefinitely.

## Remaining limits and release boundary

`dns.lookup` does not provide cancellation of the underlying operating-system resolver call. The application wait is bounded and late results are discarded, but resolver configuration, thread-pool pressure and production DNS behavior still require infrastructure validation. Timers cannot preempt a blocked Node event loop. Incoming slow uploads, reverse-proxy buffering, aggregate workload limits and webhook-worker scheduling still need their own controls and live evidence; this fix does not establish DDoS capacity or end-to-end customer-journey completion.

Hosted CI for baseline `013b119` passed application, secret and edge container checks, while the Accelerate audit remained blocking; see [the verified CI reliability record](ci-verification-reliability-2026-10-17.md). That baseline does not certify this later source change. Record the new exact commit's hosted results separately.

The protected Standard CatVTON profile remains SHA-256 `b732cd2b227a34a9bdfb65ff08cbacb3abd87846be589ba1a58e98199a012762`. The original 22 launch gates, four-output independent >=0.95/no-warning/visual-review requirement, GPU headroom/latency/isolation, commercial model rights, qualified legal review, independent penetration testing, live staging and pilot/founder approval remain mandatory.
