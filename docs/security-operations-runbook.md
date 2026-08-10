# DrapixAI security operations runbook

This runbook applies to public production. Every action needs an incident or change ticket, named operator, second-person approval, timestamps, affected environment, release commit, and redacted evidence location. Never paste credentials or shopper images into tickets.

## Key rotation

1. Create a new secret-manager version. Do not edit a host `.env` file.
2. Test the new version in sandbox, then staging.
3. For storefront/public-token signing, set the new `DRAPIXAI_STOREFRONT_TOKEN_SECRET` and temporarily retain the old value in `DRAPIXAI_STOREFRONT_TOKEN_PREVIOUS_SECRETS`.
4. Deploy and wait at least 20 minutes, exceeding the longest 15-minute public token lifetime. Remove the previous signing secret and deploy again.
5. For webhook encryption, set a new `DRAPIXAI_WEBHOOK_ENCRYPTION_KEY` and put the old key in `DRAPIXAI_WEBHOOK_PREVIOUS_ENCRYPTION_KEYS`.
6. Deploy, then run `DRAPIXAI_KEY_ROTATION_APPROVAL=I_APPROVE_WEBHOOK_KEY_ROTATION npm --prefix apps/api run security:webhooks:rotate-key`.
7. Deliver a signed staging webhook, verify it, then remove the previous webhook key.
8. For the audit key, set the new current value and retain the old value in `DRAPIXAI_AUDIT_LOG_PREVIOUS_SECRETS`. Run `npm --prefix apps/api run security:audit:verify` before and after. Keep old audit verification keys in the restricted archive for as long as their audit records are retained.
9. Revoke server/API keys in the database before notifying a customer of a credential replacement. Short-lived SDK/API tokens then expire naturally.
10. Rotate database, Redis, S3, SMTP, Shopify, AI service, metrics, VPN, and origin credentials independently. Verify readiness and one real Standard try-on after each dependency boundary.

Emergency rotation skips normal notice but not evidence, staging where feasible, or post-change verification.

## Breach response

1. Page the incident commander and security owner. Record the discovery time and preserve logs.
2. Disable affected API keys or tenant access. If scope is unknown, stop public intake at Cloudflare while preserving health and internal evidence access.
3. Revoke active credentials and rotate secrets using the sequence above. Remove compromised VPN devices and machine identities.
4. Snapshot logs, immutable audit rows, WAF events, database activity, object access, Redis activity, queue state, and deployed image digests. Do not modify original evidence.
5. Determine affected tenants, shopper images, fields, time window, and exfiltration likelihood.
6. Eradicate the entry point, patch, rebuild from trusted images, and restore only verified data.
7. Run tenant-isolation, replay, upload, authorization, dependency, image, and external penetration retests.
8. Notify customers and regulators according to counsel-approved timelines. Do not claim no data loss without evidence.
9. Publish an internal root-cause report with corrective owners and deadlines.

## Backup and restore

1. Production migrations must use `deploy/scripts/migrate-with-evidence.sh`. The script creates a custom-format PostgreSQL backup, verifies its catalog, hashes it, records migration status, and points to the guarded restore command.

   Before a migration, the release operator must set `DRAPIXAI_EXPECTED_DATABASE_NAME` to the exact database name returned by `SELECT current_database()` and set `DRAPIXAI_CHANGE_APPROVAL_ID` to the approved change record. The script connects first and stops before a backup or schema change if the identity differs.
2. Store backups encrypted outside the application host and production account failure domain. Restrict restore permission more tightly than backup creation.
3. Quarterly, restore the newest backup into an isolated recovery environment with `deploy/scripts/restore-postgres-backup.sh`.

   Set `DRAPIXAI_EXPECTED_DATABASE_NAME` to the isolated recovery database, `DRAPIXAI_RESTORE_APPROVAL_ID` to the incident/recovery approval record, and the environment-specific destructive confirmation. The restore tool checks the live database identity before issuing `pg_restore --clean`.
4. Verify Prisma migration status, audit-chain validity, tenant counts, object references, login, product cache state, and a Standard try-on.
5. Record recovery point objective and measured recovery time. A backup that has not passed restore testing is not launch evidence.

## Cache retention

1. Garment cache reads enforce `DRAPIXAI_GARMENT_CACHE_TTL` against the physical local or S3 asset, not only the Redis pointer. An expired asset is never returned.
2. The AI API runs the bounded purge loop set by `DRAPIXAI_GARMENT_CACHE_PURGE_INTERVAL_SECONDS` and `DRAPIXAI_GARMENT_CACHE_PURGE_LIMIT`. Keep the interval at six hours or less and alert on purge failures.
3. For S3, configure a matching bucket lifecycle expiration rule as a second independent cleanup layer. Cache data must remain private, encrypted, tenant-namespaced, and unavailable through public URLs.

## Customer deletion

1. Authenticate the requester and verify tenant ownership. Freeze the tenant and revoke all API/storefront keys.
2. Export the legally required account record and billing evidence to the restricted compliance store.
3. Enumerate tenant object keys for person inputs, garment review copies, results, caches, and generated catalogs. Delete shopper/person images first.
4. Delete or redact tenant database records in dependency order. Shopify requests must run through the signed `customers/redact`, `shop/redact`, and `customers/data_request` handlers.
5. Remove tenant Redis keys, pending jobs, webhook deliveries, object versions, CDN cache entries, sandbox fixtures, and search/analytics copies.
6. Backups age out under the documented backup retention schedule and must not be restored into active service without replaying deletion tombstones.
7. Append an immutable audit event containing only tenant ID, request ID, completion state, and counts. Do not retain deleted personal fields in the audit metadata.
8. Have a second operator verify database, storage, queue, and API lookup absence before closing the request.

## Alert response

- Authentication spike: inspect WAF and API source patterns, block abusive sources at Cloudflare, and check whether a specific key or tenant is targeted.
- Rate-limit spike: distinguish attack traffic from a broken brand integration before raising limits.
- GPU queue warning: confirm worker health and tenant fairness. Do not increase concurrency until VRAM and realism tests pass.
- Webhook backlog: inspect endpoint status and SSRF-safe delivery errors; never disable signature verification to clear the queue.
- Readiness failure: remove the replica from traffic and diagnose the private dependency, not the public edge.

Prometheus rules live in `deploy/monitoring/drapixai-alerts.yml`. Route warnings to operations and critical events to a 24/7 paging destination, then test every route quarterly.
