# Disposable billing verification

The billing database fixture previously cleaned up all users whose email began
with `billing-db-`, without requiring an approved disposable target. It was not
executed by the launch CI workflow. That combination risked deleting another
test run's fixtures and left the real-database accounting checks unverified.

The fixture now validates an explicit loopback PostgreSQL URL, a test/P0/
disposable database name and the disposable-database acknowledgment before
constructing Prisma. It rejects endpoint-changing query options and explicitly
passes the validated URL to Prisma. Missing or invalid input fails with a fixed
message without exposing credentials. There is no application `.env` fallback.

Cleanup uses only IDs created by this run, including partial failures, and only
deletes the webhook event after this run successfully created it. A synthetic
neighbor fixture with the old shared email prefix verifies that cleanup preserves
records outside the run's ID list. Cleanup still disconnects if deletion fails.

Eight refusal regressions cover missing URL/approval, ordinary application and
remote databases, malformed URLs, wrong protocols, endpoint query overrides and
encoded path separators. Local refusal checks passed without connecting to any
database. The real database fixture is now required in CI against its disposable
PostgreSQL service, following migrations. Its positive cases verify:

- exact subscription-period rollover;
- 16 concurrent increments across two keys without lost account usage;
- revoked-key historical usage remains counted;
- duplicate webhook event and provider-customer uniqueness constraints;
- cleanup preserves the neighboring fixture.

The original 22 release gates are unchanged. This fixture does not establish
provider webhook processing/replay behavior, payment/refund execution, quota
reservation at a concurrent limit, production migrations, tax approval, real-job
charging or live staging readiness. Those requirements remain open. No payment
provider is contacted and no billing or Standard inference behavior changes.

## Quota admission remains open

Source inspection also confirms a gap that these increment tests cannot close:
`/sdk/tryon` reads monthly usage before acquiring the GPU slot, releases the slot
after the upstream fetch, and increments usage later. Two requests may both read
the remaining quota before either records its usage, even with a one-request
tenant slot. The legacy render path also checks then increments separately.
The Redis slot limits inference concurrency; it is not an atomic quota reservation.

The next accounting change needs durable, account-wide admission and exactly-once
completion/release semantics, covering multiple keys/API replicas, period rollover,
quality rejection, worker/API failure and retry reconciliation. Verify those
state transitions in disposable database tests and the live job journey. Do not
mark quota correctness complete because concurrent counter increments pass, or
hold a database transaction open across GPU inference to hide this race.
