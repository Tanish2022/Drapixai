# On-site staging preparation

Updated 2026-10-16. This is a preparation plan, not a deployed-environment
certificate or permission to purchase resources.

## Confirmed inputs

- The owner reports approximately INR 50,000 in monthly business running costs.
  Treat this as the whole business's reported operating cost, not a separate
  hosting allowance. Its breakdown has not been verified.
- The ordered Threadripper PRO 9975WX / 256 GB ECC / RTX PRO 6000 Blackwell 96 GB
  workstation has not arrived. Its full order and acceptance checklist are in
  `docs/ordered-workstation.md`; do not substitute the laptop for that target.
- Read-only inspection of the current host found Windows 11 Home Single Language,
  an i7-12650H (10 cores / 16 threads), approximately 15.7 GiB system memory and an
  RTX 4060 Laptop GPU reporting 8188 MiB VRAM. WSL currently lists Docker Desktop;
  no separate Ubuntu installation or remotely accessible server was established.
- Live staging remains unprovisioned. No paid infrastructure has been created
  from the owner's cost statement.

## Work before delivery

Use the existing laptop for bounded, disposable CPU tests, release-image builds,
dependency and secret audits, source topology verification, synthetic retention
and isolation regressions, and preparation of the workstation deployment package.
Account for its limited RAM when scheduling builds and service tests.

Keep test credentials, queues, databases and volumes separate from current local
application data. Keep test services private and inference intake disabled where
there is no certified worker. Retain exact commit/image evidence; synthetic
fixtures and container-native checks do not certify live staging or inference.

Do not expose the laptop as the company's public always-on inference service or
claim the 8 GB GPU proves Standard parity, capacity or four-request quality.
Do not change Standard parameters, models or scoring to accommodate this GPU.

## Work after delivery

1. Perform the ordered-workstation acceptance checks before deployment, including
   real container GPU execution, memory/storage/thermal checks, UPS shutdown and
   encrypted storage. Preserve the Standard CatVTON release profile.
2. Establish the live deployment's domain/DNS routing, authenticated HTTPS edge,
   VPN administration, operator identities and restricted firewall/listeners.
   Verify the site's internet availability and recovery behavior; ownership of
   a workstation alone does not prove these controls.
3. Follow `deploy/staging/README.md` with staging-specific secrets and identities,
   isolated PostgreSQL/Redis resources, and a separate managed S3 bucket with
   versioning and public-access blocks. The disposable MinIO test image is not
   the staging storage service. Off-host backups and restore evidence remain
   required even when compute is on-site.
4. Establish API-to-worker mTLS and verify the actual deployed topology. Sharing
   a physical host never waives the required isolation or listener evidence.
   Any topology change must pass review and live verification before use.
5. Run CPU operational and privacy drills, followed by exact-image GPU parity,
   visual quality, three-tenant baseline and four-request capacity/soak tests.
   The current worker's three-request cap remains; measurement tooling accepting
   four inputs is not evidence of four-request execution.

All original 22 gates and agreed 15 work packages remain in force, including
commercial model rights, independent penetration testing and controlled pilot
approval. Existing business costs do not authorize new spending, external
outreach, customer traffic or public launch.
