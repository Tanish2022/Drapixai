variable "zone_id" {
  description = "Cloudflare zone ID for drapixai.com."
  type        = string
  sensitive   = true
}

variable "api_hostname" {
  description = "Public API hostname protected by Cloudflare."
  type        = string
  default     = "api.drapixai.com"
}

variable "origin_ipv4" {
  description = "API origin IPv4. The origin firewall must allow HTTPS only from Cloudflare egress ranges."
  type        = string
  sensitive   = true
}

variable "managed_waf_ruleset_id" {
  description = "Cloudflare Managed Ruleset ID available for this zone/plan."
  type        = string
}
