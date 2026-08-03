# DrapixAI private production network

## Public edge

Only Cloudflare exposes `api.drapixai.com` and `www.drapixai.com`. The origin accepts HTTPS from Cloudflare egress addresses only. SSH and administrative dashboards are reachable only through the company VPN with MFA.

## API network

The Node API can reach PostgreSQL, Redis, object storage, and the GPU service over private addresses. Those services must not have public DNS records or wildcard public listeners. `DRAPIXAI_AI_URL` uses private DNS, TLS, a private CA, and a service token. The hostname must be explicitly listed in `DRAPIXAI_AI_ALLOWED_HOSTS`.

For the on-premises RTX PRO 6000 workstation, use a dedicated Tailscale tailnet or site-to-site WireGuard network:

1. Enroll the API host and GPU host with separate machine identities.
2. Allow API-to-GPU TCP 443 only.
3. Allow operations SSH only from the administrator device group.
4. Deny GPU-to-database, GPU-to-Redis, and unrestricted outbound access.
5. Terminate private TLS in front of the AI API and forward to `127.0.0.1:8080`.
6. Keep the RQ Redis instance on the GPU private network and use a separate credential from the API Redis instance.
7. Rotate the AI service token and VPN machine credentials independently.

Run `bash deploy/scripts/verify-private-listeners.sh` on database, Redis, MinIO, and GPU hosts. Also verify cloud security groups and the physical router firewall because a local listener check cannot inspect upstream firewalls.
