terraform {
  required_version = ">= 1.8.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"
    }
  }
}

provider "cloudflare" {
  # Set CLOUDFLARE_API_TOKEN outside Terraform. Never put it in tfvars or state.
}
