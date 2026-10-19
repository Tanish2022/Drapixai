# Owner-confirmed business particulars and outstanding decisions

Recorded 19 October 2026 following the owner's direct reply in this chat.
These are owner-confirmed facts and intentions, not independent registry,
certificate, mailbox, copyright or legal verification.

| Item | Owner's confirmation / implementation |
|---|---|
| Legal operator | **DRAPIXAI SOFTWARE SOLUTIONS LLP** |
| Business address | A-104, Avadh highland, S.P. Ring road, Bhadaj, Ahmedabad, Gujarat, 380060, India |
| Contact email | **contact@drapixai.com**, used for support, sales, billing, privacy and grievance intake |
| Telephone | **6351079022**, displayed internationally as **+91 63510 79022**, `tel:+916351079022` |
| Registration and recognition | Owner confirms government registration in India and a DPIIT recognition certificate. No LLPIN, recognition number, document or independent registry check supplied. No government endorsement of the product, security or model rights claimed. |
| Launch markets | Owner intends worldwide launch from India. This resolves the intended-market question; it does not establish compliance or lawful availability in every country. |
| Ages | Owner intends no business age restriction. This is not an instruction to bypass legally required child/guardian protections, and does not establish that the existing upload/account flows satisfy them. No arbitrary adults-only restriction has been imposed. |
| Media/models | Owner states no copyrighted media or model is used. Record this as an assertion; the actual Standard dependencies contradict a blanket copyright/licence-free representation. It does not close artifact-specific permissions. |

## Website changes

- A shared public business record supplies the contact page, footer and legal
  operator details; the former unfilled environment-only identity placeholders
  are replaced with the supplied particulars.
- Contact/footer email and phone are actionable links. Public-facing website
  support, sales and privacy references use the confirmed contact mailbox instead
  of previously unconfirmed aliases. No messages or test calls were sent.
- Privacy and terms identify the Indian LLP and address. The shopper processing
  version remains `2026-10-18`; contact updates are separately dated and do not
  broaden purposes or waive existing consent checks.
- Earlier dated audit findings remain historical evidence. This record updates
  which business inputs are now known; it does not retroactively certify them.

## What durable account assent means

The service needs a reliable server-side record of an account's affirmative
acceptance of the applicable terms, distinct from merely displaying a checkbox.
A minimal record would link an account identifier, the exact document version
and retained document/content hash, a server-generated acceptance timestamp, and
the authenticated acceptance flow (password signup, Google signup or later
terms-update screen). Avoid collecting extra IP/device data by default.

The backend must validate the required choice/version and persist the record
before granting the relevant access, including new accounts entering through
OAuth or login routes. Records and document versions need controlled access and
protection against silent rewriting, with an approved retention/rights process.
Google authenticating an email does not itself prove acceptance of DrapixAI's
terms. Optional analytics consent and permission to process a shopper photo are
separate choices, not automatically authorized by accepting account terms.

**Initial assessment:** registration has an unchecked terms control and explanatory
privacy notice. Its UI gates password/configured Google signup; it is not a
durable backend acceptance ledger and can be bypassed through other account
entry paths. The owner's latest message asks for an explanation; no new ledger,
acceptance migration or revised commercial agreement was claimed implemented at
that assessment.
Subsequent implementation on this date added a retained terms document,
append-only database migration and tested transaction helpers; see
[the ledger evidence record](../account-terms-ledger-2026-10-19.md). These are
foundations only: signup/OAuth routes are not yet wired to them. Counsel-approved
wording/versioning, retention and complete backend/OAuth enforcement remain
required.

## Children, global offering and model-rights review remain open

The [DPDP Act](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)
defines children by reference to age eighteen, and [rule 10](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
addresses verifiable parental consent before processing children's personal data,
subject to applicable scope/exemptions and phased commencement. The
[commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
must be read with the rules; do not assert that every substantive duty is already
operative in October 2026. Current applicable laws and target-country duties
still require review. A global, all-ages service needs a proportionate, reviewed
child/guardian and jurisdiction plan before public processing. For example,
[FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
describes conditional US protections for children's online data. Do not infer a
single worldwide age threshold or collect identity documents by default.

The immutable Standard profile explicitly selects CatVTON code revision
`7818397f25613beedb3d861a34769f607cfcf3b1`, CatVTON weights and separate base/VAE
models. Both the local third-party LICENSE/README and the
[pinned upstream licence](https://raw.githubusercontent.com/Zheng-Chong/CatVTON/7818397f25613beedb3d861a34769f607cfcf3b1/LICENSE)
identify **CC BY-NC-SA 4.0**, including a noncommercial restriction. The upstream
README describes code, checkpoints and demo material under that licence.
Open-source availability is not absence of copyright, and entity registration or
DPIIT recognition does not itself grant third-party commercial permissions.
Separate sufficient permissions or an applicable reviewed legal basis must cover
the exact artifacts and business use. Base/supporting models and media need
their own review. No licence-free or commercially cleared claim has been added
to the website; the Standard realism pipeline remains unchanged.

Subsequent local enforcement now connects password signup, restricted
Google/existing-account sessions and service credential checks to that ledger.
A production-browser/BFF/API/disposable-database test verified actual saved
assent and keyboard continuation. See the updated ledger evidence record for
scope, tests and limitations; actual provider/staging verification and legal
approval are still pending.

Still required: registration/certificate references where legally needed,
mailbox monitoring/delivery, a named privacy/grievance owner where required,
qualified legal review, approved global/child handling, deployed account-assent evidence,
model/media permissions and all actual deployment/P0 evidence.
