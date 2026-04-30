# Outreach Sender Setup

Run from:

```powershell
cd C:\Users\tanis\OneDrive\Desktop\Drapixai\apps\api
node scripts/send-brand-outreach.js
```

## Required Environment Variables
- `OUTREACH_SMTP_HOST`
- `OUTREACH_SMTP_PORT` (default `587`)
- `OUTREACH_SMTP_USER`
- `OUTREACH_SMTP_PASS`
- `OUTREACH_FROM_EMAIL`

## Recommended Variables
- `OUTREACH_FROM_NAME` (default: `DrapixAI Partnerships`)
- `OUTREACH_SENDER_NAME`
- `OUTREACH_REPLY_TO`
- `OUTREACH_SUBJECT`
- `OUTREACH_CTA_URL`
- `OUTREACH_LEADS_CSV` (defaults to `marketing/brand-leads-template.csv`)
- `OUTREACH_LIMIT` (send cap per run)
- `OUTREACH_DRY_RUN` (`true` by default)

## Example Dry Run
```powershell
$env:OUTREACH_DRY_RUN='true'
$env:OUTREACH_LEADS_CSV='C:\Users\tanis\OneDrive\Desktop\Drapixai\marketing\brand-leads-template.csv'
node scripts/send-brand-outreach.js
```

## Example Live Send
```powershell
$env:OUTREACH_SMTP_HOST='smtp.gmail.com'
$env:OUTREACH_SMTP_PORT='587'
$env:OUTREACH_SMTP_USER='you@yourdomain.com'
$env:OUTREACH_SMTP_PASS='app-password-or-smtp-secret'
$env:OUTREACH_FROM_EMAIL='you@yourdomain.com'
$env:OUTREACH_DRY_RUN='false'
$env:OUTREACH_LIMIT='25'
node scripts/send-brand-outreach.js
```

## Safety Rules
- Start with `OUTREACH_DRY_RUN=true`.
- Send small batches first (`OUTREACH_LIMIT=10` to `25`).
- Verify deliverability and replies before larger sends.
