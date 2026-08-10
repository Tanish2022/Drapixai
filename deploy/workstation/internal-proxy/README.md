# GPU private mTLS proxy

This is the mandatory network boundary between the Node API and the CatVTON GPU
host. It does not change the Standard model profile, model weights, queue, or
image processing. The AI Compose file still publishes the AI API only at
`127.0.0.1:8080`; this proxy is the sole VPN-facing listener.

## Security contract

- Bind Nginx only to the GPU host's Tailscale/WireGuard address and TCP `443`.
- Use a private DNS name present in `DRAPIXAI_AI_URL` and
  `DRAPIXAI_AI_ALLOWED_HOSTS` on the API host.
- Require an API-client certificate signed by a dedicated internal CA.
- Put that CA at the API runtime's `NODE_EXTRA_CA_CERTS` path.
- Permit the VPN/API security group to reach GPU TCP `443` only; do not expose
  GPU TCP `80`, `443`, `8080`, `6379`, SSH, Docker, or model volumes to the public
  internet.
- Keep the Nginx worker process and certificate files on the GPU host; API
  private-key material belongs only on the API host.

## GPU-host installation

Use Ubuntu's supported Nginx package and install it from the OS security-update
repository. Run as a privileged operator on the GPU host:

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends nginx gettext-base
sudo test ! -e /etc/nginx/sites-enabled/default || sudo unlink /etc/nginx/sites-enabled/default
sudo install -d -m 0700 /etc/drapixai/internal-proxy
sudo install -m 0600 /secure/operator/server.crt /etc/drapixai/internal-proxy/server.crt
sudo install -m 0600 /secure/operator/server.key /etc/drapixai/internal-proxy/server.key
sudo install -m 0644 /secure/operator/api-client-ca.crt /etc/drapixai/internal-proxy/api-client-ca.crt
sudo install -m 0600 deploy/workstation/internal-proxy/internal-proxy.env.example /etc/drapixai/internal-proxy.env
sudoedit /etc/drapixai/internal-proxy.env
sudo -E bash deploy/workstation/internal-proxy/render-config.sh
sudo nginx -t
sudo systemctl enable --now nginx
sudo -E bash deploy/workstation/internal-proxy/verify-mtls-proxy.sh
```

The CA must issue a server certificate with the private DNS name in its SAN and
a separate API client certificate with `clientAuth` extended key usage. Do not
reuse the public web certificate, public ACME certificate, or any shopper/API
key as the internal CA. Do not generate or move private keys through Git,
email, chat, shell history, or logs.

## API-host configuration

Set the matching private DNS URL and CA path in the API environment:

```dotenv
DRAPIXAI_AI_URL=https://ai.drapixai.internal
DRAPIXAI_AI_ALLOWED_HOSTS=ai.drapixai.internal
DRAPIXAI_AI_PRIVATE_NETWORK=1
NODE_EXTRA_CA_CERTS=/run/secrets/drapixai-internal-ca.pem
```

Mount the dedicated API client certificate and key as read-only container
secrets. DrapixAI's `aiFetch` client loads these files directly and rejects an
untrusted GPU certificate; ordinary Node `fetch` is not used for API-to-AI
requests. Add the corresponding paths to the API environment:

```dotenv
DRAPIXAI_AI_MTLS_ENABLED=1
DRAPIXAI_AI_MTLS_CERT_FILE=/run/secrets/drapixai-ai-client.crt
DRAPIXAI_AI_MTLS_KEY_FILE=/run/secrets/drapixai-ai-client.key
```

The source configuration prevents accidental public exposure, but the
end-to-end API client-certificate test remains a release gate. From the API
host or a locked-down API-runtime shell that can read the mounted client
certificate, run this against the private GPU DNS name only:

```bash
export DRAPIXAI_MTLS_GPU_URL=https://ai.drapixai.staging.internal
export DRAPIXAI_MTLS_CA_CERT=/run/secrets/drapixai-internal-ca.pem
export DRAPIXAI_MTLS_CLIENT_CERT=/run/secrets/drapixai-ai-client.crt
export DRAPIXAI_MTLS_CLIENT_KEY=/run/secrets/drapixai-ai-client.key
bash deploy/workstation/internal-proxy/verify-mtls-api-handshake.sh \
  | tee /secure/drapixai-gpu-mtls-handshake.out
```

Do not use `curl -k`, a public DNS name, a public proxy, copied key material, or
shell history for this check. Append the redacted output to the GPU listener
verifier output before supplying `DRAPIXAI_GPU_MTLS_EVIDENCE` to staging
certification.

## Required proof

1. On GPU: `verify-mtls-proxy.sh` passes.
2. From an untrusted/non-VPN host: connection to the VPN address fails.
3. From API host without the client certificate: TLS handshake/request fails.
4. From API host with the dedicated client certificate: `/health` succeeds.
5. A normal SDK try-on succeeds through the API and leaves no public GPU
listener. Save only redacted command output in `runtime/launch-evidence`.
