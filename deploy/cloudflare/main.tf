resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = var.api_hostname
  type    = "A"
  content = var.origin_ipv4
  ttl     = 1
  proxied = true
}

resource "cloudflare_ruleset" "custom_waf" {
  zone_id     = var.zone_id
  name        = "DrapixAI API edge protections"
  description = "Reject malformed methods, non-standard ports, and direct probing before requests reach DrapixAI."
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules = [
    {
      ref         = "drapixai_block_non_standard_ports"
      description = "Only allow standard HTTP and HTTPS edge ports"
      expression  = "(not cf.edge.server_port in {80 443})"
      action      = "block"
      enabled     = true
    },
    {
      ref         = "drapixai_block_unexpected_methods"
      description = "Block methods not used by the public API"
      expression  = "(http.host eq \"${var.api_hostname}\" and not http.request.method in {\"GET\" \"POST\" \"PUT\" \"PATCH\" \"DELETE\" \"OPTIONS\"})"
      action      = "block"
      enabled     = true
    },
    {
      ref         = "drapixai_challenge_sensitive_probes"
      description = "Challenge common secret and control-plane probes"
      expression  = "(http.host eq \"${var.api_hostname}\" and (http.request.uri.path contains \"/.env\" or http.request.uri.path contains \"/.git\" or http.request.uri.path contains \"/wp-admin\" or http.request.uri.path contains \"/actuator\"))"
      action      = "managed_challenge"
      enabled     = true
    }
  ]
}

resource "cloudflare_ruleset" "managed_waf" {
  zone_id     = var.zone_id
  name        = "DrapixAI managed WAF"
  description = "Execute Cloudflare's managed application attack rules."
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules = [
    {
      ref         = "drapixai_execute_managed_waf"
      description = "Cloudflare managed ruleset"
      expression  = "http.host eq \"${var.api_hostname}\""
      action      = "execute"
      enabled     = true
      action_parameters = {
        id = var.managed_waf_ruleset_id
      }
    }
  ]
}

resource "cloudflare_ruleset" "rate_limits" {
  zone_id     = var.zone_id
  name        = "DrapixAI API edge rate limits"
  description = "Coarse IP abuse protection. Application limits additionally enforce API-key and tenant quotas."
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [
    {
      ref         = "drapixai_auth_ip_rate"
      description = "Slow authentication and token brute force"
      expression  = "(http.host eq \"${var.api_hostname}\" and (starts_with(http.request.uri.path, \"/auth/\") or http.request.uri.path eq \"/v1/tokens\"))"
      action      = "block"
      enabled     = true
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 30
        mitigation_timeout  = 600
      }
    },
    {
      ref         = "drapixai_tryon_ip_rate"
      description = "Bound abusive try-on submission bursts at the edge"
      expression  = "(http.host eq \"${var.api_hostname}\" and (http.request.uri.path eq \"/v1/tryons\" or http.request.uri.path eq \"/sdk/tryon\"))"
      action      = "block"
      enabled     = true
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 20
        mitigation_timeout  = 120
      }
    }
  ]
}
