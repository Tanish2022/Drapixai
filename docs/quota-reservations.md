# Durable account quota admission

The previous SDK check read monthly usage before inference and incremented it
afterward. A GPU concurrency slot did not protect the quota check: multiple
requests could see the same final quota unit. Legacy render admission had the
same check-then-increment gap.

## Behavior

`UsageReservation` records request UUID, account/key IDs, request kind, admission
period/time, quota, dispatch/settlement timestamps and result/job metadata IDs.
It contains no images, URLs, credentials or serialized request bodies.

- A short PostgreSQL transaction locks account usage, rereads the active key and
  plan, and checks completed usage plus all reserved work in that billing period.
  Every key/API replica for the same account shares that lock. No transaction
  spans an AI, object-store or Redis request.
- Dispatch is recorded before the external call. A second dispatch of the same
  reservation is refused. Failure before dispatch releases the reservation;
  failure after dispatch keeps it reserved because remote work may still exist.
- Standard result creation, monthly/daily/period counters and settlement commit
  together with a chained immutable audit event. Generated results charge once.
  Quality-rejected results retain only
  the existing metadata and release quota without charging. Concurrent settlement
  retries return the original result. Shopper/result-image URLs are refused.
- Settlement uses the admission period, including across renewal. Revoked keys
  retain historical usage and existing work; they cannot admit new work. Legacy
  render preserves its existing charge-on-accepted-queue behavior and remains
  disabled by default.
- A reservation never expires just because time passed. Redis capacity-lease
  expiry cannot erase a quota hold. Unknown dispatch outcomes fail closed.

The dashboard/SDK report `quotaReserved` separately from `rendersUsed` and subtract
both from `quotaRemaining`. `/v1/usage` adds `reserved_tryons` and subtracts it from
`remaining`. Completed usage remains distinct from work awaiting confirmation.
These are reporting snapshots; admission always performs its own fresh check.

Storefront redaction revokes/expires the key, clears its domain/label/scopes and
deletes the installation. It preserves the key's accounting identity so an
unsettled hold cannot disappear. A database foreign key also prevents deleting
keys with reservation history. Retention/erasure of financial and reservation
metadata requires the qualified retention policy; no indefinite legal retention
approval is implied by this implementation.

## Verification scope

The guarded disposable PostgreSQL billing fixture verifies twelve contenders
across two Prisma connections and two keys with exactly one quota unit available.
Only one reservation succeeds. It also verifies stale holds, one result/charge
under six concurrent settlement attempts, pre-dispatch release, rejection without
charge, old-period retries after rollover, tenant/key mismatch rejection, revoked
credentials, inactive plans and exactly-once legacy settlement.

A test-only PostgreSQL trigger forces failure after the result insert and first
counter write. The whole result/counter/settlement transaction rolls back; removing
the trigger permits a successful single retry. A real storefront-redaction fixture
proves access is removed while the pending reservation survives. All fixtures use
synthetic metadata, with no real AI, payment provider or merchant data.

A second insertion-failure trigger proves that an audit failure also rolls back
the result, counters and settlement. Concurrent audit appends from two connections
preserve one valid immutable chain. Account and chain locks use non-blocking
`pg_try_advisory_xact_lock`; bounded retries run only after rollback. This avoids
pool starvation observed with blocking audit-lock queries. Audit transactions
use READ COMMITTED plus the exclusive chain lock to read the latest predecessor.
The existing hash format and database mutation-protection triggers are unchanged.

Run `npm --prefix apps/api run test:billing-database` only with the explicitly
approved, loopback, disposable PostgreSQL target described in the billing runbook.
CI applies all migrations before running it. Local CPU checks passed against a
fresh PostgreSQL 16 container, which was removed after the test.

These checks do not certify a live deployment, provider billing, GPU quality,
latency, API-response failure recovery, or every operator drill. The Standard
profile, models, masks, scoring, candidate count and worker batch cap are unchanged.

## Rollout and outstanding operational work

1. Disable inference intake and drain/stop all old API replicas before migration.
   Old code ignores reservations and must not serve mixed traffic with new code.
2. Apply `20261017000000_quota_reservations` with the migration identity, then
   deploy the exact tested API images. Runtime roles require ordinary table
   access and the existing database advisory-lock ability, not DDL privileges.
3. Verify fresh admission, settlement, reporting and revocation against live
   synthetic tenants. Keep intake disabled until the rest of launch certification
   passes. Do not apply migrations to the developer's existing data as a test.
4. Monitor reserved work separately from completed usage. Recovery of a crash
   before dispatch must atomically prevent a later dispatch before releasing it.
   Dispatched work requires authoritative terminal job/result evidence and an
   audited reconciliation decision. Age or HTTP timeout alone is insufficient.
5. Complete and drill the operator recovery workflow, alert delivery and metadata
   retention policy before closing billing/failure-containment gates. Automatic
   reconciliation and a governed operator recovery command are still outstanding.

Rollback must keep intake disabled until old/new job and reservation state is
reconciled. Do not drop the reservation table or erase holds to make an old API
appear compatible. Rehearse the exact deployment and rollback on live staging.
