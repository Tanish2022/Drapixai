# DrapixAI Email Operations

## Follow-on Task 4, 31 October 2026

The current assessment (operational evidence retained privately) records
fresh DNS, bounded consumer inventory and zero-message TLS authentication for
both existing encrypted SMTP stores. Signed callbacks, durable replay handling,
recipient suppression, metadata retention and monitoring are locally verified
but **disabled by default and not deployed**. No live migration, key retirement,
DNS/provider change or new email was performed. The owner subsequently signed
in; fresh Resend review (operational evidence retained privately) confirms
MFA, key scopes, domain TLS/region and no registered webhooks. Zoho observations
below remain dated historical evidence until separately refreshed.
Use the activation and incident runbook (operational evidence retained privately).

## Security follow-up, 23 October 2026

The email security assessment (operational evidence retained privately) records
fresh read-only Zoho/Resend and public-DNS checks. Both Zoho users and the Resend
owner have MFA enabled; mandatory organization-wide Zoho MFA is off. Both
mailbox-level forwarding panels remain empty. Transactional Resend TLS is
Enforced, but its sales/marketing sending subdomains still use Opportunistic
TLS. Four checked public DKIM keys are 1024-bit; stronger-key rollover, policy
tuning, historical-key cutover, inbound TLS policy and monitoring remain open.

Subsequent owner-authorized follow-up: organization-wide Zoho MFA was enabled
and verified after reloading. The line above records the initial audit state.
The rotation record (operational evidence retained privately) tracks the separate
replacement key, local consumer inventory and tested private installer.
The owner created and installed the replacement privately. Resend metadata
confirms Sending access only for mail.drapixai.com; the installed credential
passed certificate-verified SMTP authentication with zero messages. The
historical key remains active pending consumer mapping and application cutover.

A verified dependency issue was fixed locally: Nodemailer 10.1.1 reproduced the
three vendor address-confusion advisories patched in 10.1.4. API package/lock
now pin 10.1.4. Three actual parser regressions, normal parsing, the expanded
application-recipient guard, 14 delivery groups, API type-check and full local
launch regression passed. The existing bare-recipient guard already refused
those complex inputs; this is not evidence of an exploited app flow. Fresh
encrypted-store SMTP authentication passed with zero messages sent. No DNS,
provider policy, credential or production deployment changed during this review.

## Step 3 application email work, 22 October 2026

The existing Nodemailer transport is retained. Application SMTP now requires
TLS, certificate verification and TLS 1.2 or later, with bounded connection,
greeting, DNS and socket timeouts. Port 587 uses mandatory STARTTLS; port 465
uses implicit TLS. Invalid credential/port/security combinations fail production
startup. Message logging, file access and URL-content fetching are disabled.
These controls follow the [Nodemailer SMTP documentation](https://nodemailer.com/smtp)
and [Resend SMTP settings](https://resend.com/docs/send-with-smtp).

Account messages accept only one bare recipient. SMTP acceptance is checked
against that recipient; a missing, rejected or mismatched receipt cannot report
success. `EmailLog.status=sent` means accepted by the SMTP server, not delivered
to the inbox. Bounces and downstream delivery still need provider evidence.

SMTP acceptance and database logging are now separate outcomes. A log failure
after acceptance returns `sent: true` with `logError: EMAIL_LOG_WRITE_FAILED`,
without a second send or a contradictory failed-log write. Failed SMTP attempts
use an allowlist of stable error codes rather than provider messages or error
names. Sanitized operational warnings contain no address, OTP, body or secret.
The helper performs no automatic resend. Timeout/unknown-acceptance cases need
operator reconciliation; this is not an invoice outbox or exactly-once guarantee.

Signup and authenticated email-change requests now return a temporary 503 error
if required messages are not accepted. A log-only failure after acceptance does
not become an account-email error. Public password recovery retains its generic
response to avoid revealing account existence. Existing no-SMTP development OTP
behavior remains available outside production only.

Local verification:

- API TypeScript check passed.
- All nine transactional template variants passed content/escaping checks.
- `npm --prefix apps/api run test:email-delivery` passed 14 groups, including
  authentication/timeout/rejection adapters, log outages, actual signup and
  account route handlers with synthetic dependencies, and real Nodemailer
  refusing a loopback server without TLS before sending AUTH, MAIL or DATA.
- The loopback test initially returned `ESOCKET` in the restricted sandbox;
  the same unweakened fixture passed with permitted local networking.
- The launch-readiness suite passed after the final account-route changes,
  including 95/95 security-boundary and 21/21 password-security cases. These
  are repository/fixture checks, not deployed application acceptance.

No live application email, customer mail, invoice or new production deployment
was sent during this implementation. No real credential was installed or
revoked. The existing historical Resend key remains unchanged. Docker's local
Linux engine was unavailable, so real PostgreSQL/Express staging journeys were
not run here. Synthetic route adapters do not establish those journeys.

The authenticated Resend API-key list still contained one historical sending
key. A separate key form was prepared, not submitted: name
`drapixai-cpu-staging-smtp`, Sending access, domain `mail.drapixai.com`.
Credential creation/reveal/save was handed to the owner under browser credential
rules. Do not read the reveal page or screenshot it. The owner confirmed this
complete. A subsequent metadata-only review verified key ID
`3c75593c-46d6-4342-b492-f7ec2de4a429`, the selected name, Sending access and
domain `mail.drapixai.com`, with zero uses. The historical key remained listed.
The key value was not read from the provider. At that review, restricted
installation and authentication were still unverified; the subsequent private
installation and authentication result is recorded below.

For this Windows laptop's CPU staging connection tests, the owner can run:

```powershell
& 'PRIVATE_WORKSPACE\deploy\scripts\staging-smtp-credential.ps1' -Action Install
```

The script requests the key using `Read-Host -AsSecureString`, rejects malformed
keys, and saves a Windows-user-DPAPI encrypted credential under
`%LOCALAPPDATA%\DrapixAI\secrets\cpu-staging-email\smtp.credential.xml`.
Directory and file access is limited to the current user and SYSTEM. Existing
credentials are not overwritten; OneDrive and reparse-point paths are refused.
The script never writes a plaintext key into the repository, env files or a
command argument. The key reaches the bounded Node probe only through stdin.
Windows encryption binds this file to its user/machine; keep the original key
in the owner's password manager for later controlled workstation provisioning.
This local store is not a portable Linux production secret manager.

After installation, the script tests certificate-verified SMTP authentication
against the fixed target `smtp.resend.com:465`. It sends no message and does not
start the API, access Neon, modify production configuration or claim app delivery.
`-Action Status` checks file metadata without decrypting; `-Action Verify`
repeats the authentication-only probe. A failed probe preserves the encrypted
file for investigation. Do not replace or delete it implicitly to retry.

The Windows installer passed four synthetic checks: DPAPI roundtrip/no plaintext
on disk, restricted ownership/ACLs, refusal to overwrite and rejection of widened
ACLs before decryption. The restricted sandbox cannot use the user-only ACL;
the same test passed outside that sandbox. Both disposable fixtures were removed.
The new Node probe's input validation, fixed TLS target, authentication-only
behavior and connection cleanup passed synthetic adapters, and the API type-check
passed.

After the owner reported private installation complete, the same `-Action Verify`
probe was run through the encrypted Windows store. It passed authentication to
`smtp.resend.com:465` with certificate-verified TLS and reported `messagesSent: 0`
and `applicationConnected: false`. The real key was used only within the private
processes, was not printed or written as plaintext, and was not installed into
the main application's env files. Existing production credentials were not
changed or revoked. This proves local storage access and SMTP authentication,
not delivery, Google Sheets syncing or a deployed app account journey.

Two additional application-sender template tests have been prepared in
`apps/api/src/scripts/send-staging-email-tests.ts`. The default command is a dry
run and reads no key. Each message is addressed only to the owner-approved Gmail
recipient, from `DrapixAI <no-reply@mail.drapixai.com>`, with Support Reply-To and
no CC/BCC or attachments. Subjects begin TEST ONLY and use IDs
`20261022-APP-SIGNUP-01` and `20261022-APP-RESET-01`; bodies explicitly state that
DEMO-CODE is unusable and no account action was requested or changed.

Sending requires separate owner approval for these two messages. The Windows
helper's `SendTests` action requires `-ConfirmTestEmails`; the Node sender also
requires the exact approved recipient argument. It calls the application email
service with no database user, so it does not query/update account records or
issue/consume actual OTPs. Provider idempotency keys and a permanent local
attempt journal prevent accidental repeated invocations on this host. An
ambiguous failure requires provider reconciliation; do not delete the journal
to blindly retry. The prepared plan passed the 14-group synthetic regression
and dry run.

The owner then explicitly approved both messages. The encrypted-credential
wrapper sent exactly those two examples through the application email service;
both were accepted. Scoped Gmail reads found both in INBOX: signup in Updates,
password-reset in Personal. Google's Authentication-Results show SPF, DKIM and
DMARC PASS, with aligned DKIM domain `mail.drapixai.com`, and Received headers
record TLS 1.3. Both use the selected account sender and Support Reply-To, with
no CC/BCC or attachments. Their Gmail IDs are `1a1645356ff15827` and
`1a164535ed1992b2`. Minimized evidence is
`runtime/launch-evidence/staging-application-email-gmail-20261022.json`.
This verifies the controlled app transport/template delivery, not signup/reset
database journeys, actual OTP validation or ongoing deliverability. No further
send is authorized by this completed two-message test.

Remaining live acceptance depends on an isolated CPU environment and database
(Tasks 4/7), a privately installed staging-only sending credential, approved
controlled recipients, actual verification/recovery journeys, provider delivery
and bounce/failure evidence, and monitoring ownership. Additional test messages
are not covered by the earlier single billing-sender test approval. Step 3
remains open until this evidence exists. Invoice generation and database-to-
Google-Sheets synchronization remain separate Tasks 12/reporting work.

## Two isolated mail systems

DrapixAI requires separate infrastructure, credentials, sender identities, data, and operating rules for transactional email and brand outreach. Live delivery still requires verification.

### Owner's current website address, 21 October 2026

The owner selected **`support@drapixai.com`** for the website and retired
`contact@drapixai.com` from current public copy. Current pages, mailto links,
support-assistant responses and the 2026-10-21 terms use this address. The
2026-10-19 terms archive retains its original content and hash for prior assent.
Historical observations below describe earlier state, not the current choice.

Zoho currently has an owner admin user and a regular `feedback@drapixai.com`
user. The current public-user alias list contains `support@`, `sales@` and
`partnerships@`. The earlier `contact@` alias is no longer listed; the agent did
not delete it. `billing@`, `privacy@` and `security@` are listed on the admin
inbox. No mailbox, account or message was deleted by the agent following the
website address change.
The owner questioned the shared-inbox layout, so final mailbox separation
remains undecided. Zoho MX/SPF/DKIM records are now published and independently
visible at both the authoritative server and the normal resolver. Zoho's first
verification attempts reported propagation pending. Later checks below record
successful provider verification, signing and the two controlled delivery tests.

Follow-up, 22 October 2026: Zoho's domain console now confirms MX is pointed to
Zoho and SPF is successful. `zmail._domainkey` is **Verified**, with the DKIM
Status switch enabled. This supersedes the initial propagation status above.
Evidence: `runtime/launch-evidence/zoho-dkim-verified-20261022.jpg` and
`runtime/launch-evidence/zoho-spf-verified-20261022.jpg`. A verified console
setting does not prove delivered-message SPF/DKIM/DMARC alignment.

The owner privately signed in to `feedback@`, and both sender aliases were
verified in the actual From selector. The two approved test messages were sent
to the owner-controlled external recipient supplied in chat. Exactly that one
recipient was checked for each final draft, with no CC/BCC or attachments.
Zoho confirms **Delivered to recipient servers over TLS** for both:

| Sender | Test ID | Provider delivery time, India |
| --- | --- | --- |
| `support@drapixai.com` | `DRAPIXAI-MAIL-20261022-SUPPORT-01` | 22 October 2026, 02:44:47 |
| `sales@drapixai.com` | `DRAPIXAI-MAIL-20261022-SALES-01` | 22 October 2026, 02:46:08 |

Delivery screenshots and message IDs are retained in
`runtime/launch-evidence/zoho-provider-verification-20261022.json`.
After the owner replied, each received message was opened in Zoho: the expanded
headers identify the approved Gmail sender, correct `sales@` or `support@`
destination and TLS. Both bodies say “Test successful” and quote the original
test thread. Sales arrived at 02:47:50 and Support at 02:48:07, India time.

The connected Gmail profile matched the approved recipient. Reads were limited
to these two test threads: both original messages have the **INBOX** label,
Google's `Authentication-Results` report **SPF/DKIM/DMARC PASS**, and Google's
Received header records **TLS 1.3**. The envelope sender and DKIM domain align
with `drapixai.com`; selector `zmail` signed both. Gmail reply `In-Reply-To`
headers match each original Message-ID. Minimized evidence, excluding personal
message content and recipient details, is saved in
`runtime/launch-evidence/zoho-gmail-authentication-20261022.json`.

This completes the two controlled alias send/reply checks, not ongoing
deliverability or the whole email launch gate. Fresh MFA sign-in/recovery, private
billing/privacy/security alias drills, monitoring/response ownership and
application SMTP integration remain open. The agent did not read or change
provider credentials; the owner handled their first-login password change.

Initial MFA inspection, 22 October: the Accounts page for the regular `feedback@`
user showed `tfa_active` unchecked and offered setup for OTP Authenticator,
security key and other factors. MFA was not enabled at that observation.
The owner was asked to enroll privately, save backup codes and leave the setup
screen before a status-only recheck. No factor was enabled by the agent and no
QR code, seed, OTP or backup code was read. The separate `admin@` account still
requires its own MFA/recovery check. Original GoDaddy/GitHub/Neon/Resend MFA
observations do not establish protection of these newly created Zoho users.

After private owner enrollment, a status-only recheck confirmed `tfa_active`
checked and “OTP authenticator configured” for `feedback@`. No enrollment
dialog remained open. The owner reported the requested setup complete,
including the instruction to save backup codes privately; their storage and a
recovery drill were not inspected. Evidence:
`runtime/launch-evidence/zoho-feedback-mfa-enabled-20261022.jpg`.
The owner was asked to check the separate `admin@` factor next. Fresh sign-in
challenge and recovery verification remain open for both accounts.

The owner then completed the separate admin check. A status-only observation
matched `admin@drapixai.com`, found `tfa_active` checked and “OTP authenticator
configured”, with no open enrollment dialog. Evidence:
`runtime/launch-evidence/zoho-admin-mfa-enabled-20261022.jpg`. Both Zoho users
now have verified MFA-enabled settings. Backup-code storage is owner-reported;
fresh sign-in challenges and recovery usability remain distinct, unverified
checks. Neither account's seed, OTP or recovery codes were read by the agent.

Routing review after admin sign-in: both users' Email Forwarding panels state
“No forwarding email addresses are added”. The admin delegation panel states
the feature is available only on paid plans; no delegation change was made.
These are provider configuration observations, not live delivery tests for the
three private aliases. A three-message external-to-private routing drill was
prepared locally in `runtime/launch-evidence/zoho-private-alias-test-plan-20261022.json`.
The owner subsequently selected Support as the privacy/security intake, so the
optional private-alias drill is deferred and is not a launch requirement.
No messages from that plan have been sent. No alias deletion is implied.

### Inbox operating procedure awaiting owner coverage confirmation

| Incoming address | Current mailbox | Handling |
| --- | --- | --- |
| `support@`, `feedback@` | Regular `feedback@` user | Account/product help, billing enquiries and privacy/security intake; request minimum necessary context and restrict sensitive handling. |
| `sales@`, `partnerships@` | Regular `feedback@` user | Merchant enquiries and owner-approved pilot conversations. |
| `billing@`, `privacy@`, `security@` | Existing aliases on private `admin@` user | Unused for the owner's current public workflow; aliases retained, no tests sent and no deletion made. |

Owner's final selected workflow: invoices are to be sent automatically through
Resend from **`DrapixAI Billing <noreplybilling@mail.drapixai.com>`**, with
`Reply-To: support@drapixai.com` and a visible Support contact. Send each invoice
only to the purchasing customer's authorized billing recipient. **No internal
company copy, CC or BCC is wanted yet.** A finance-team recipient may be added
later only after the owner identifies and authorizes that recipient. Do not
assume `admin@`, `billing@`, an owner Gmail address or any other company copy.

This is a delivery/configuration requirement for Tasks 3/12, not a claim that
invoice sending is already implemented or verified. The general account-email
sender remains `no-reply@mail.drapixai.com`; do not change the global SMTP From
value to the billing address and thereby relabel OTP/recovery messages. Privacy
requests still need tracking and applicable deadlines, and security reports
need restricted incident handling, even with one public intake address.

Initial Resend verification gap, 22 October: the owner reported the invoice sender was
already set up. The current authenticated workspace's complete Domains list
shows exactly three verified domains: `marketing.drapixai.com`,
`sales.drapixai.com`, and `mail.drapixai.com`. It does not list the root
`drapixai.com` needed for the selected `noreplybilling@drapixai.com` From address.
The account menu offered no other existing team. Do not substitute
`noreplybilling@mail.drapixai.com` or claim root-domain authorization is verified.
Establish the intended Resend workspace/root verification and appropriate key
scope while preserving Zoho MX/SPF/DKIM, then perform a controlled invoice test.
No sending domain, key, DNS record or invoice was created/changed in that check.

The subsequent Add Domain check displayed the current plan's domain limit and
a $20 USD/month Pro upgrade. No upgrade was selected or charged. The owner
explicitly chose **`noreplybilling@mail.drapixai.com` on the current plan**.
This supersedes the original root-domain sender requirement; root verification
is no longer needed for the selected sender. The existing `mail.drapixai.com`
domain shows **Verified**, Sending enabled, verified DKIM/SPF and **Enforced
TLS**. Existing receiving DNS and all sending domains were preserved. Resend
does not require a separate mailbox for each address under a verified sending
domain. See `runtime/launch-evidence/resend-billing-domain-verified-20261022.jpg`.

A single plain-text billing-sender check is prepared with the subject
`TEST ONLY - DrapixAI billing sender - 20261022-BILLING-01`. It clearly states
that no payment is due and it is not a real invoice or transaction. It has no
attachment, CC or BCC and replies point to Support. Its dry run read no
credentials and sent nothing. Owner approval is requested separately for this
third message, since the earlier approval named only Support and Sales.
The one-shot test, if approved, uses the previously supplied Resend credential
in memory only with certificate-verified SMTP TLS; it does not install that
historical credential into application/staging configuration or revoke it.

Controlled billing-sender result, 22 October: the owner explicitly approved the
single test to the named owner Gmail address. SMTP accepted exactly one
recipient with no rejections. The matching Gmail message is in **INBOX** and
**CATEGORY_UPDATES**. Google's Authentication-Results report **SPF, DKIM and
DMARC PASS**; the aligned DKIM domain is `mail.drapixai.com`, and the Received
header records **TLS 1.3**. From is exactly
`DrapixAI Billing <noreplybilling@mail.drapixai.com>` and Reply-To is
`support@drapixai.com`. There was no CC, BCC, attachment, invoice amount or
payment request. Evidence is
`runtime/launch-evidence/resend-billing-gmail-authentication-20261022.json`.
The earlier test-approval-pending status is superseded by this result.

Only the already-provided Resend SMTP credential was used in memory. It was
not printed, copied to a new env file, installed into staging or revoked.
The historically stored credential still needs the coordinated Task 1 rotation;
this controlled probe does not establish safe production secret storage.
The domain/sender test is complete, while automated invoice generation,
verified payment-to-invoice linkage and app delivery integration remain open.

The current `services/emailer.ts` uses one general SMTP sender and contains no
invoice-specific sender helper. Billing webhooks update subscription state but
do not send invoice emails. Implement and test the billing-only From identity,
verified purchaser selection, duplicate-event protection and delivery handling
in Task 12; avoid duplicate invoices from overlapping provider/app mailers.

The owner clarified the commercial rule: cancelling a monthly plan stops its
next automatic renewal; correct subscription charges are not refunded solely
for cancellation, a change of mind or non-use. Verified mistaken/duplicate
charges are refunded, and verified overcharges are corrected by refunding the
excess. The current refund/cancellation page now states this rule, retains
mandatory legal remedies and directs billing-error reports to Support. It no
longer offers a general discretionary outage-refund category. This copy change
does not establish that Stripe's portal, cancellation timing or refunds are
configured or tested. Qualified legal review and Task 12 billing tests remain
open; no live billing or payment-provider settings were changed.

Monitoring operator, working hours, backup cover and escalation contact remain
unconfirmed. This procedure does not publish an SLA, create staffing cover or
configure automatic forwarding. During manual triage, record the request's
reference, category, owner, next action and applicable due date in restricted
company records. Mark a request closed only after its outcome has been recorded
and the customer has received the necessary response. Do not place customer
messages, photos, credentials or financial details in repository evidence.

Use Zoho's From selector for human `support@` and `sales@` mail. Website OTPs,
password resets and other automated transactional messages belong to the
separate Resend `mail.drapixai.com` stream; these mailbox tests do not establish
that the application has a configured or working SMTP connection.

Published root MX priorities are `10 mx.zoho.in`, `20 mx2.zoho.in` and
`50 mx3.zoho.in`; root SPF is `v=spf1 include:zoho.in ~all`. The provider's
public `zmail._domainkey` TXT was copied exactly. DNS returns a 3,600-second TTL.
Existing Resend subdomain records, root website records and DMARC quarantine
policy were preserved. No migration or mobile-app installation was started.
The free-plan setup wizard was completed; its completion banner is not evidence
of delivered email. Public DNS evidence is saved in
`runtime/launch-evidence/zoho-mail-dns-20261021.json`; the scoped change and
rollback record is `runtime/launch-evidence/zoho-mail-setup-20261021.json`.

Resend's `mail.drapixai.com` TLS setting was changed to **Enforced** after
explicit owner approval. Evidence: `runtime/launch-evidence/resend-enforced-tls-20261021.jpg`.
This verifies the setting, not SMTP integration or delivered-message alignment.

Local address-change verification: TypeScript checking, account-terms integrity
and launch-readiness checks passed (including 95 security-boundary and 21
password-security cases). The first restricted run could not connect to its
loopback fixtures; the run with local networking allowed passed. Turbopack's
CSS worker crashed in both restricted and normal execution; the supported
Webpack production build passed, including type checking and all 31 generated
pages. The default Turbopack build issue remains open. No website deployment,
mail send or provider account deletion accompanied this copy change.

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

## Public DNS observation, 19 October 2026

The owner previously confirmed that `contact@drapixai.com` was not set up. A
read-only DNS snapshot found GoDaddy nameservers `ns77.domaincontrol.com` and
`ns78.domaincontrol.com`, no MX or root TXT answers from the configured resolver,
and a DMARC TXT record at `_dmarc.drapixai.com` with `p=quarantine`, relaxed
alignment and aggregate reports directed to `dmarc_rua@onsecureserver.net`.
The saved observation is `runtime/launch-evidence/mail-public-dns-20261019.json`.

This does not prove an inbox exists, that delivery works, that DKIM is absent,
or that all sending subdomains lack SPF. No mail was sent, credential used or
DNS record changed. Before launch, select/provision the incoming-mail service,
create the published contact inbox or verified aliases, confirm the reporting
recipient/provider, publish only provider-supplied records and verify actual
inbound/reply/OTP/recovery delivery with an explicitly approved test recipient.

## Provider observation, 21 October 2026

After owner sign-in, Resend's Domains list showed `mail.drapixai.com`,
`sales.drapixai.com` and `marketing.drapixai.com` as **Verified**. Its API-key
metadata showed one `drapixai-production-smtp` key with Sending access and a
Last used label of No activity. Token values were excluded from the read.
MFA was enabled by the owner and verified through the Authentication status.

These are actual provider observations, superseding any assumption that those
subdomains still need to be created. They do not verify receiving mailboxes,
reply handling, current DNS alignment in delivered messages or separate
transactional/outreach/staging credentials. No test mail was sent. The owner is
unsure whether other systems use the existing key; map consumers and install/
test a replacement before revoking it. See
Task 1 account-security evidence (operational evidence retained privately).

## Domain and DNS setup

For the planned isolated streams, use the existing sending subdomains:

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
