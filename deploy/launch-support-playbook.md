# DrapixAI Launch Support Playbook

## Launch Goal
- Support a controlled public launch for the current DrapixAI scope.
- Scope is upper-body try-on only.
- Treat the first launch as monitored rollout, not a "fully hands-off" SaaS release.

## Go-Live Preconditions
- RTX PRO 6000 production runtime passes `/health` and `/ready` through the private API path.
- One real staging try-on completes end to end.
- Signup, OTP, login, dashboard, settings, subscription, garment sync, upload, and SDK flow are verified.
- Support inboxes are reachable:
  - `support@drapixai.com`
  - `sales@drapixai.com`
  - `privacy@drapixai.com`

## Daily Launch Checks
- Web app responds and loads core pages.
- API health endpoint responds.
- AI service is reachable and model-ready.
- Redis is reachable.
- Storage bucket is reachable.
- One dashboard try-on test passes.
- One storefront SDK try-on test passes.

## Runtime safeguards

- Budget the API database connections per replica. The shared Prisma pool defaults to four connections and a ten-second pool wait. Count each API process and reserve capacity for migrations and operator access. Verify the total under target staging load.
- Use `DRAPIXAI_ADMIN_BOOTSTRAP_ENABLED=1` only for initial setup with the mounted administrator secret. The first successful run seals bootstrap in the database. After verifying administrator login and MFA, remove the bootstrap flag and password from runtime configuration. Rotate or offboard administrators through the audited account procedure.
- Set delivery retention only after the operator approves the retention window. `DRAPIXAI_EMAIL_LOG_RETENTION_DAYS` and `DRAPIXAI_WEBHOOK_DELIVERY_RETENTION_DAYS` default to zero. Enabled jobs delete bounded batches of expired email logs and delivered or disabled webhook records. Failed and pending webhook deliveries remain available for reconciliation. Billing records require a separate retention policy.
- Drain old webhook workers when deploying attempt fencing. Delivery can still repeat if a recipient accepted a request before a worker lost its claim. Recipients can deduplicate using `DrapixAI-Event-Id`.
- For an unresolved Stripe checkout, reconcile the tenant and original attempt with Stripe before releasing the claim. A missing response can mean Stripe created the session. A session marked expired by Stripe can be closed locally; a completed session requires subscription reconciliation.
- Apply the reviewed billing migration before releasing the API that binds signed Stripe event data and records period starts. Current subscriptions with inferred starts keep their accounting window through renewal so existing charges and reservations stay visible.

## Workstation or site outage

Pause try-on intake at the reachable edge. Keep it paused through restart and rollback. Reconcile active work and subscription reservations before reopening. Record the outage start, restore start, newest verified recovered record, and recovery time.

Use an approved off-host recovery target with separate access credentials and verified encrypted backups. Rehearse CPU recovery first, then validate the replacement GPU, private services, retention and Standard quality before reopening inference. A restart on the original workstation cannot establish recovery from site loss.

## Incoming Support Triage

### P0
- Signup/login is failing for multiple users.
- AI service or API is down.
- No try-on jobs are completing.
- Data loss or security incident.

### P1
- Specific account cannot verify domain.
- Product ID mapping is failing.
- Garment upload or cache generation is failing.
- Download/share output is broken.

### P2
- Pricing questions.
- Trial extension requests.
- Integration guidance questions.
- Styling or UX feedback.

## First Response Checklist
- Capture account email or brand name.
- Capture affected domain.
- Capture product ID or garment ID.
- Capture exact failing step.
- Capture screenshot or raw error.
- Confirm whether the issue happened in demo, staging, or production.

## Rollback / Pause Criteria
- Pause public launch traffic if:
  - primary GPU runtime health is unstable
  - more than one end-to-end try-on path is broken
  - signup or login is unreliable
  - garment caching fails for new uploads

## Launch Messaging
- Do not promise full-body support.
- Do not imply self-serve billing is live unless it is actually wired and tested.
- Position DrapixAI as:
  - AI virtual try-on for fashion ecommerce
  - starting with upper-body garments

## Founder Priority During Launch Week
1. Keep AI path stable.
2. Keep signup-to-result flow working.
3. Respond to integration blockers quickly.
4. Log every repeated failure pattern.
5. Avoid building non-critical features during rollout.
