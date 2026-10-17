# Personal data, storage, vendors and assets

Engineering inventory, 17 October 2026. Configured capabilities are not confirmed production providers. No secrets or real personal records were exported for this review.

## Lifecycle map

| Collection / category | Purpose and route | Processing / recipients | Storage / deletion evidence and gap |
| --- | --- | --- | --- |
| Merchant email, company/name, optional phone, account preferences | Register/login/profile; `routes/auth.ts`, `account.ts` | API, optional Google OAuth and SMTP provider | Prisma User; password bcrypt hashes, verification-code hashes/expiry. Approved account/OTP/email-log archival and erasure schedule not established. |
| Authentication and key data | Signed sessions, dashboard/admin access, SDK/server API auth | Browser, web server, API, Redis rate limits | HttpOnly signed cookies; hashed API keys; encrypted Shopify/webhook credentials. Production secret custody/rotation and operator access need evidence. |
| Shopper photo and generated preview | SDK, public demo, direct try-on after versioned image consent | API upload area → AI API → private spool references/RQ → worker/GPU → response → browser blob | Current paths aim for transient processing and no persisted shopper result URLs. Default AI spool age 900s; API age 15min checked every 5min; AI checks on activity/startup. A hard deletion deadline is not proven. Test interrupted/idle/down/restart, copies, logs, swap and backups. |
| Garment photos, product names/IDs, domains, catalog feeds and mappings | Upload/import/Shopify read_products; prepare and manually confirm product | API, remote merchant source, object store/cache, AI preprocessing | Merchant catalog DB/cache/assets persist for service operation. Some images can contain people despite intended garment-only input; asset/erasure review still applies. |
| Consent, quality, usage and reservation metadata | Requested processing, safety, quota, troubleshooting | API/database, immutable audit, approved merchant webhooks | Request/tenant IDs, score, warnings/timings, consent version and timestamp, hashed IP in audit. Pseudonymous is not automatically anonymous. No approved category-wide retention schedule. |
| Analytics visitor ID and page/click metadata | Optional website measurement, `trackEvent` → `/events` | Browser → API → WebsiteEvent; admin aggregate views | Post-fix consent gate; no referrer or page title sent by page views. Visitor ID removed on rejection/withdrawal/expired consent when tracking checks run. Existing server records are not erased by withdrawal. Server retention decision pending. |
| Billing customer/subscription IDs, checkout attempts, event IDs and usage | Hosted Stripe Checkout/portal, signed webhook settlement | API, Stripe (if configured), finance/support | Prisma financial/event/usage records. Card-entry flow delegated to hosted Stripe; this does not establish PCI compliance. Currency/catalog/tax/live lifecycle and legal retention require review. |
| Merchant webhook URL, encrypted secret and delivery payloads | Merchant-authorized integration | API → validated merchant endpoint | URL and metadata payloads persist for retry. Inspect recipient role, data minimization, retention and revocation in production. |
| Support question text | Local guided help matching | `SupportAssistant.tsx` component memory; explicit mailto link hands off to user's email client | No chat backend/model call found in this component. Emailing support creates a separate mailbox/vendor processing flow; actual mailbox/provider/retention unverified. |
| Network/security/operational records | Fraud prevention, access control, debugging/incident response | Hosting/proxies, API/web/AI, observability and operators | Code excludes image/base64 logging; production exporters, edge logs, access addresses, retention/region and breach drill need evidence. |

## Browser technology inventory

| Name / mechanism | Category / purpose | Lifetime / control |
| --- | --- | --- |
| `drapixai_dashboard_session` cookie | Necessary dashboard authentication | Code max age 7 days; HttpOnly, SameSite Strict, Secure in production; logout/revocation flows. |
| `drapixai_admin_session` cookie | Necessary operator authentication | Code max age 8 hours; HttpOnly, SameSite Strict, Secure in production. |
| NextAuth session, CSRF, callback, state/PKCE cookies as enabled | Necessary authentication, optional Google sign-in | Library/configuration-dependent names and secure prefixes, expiry and chunking. Inventory actual Set-Cookie in enabled deployed flows; not all are set on an anonymous page. |
| `drapixai-theme` localStorage | Functional appearance preference | No source expiry; user/browser clears. Evaluate any applicable preference exception; no advertising purpose found. |
| `drapixaiVisitorId` localStorage | Optional analytics identifier | Initially indefinite; now created only after valid analytics choice, removed when rejected/withdrawn or expired consent is encountered. No claim of server historical-data deletion. |
| `drapixaiPrivacyPreferences` localStorage | Necessary to remember optional analytics choice | Version, boolean and timestamps only, validated maximum 180 days. No extra consent UUID or account/IP capture. Engineering renewal interval, not a legally mandated retention period. Storage failure keeps analytics off. |
| Website event beacon/fetch | Analytics after consent | No page title/referrer in page view, no queue replay of events collected before consent. Server may retain historical WebsiteEvent data until an approved erasure schedule is implemented. |
| Optional YouTube/Vimeo/remote demo video | Separate external media | Previously immediate; now not mounted until explicit load. Page reload resets load choice. Browser IP/provider processing still occurs after load; closing analytics preferences does not erase provider data. |
| Shopper preview object URLs | Requested image preview in browser | React cleanup revokes selected input/result URLs; user downloads are separately controlled by user. |

No GA, Meta pixel, Hotjar or session-recording import was found in the reviewed web source. This is not proof that a deployed CDN/tag manager, merchant host, browser extension or future integration adds none. Inspect actual traffic and SDK host websites before publication.

## Vendor and international-flow review

| Capability evidenced by source | Data potentially involved | Required external evidence |
| --- | --- | --- |
| Local/on-prem GPU and API/web hosting, reverse proxy/WAF/tunnel | Images, traffic, account/service metadata | Actual legal operator, network/physical access, region, backups, provider agreement and processing boundary. Staging is not yet provisioned. |
| PostgreSQL / Redis / S3-compatible storage | Account, financial/security metadata, queues and garment assets | Real providers and regions, private networking, encryption/key ownership, backups/retention and DPA. SDK/library names do not establish AWS as production host. |
| SMTP / Google OAuth / Stripe | Email/account, identity and billing data respectively | Enabled provider, agreement, role, countries/transfers, support access and deletion. Google and Stripe capabilities do not prove live configuration. |
| Shopify | Shop/domain, product/variant/catalog and encrypted installation credentials | Partner account/dev-store/real install and mandatory webhook proof still pending. No customer/order scope in launch design. |
| Hugging Face/model downloads | Provisioning traffic; model code/weights | Pin/verify model artifacts and licences. No training upload pipeline was identified; independently verify no production tracing/support export sends shopper images. |
| Video, support email, merchant webhooks, monitoring | IP/browser, messages and metadata | Exact recipients, destinations, vendor terms and region; assess international safeguards for each actual data flow. |

## IP and claims inventory

| Item | Evidence / status | Required proof |
| --- | --- | --- |
| CatVTON code/checkpoint | Local ignored third-party checkout README/LICENSE; upstream CC BY-NC-SA 4.0 | Sufficient commercial permission for exact materials and use; qualified review. Critical open launch risk. |
| Base inpainting/VAE, parsing/segmentation/pose weights, other engines | Pinned model download/runtime docs; lower-body work is separate | Per-artifact licence, source revision, attribution, restrictions and rights review; one model permission does not clear all. |
| `hero-standard-tryon.png`, `hero-female-tryon-v2.png`, logo/wordmark, OG image | Present in `apps/web/public`; marketing presents reference outputs | Source/creator, actual output provenance, person/model/garment rights and approved use. Do not assume stock or generated means unrestricted. |
| Fonts/icons | System font stack; lucide-react dependency; inline Google sign-in logo | Retain package licence/NOTICE obligations; check brand-use rules and no implied endorsement. |
| Node/Python dependency and container distributions | Lockfiles/pins and image docs | Generate release SBOM/notice bundle from exact installed artifacts; assess redistribution obligations, not only vulnerability scans. |
| 0.95 reference and A100 10–12s target | `app/page.tsx`; current hardware unavailable for final proof | Rights-cleared benchmark, configuration, sample IDs, measurement method and clear limits; four concurrent results >=0.95 each remains unproven. |

No published customer-count or testimonial was removed. Missing in-repository proof is a verification request, not a finding that legitimate content is fabricated.
