# DrapixAI Email Operations

## Two isolated mail systems

DrapixAI uses separate infrastructure, credentials, sender identities, data, and operating rules for transactional email and brand outreach.

| Concern | Transactional email | Brand outreach |
| --- | --- | --- |
| Purpose | OTPs, password recovery, welcome, garment decisions, trial reminders | Individually reviewed partnership and pilot invitations |
| Suggested sender | `no-reply@mail.drapixai.com` | `partnerships@sales.drapixai.com` |
| Reply address | `support@drapixai.com` | `sales@drapixai.com` |
| Credentials | `SMTP_*` | `OUTREACH_SMTP_*` |
| Recipient source | Existing DrapixAI account or requested security action | Manually reviewed public business contact with a recorded source |
| Unsubscribe | Not added to essential security messages | Required visible opt-out and suppression check |
| Tracking | No tracking pixels | No tracking pixels by default |
| Failure behavior | Account and try-on state remain authoritative | Failed recipients are logged by hash and must be reviewed before retry |

Never reuse the transactional SMTP credential, sender domain, recipient list, or delivery reputation for outreach.

## Domain and DNS setup

Create two provider-verified sending subdomains:

1. `mail.drapixai.com` for OTPs and other operational account email.
2. `sales.drapixai.com` for reviewed business outreach.

For each subdomain, publish the SPF, DKIM, verification, and return-path records supplied by the selected email provider. Configure DMARC reporting for both mail streams, review alignment reports, and move toward quarantine or reject only after legitimate senders are confirmed. Do not invent DNS values or combine SPF records; use the exact records provided for each selected service. Configure the real support and sales reply inboxes before sending.

Provider credentials belong in the production secret manager. They must not be committed to Git, copied into frontend environment variables, placed in a RunPod setup transcript, or shared between staging and production.

## Transactional email

Configuration:

```text
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM="DrapixAI <no-reply@mail.drapixai.com>"
SMTP_REPLY_TO=support@drapixai.com
EMAIL_PUBLIC_BASE_URL=https://drapixai.com
EMAIL_BRAND_LOGO_URL=https://drapixai.com/drapixai_wordmark.webp
EMAIL_SUPPORT_ADDRESS=support@drapixai.com
```

Current transactional templates:

- Sign-up verification code
- Password-reset verification code
- Current/new email verification
- Workspace welcome
- Garment approved or held for review
- Trial ending reminder

Each template includes HTML and plain text, uses the canonical DrapixAI wordmark, escapes dynamic content, contains no scripts, and does not include tracking pixels. Authentication and account creation do not depend on a marketing system.

Test without sending:

```powershell
npm --prefix apps/api run test:email-templates
```

Render representative HTML previews with synthetic data:

```powershell
npm --prefix apps/api run email:previews
```

The generated files are written under `runtime/email-previews` and must not be populated with real recipient or customer data.

Send one controlled production SMTP test only to an existing DrapixAI account:

```powershell
npm --prefix apps/api run email:send-test:dist -- --to=existing-account@example.com
```

## Brand outreach

The source file is `marketing/brand-leads-template.csv`. A row is eligible only when all of these fields are complete:

- `brand_name`
- `contact_email` containing a valid business address
- `contact_role`
- `source_url` recording where the public business contact was found
- `approved_to_contact=yes` after manual review
- `unsubscribed=no`
- `template_key=pilot` or `template_key=shopify`

The sender rejects missing sources, missing roles, unapproved rows, duplicate addresses, invalid emails, and addresses in `marketing/outreach-suppression.csv`.

The safe operating sequence is:

1. Research the brand and record the public source URL.
2. Add a specific relevance note; do not send generic scraped copy.
3. Confirm that the address is a business contact appropriate for partnership outreach.
4. Mark only reviewed rows `approved_to_contact=yes`.
5. Run a dry preview and read every message.
6. Add every opt-out immediately to the suppression CSV.
7. Start with a small batch and monitor replies, bounces, and complaints manually.

Preview only:

```powershell
$env:OUTREACH_DRY_RUN='true'
npm --prefix apps/api run email:outreach:preview
```

Live sending remains locked until the operator sets all outreach SMTP variables, the registered business address, and this explicit confirmation:

```text
OUTREACH_CONFIRM_SEND=I_HAVE_REVIEWED_EACH_RECIPIENT
```

The sender caps a live batch at 50, defaults to 10, pauses between recipients, redacts email addresses in console output, and writes only a recipient hash to the runtime delivery log. This is a safety ceiling, not a recommendation to send 50 messages at once.

## Suppression handling

When anyone opts out:

1. Add the normalized email address to `marketing/outreach-suppression.csv`.
2. Set `unsubscribed=yes` on any matching lead row.
3. Do not remove the suppression record merely because a campaign changes.
4. If a recipient asks for broader data deletion, route the request through the DrapixAI privacy/customer-deletion procedure.

## Launch gate

Before production email is enabled, verify:

- Provider domain verification succeeds for both subdomains.
- SPF, DKIM, and DMARC alignment passes for test messages.
- Support, sales, and privacy inboxes accept replies.
- OTP, password reset, welcome, garment decision, and trial templates render correctly in major desktop and mobile email clients.
- Outreach dry-run output has been reviewed by a founder.
- The registered business address is present in live outreach.
- Suppression entries block sending.
- SMTP secrets are stored in the production secret manager and rotation is documented.
- A legal adviser reviews the final outreach process and copy for the jurisdictions being contacted.
