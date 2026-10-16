# Concurrency evidence hardening — 16 October 2026

The direct and public concurrency benchmarks now refuse non-finite quality or
headroom values, quality below 0.95, headroom below 20%, and latency limits above
12 seconds. Every output is checked independently. A passing average cannot hide
a weak output. VRAM totals, allocations and reservations must be positive and
consistent with the reported headroom. Failed direct attempts remain in the
report with a redacted failure code.

Public benchmark manifests require unique safe case IDs, distinct token-variable
names and distinct credential values. This prevents duplicate labels from
skipping isolation probes or escaping the retained-image output directory.
Metadata probes must return the correct owner/product association and 404 for
each other tenant. Tokens remain environment inputs and are not stored in the
manifest or result report.

## Four-request tooling is preparation, not capacity approval

The existing `benchmark-three-tenant-public-api.py` keeps three tenants as its
default, preserving the original three-tenant gate. It additionally supports
`--concurrent-tenants 4`, with the token-free example manifest in
`deploy/examples/four-tenant-public-api-manifest.json`. In that mode, the expected
worker batch is exactly four and all twelve cross-tenant denials are required.
An explicit smaller batch override is rejected. The worker's three-item cap is
unchanged, so the current deployment cannot pass four-item batch evidence.

Once the test environment and approved GPU candidate are available, use
consent/rights-cleared fixtures and four distinct synthetic tenants to run:

```bash
python deploy/scripts/benchmark-three-tenant-public-api.py \
  --manifest /secure/four-tenant-public-api-manifest.json \
  --base-url https://api.staging.drapixai.com/v1 \
  --concurrent-tenants 4 \
  --output-dir runtime/launch-evidence/four-tenant-candidate
```

No such real four-request test has run. These are technical measurement checks,
not visual realism, full SDK/browser parity, rights approval or release approval.
Single-request reference comparisons, named visual review, seeds/settings,
actual batch identity/index telemetry, repeated p50/p95/p99 measurements,
100-group soak, spool cleanup and worker failure containment still need their
own evidence. The original 22 gates remain intact and no runtime cap or Standard
inference setting was changed.

## CPU verification

`python deploy/scripts/test-concurrency-benchmark.py` uses synthetic data and
mocked HTTP functions; it sends no requests or media. Its adversarial cases cover
non-finite and out-of-range measurements, inconsistent VRAM, weak CLI limits,
duplicate identities, aliased credentials, all twelve cross-tenant checks, a
three-item fallback presented as four-item execution, failed-attempt accounting
and one failing output hidden by a high group average. CI runs these controls
before the still-blocking AI dependency audit. Passing these tests proves verifier
behavior only and supplies no GPU or tenant-isolation certification.
