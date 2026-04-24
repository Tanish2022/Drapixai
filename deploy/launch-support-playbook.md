# DrapixAI Launch Support Playbook

## Launch Goal
- Support a controlled public launch for the current DrapixAI scope.
- Scope is upper-body try-on only.
- Treat the first launch as monitored rollout, not a "fully hands-off" SaaS release.

## Go-Live Preconditions
- A100 deployment passes `/health` and `/ready`.
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
  - A100 health is unstable
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
