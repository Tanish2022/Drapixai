# DrapixAI Marketing Execution Pack

This folder contains execution-ready assets for pre-launch growth:

1. `01-go-to-market-strategy.md` - positioning, channels, campaign structure, and KPI targets.
2. `02-video-scripts.md` - ready-to-record scripts for short-form ads and brand outreach.
3. `03-video-production-kit.md` - scene prompts and editing specs to turn scripts into videos.
4. `04-prelaunch-partner-brief.md` - one-page partner brief for fashion ecommerce brands.
5. `05-email-outreach-sequence.md` - cold outbound email sequence + follow-ups.
6. `06-email-sender-setup.md` - setup guide for SMTP-based brand outreach sender.
7. `07-growth-experiments.md` - additional channel and funnel experiments.
8. `08-marketing-ai-agent-operating-system.md` - single-agent execution framework for solo founder operations.
9. `09-marketing-ai-agent-prompt.md` - copy-paste system prompt for your recurring marketing agent.
10. `10-marketing-agent-report-template.md` - daily/weekly output template to track momentum.
11. `11-enterprise-motion-playbook.md` - separate strategy for large enterprise brands.
12. `brand-leads-template.csv` - lead sheet template for growth-store outreach execution.
13. `enterprise-leads-template.csv` - separate enterprise account list for founder-led enterprise motion.
14. `12-brand-segmentation-research.md` - research notes and classification logic for growth vs enterprise.
15. `13-omnichannel-marketing-roadmap.md` - 90-day omnichannel roadmap beyond email marketing.
16. `14-segmented-email-templates.md` - two targeted first-touch email templates (growth and enterprise).

Email sending script:

- `apps/api/scripts/send-brand-outreach.js`

Run the sender from `apps/api`:

```powershell
node scripts/send-brand-outreach.js
```

By default, it runs in dry mode (`OUTREACH_DRY_RUN=true`) so you can preview safely first.
