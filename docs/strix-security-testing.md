# Governed Strix Security Testing

Strix supplements DrapixAI's deterministic live tenant-boundary harness and the
independent manual penetration test. It must never be used as a stress or load
generator. The three-tenant GPU benchmark remains the authoritative concurrency,
latency, fairness, and capacity test.

Strix actively develops and validates exploits. Run it only against isolated
staging infrastructure that DrapixAI owns and for which a written, time-bounded
authorization exists. Never point it at production, a customer storefront, a
third-party domain, or retained customer data.

## Reviewed tool profile

- CLI: `strix-agent==1.5.3` in a dedicated Python 3.12 environment.
- Sandbox: official `ghcr.io/usestrix/strix-sandbox` image pinned by an approved
  `sha256` digest through `DRAPIXAI_STRIX_SANDBOX_IMAGE`.
- Execution: headless, Standard scan mode, explicit LLM budget and turn cap.
- Telemetry: disabled with `STRIX_TELEMETRY=0`; remote tracing, MCP, Perplexity,
  and Postman integrations are rejected by the DrapixAI runner.
- Data: synthetic staging data only. The runner does not provide tenant
  credentials; authenticated tenant attacks remain in `test:security:live`.
- LLM: use a local model or an enterprise provider with an approved
  zero-data-retention arrangement. The authorization records that approval
  reference.

Strix's open-source CLI uses an LLM to direct the assessment. A self-hosted CLI
does not by itself mean prompts remain local when an external LLM is configured.
Do not use a consumer LLM key for source-aware or authenticated testing.

## Prepare the isolated runner

1. Use a dedicated Linux security runner with Docker. Do not run Strix on the
   production API host or GPU worker.
2. Install Python 3.12 and install the reviewed version in an isolated `pipx` or
   `uv` environment: `pipx install strix-agent==1.5.3`.
3. Resolve and review the official sandbox image for the runner architecture,
   pull it by digest, and retain the digest review. Do not use a mutable tag.
4. Restrict runner egress at the firewall to the exact authorized staging hosts,
   DNS/NTP, the approved LLM endpoint, and the already-pulled sandbox image
   registry only when an operator intentionally updates the pinned image.
5. Keep the Strix viewer bound to loopback. Its token grants report access; do
   not expose the viewer port publicly.

## Authorize one run

Copy `deploy/security/strix-staging-authorization.example.json` to a secure path
outside Git. Fill the exact release commit, exact staging origins, approval,
incident contact, LLM data-processing approval, and an authorization window no
longer than 24 hours. The target hostnames must contain `staging` and the allowed
host list must exactly match the target origins.

The staging edge must enforce the declared request-rate ceiling. The instruction
is also passed to the agents, but the edge rate limit is the technical control.
Monitor WAF, authentication, queue, error-rate, and availability alerts while the
scan runs. The incident contact must be able to revoke tokens and stop the scan.

## Run

Set secrets only in the runner's secret store or process environment:

```bash
export STRIX_LLM="approved-provider/approved-model"
export LLM_API_KEY="REPLACE_FROM_SECRET_STORE"
export DRAPIXAI_STRIX_SANDBOX_IMAGE="ghcr.io/usestrix/strix-sandbox@sha256:REPLACE_WITH_APPROVED_DIGEST"
export DRAPIXAI_STRIX_ACTIVE_TEST_ACK="I_HAVE_WRITTEN_AUTHORIZATION_FOR_THIS_STAGING_TARGET"

python3 deploy/scripts/run-strix-staging.py \
  --authorization /secure/drapixai-strix-authorization.json \
  --scan-mode standard \
  --max-budget 25 \
  --max-turns 500
```

The runner downloads the live `/v1/openapi.json` over verified HTTPS and tests
that contract together with the approved web/API origins. Results remain under
ignored `runtime/launch-evidence/strix-staging/`. The generated instruction file
is deleted after the run.

## Triage and release use

- Exit `0` and `PASS_NO_VALIDATED_FINDINGS` mean the run completed and reported
  no validated finding in the analyzed scope. They do not prove total coverage.
- Exit `2` means a validated finding, incomplete run, budget-edge completion, or
  secret-material detection. Keep the launch gate closed.
- Remediate every validated finding, manually reproduce the original proof, and
  rerun Strix on the exact fixed commit.
- Never commit raw reports. They can contain attack details and staging metadata.
  Store them in encrypted, access-controlled evidence storage with retention.
- A final clean Strix summary is supplemental evidence for the live staging gate.
  It cannot satisfy `authorized-pentest`; that gate still requires an independent
  authorized assessor and retest of all critical/high findings.

Official references: the [Strix repository](https://github.com/usestrix/strix),
[quick start](https://github.com/usestrix/strix/blob/main/docs/quickstart.mdx),
and [configuration reference](https://github.com/usestrix/strix/blob/main/docs/advanced/configuration.mdx).
