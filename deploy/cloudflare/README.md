# DrapixAI Cloudflare edge

This Terraform stack proxies `api.drapixai.com`, enables a managed WAF ruleset, adds API-specific custom rules, and applies coarse IP rate limits. Cloudflare's HTTP DDoS protection is enabled by Cloudflare independently of this stack.

## Before apply

1. Create a least-privilege Cloudflare API token with Zone DNS Edit and Zone WAF Write for only the DrapixAI zone.
2. Export it as `CLOUDFLARE_API_TOKEN`. Do not put it in `.tfvars`.
3. Obtain the zone's Cloudflare Managed Ruleset ID with the Rulesets API.
4. Copy `terraform.tfvars.example` outside the repository and replace all placeholders.
5. Store Terraform state in an encrypted remote backend with locking and restricted access.
6. Configure the origin firewall to allow TCP 443 only from the published Cloudflare IP ranges. Administrative access remains VPN-only.
7. Install a valid origin certificate and disable direct HTTP origin access.

Run `terraform plan`, have a second person review it, then run `terraform apply`. Validate WAF events and rate-limit behavior in staging before production.

Cloudflare handles edge and DDoS abuse. DrapixAI's Redis-backed API-key, tenant, and GPU-concurrency controls remain mandatory because edge limits cannot identify a tenant securely.
