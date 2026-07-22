from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 local tooling
    import tomli as tomllib  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_TOPICS = {
    "app/uninstalled",
    "products/create",
    "products/update",
    "products/delete",
}
REQUIRED_COMPLIANCE_TOPICS = {
    "customers/data_request",
    "customers/redact",
    "shop/redact",
}
ALLOWED_SCOPES = {"read_products"}
API_VERSION_PATTERN = re.compile(r"^20\d{2}-(?:01|04|07|10)$")


def read_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def require_https(value: object, label: str, errors: list[str]) -> str | None:
    if not isinstance(value, str):
        errors.append(f"{label} must be a URL string")
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        errors.append(f"{label} must be an HTTPS URL without embedded credentials")
        return None
    return parsed.hostname.lower()


def validate(config_path: Path, allow_placeholders: bool) -> list[str]:
    errors: list[str] = []
    if not config_path.is_file():
        return [f"Shopify config not found: {config_path}"]

    config = read_toml(config_path)
    client_id = config.get("client_id")
    if not isinstance(client_id, str) or not client_id.strip():
        errors.append("client_id is required")
    elif not allow_placeholders and "REPLACE_WITH" in client_id:
        errors.append("client_id still contains a placeholder")

    if config.get("embedded") is not False:
        errors.append("embedded must remain false for the current standalone DrapixAI flow")

    app_host = require_https(config.get("application_url"), "application_url", errors)
    scopes = {
        scope.strip()
        for scope in str(config.get("access_scopes", {}).get("scopes", "")).split(",")
        if scope.strip()
    }
    if scopes != ALLOWED_SCOPES:
        errors.append("access_scopes.scopes must contain only read_products")
    if config.get("access_scopes", {}).get("use_legacy_install_flow") is not False:
        errors.append("use_legacy_install_flow must be false")

    redirect_urls = config.get("auth", {}).get("redirect_urls", [])
    if not isinstance(redirect_urls, list) or not redirect_urls:
        errors.append("at least one auth.redirect_urls entry is required")
    for index, redirect_url in enumerate(redirect_urls if isinstance(redirect_urls, list) else []):
        redirect_host = require_https(redirect_url, f"auth.redirect_urls[{index}]", errors)
        if app_host and redirect_host and redirect_host != app_host:
            errors.append("OAuth redirect URLs must use the application_url host")

    webhooks = config.get("webhooks", {})
    api_version = webhooks.get("api_version")
    if not isinstance(api_version, str) or not API_VERSION_PATTERN.fullmatch(api_version):
        errors.append("webhooks.api_version must be a dated stable Shopify version")

    topics: set[str] = set()
    compliance_topics: set[str] = set()
    subscriptions = webhooks.get("subscriptions", [])
    if not isinstance(subscriptions, list):
        subscriptions = []
        errors.append("webhooks.subscriptions must be a list")
    for index, subscription in enumerate(subscriptions):
        if not isinstance(subscription, dict):
            errors.append(f"webhooks.subscriptions[{index}] must be a table")
            continue
        topics.update(str(topic) for topic in subscription.get("topics", []))
        compliance_topics.update(str(topic) for topic in subscription.get("compliance_topics", []))
        webhook_host = require_https(subscription.get("uri"), f"webhooks.subscriptions[{index}].uri", errors)
        if app_host and webhook_host and webhook_host != app_host:
            errors.append("Webhook URLs must use the application_url host")

    missing_topics = sorted(REQUIRED_TOPICS - topics)
    if missing_topics:
        errors.append(f"missing operational webhook topics: {','.join(missing_topics)}")
    missing_compliance = sorted(REQUIRED_COMPLIANCE_TOPICS - compliance_topics)
    if missing_compliance:
        errors.append(f"missing compliance webhook topics: {','.join(missing_compliance)}")

    extension_path = ROOT / "extensions" / "drapixai-tryon" / "shopify.extension.toml"
    if not extension_path.is_file():
        errors.append("DrapixAI Theme App Extension config is missing")
    else:
        extension = read_toml(extension_path)
        if extension.get("type") != "theme" or not extension.get("name"):
            errors.append("DrapixAI extension must be a named theme extension")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate DrapixAI Shopify app configuration before deployment.")
    parser.add_argument("config", nargs="?", default=str(ROOT / "shopify.app.toml"))
    parser.add_argument("--allow-placeholders", action="store_true")
    args = parser.parse_args()
    config_path = Path(args.config).resolve()
    errors = validate(config_path, args.allow_placeholders)
    if errors:
        print(json.dumps({"ok": False, "errors": errors}, indent=2))
        return 1
    print(json.dumps({"ok": True, "config": str(config_path), "scopes": sorted(ALLOWED_SCOPES)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
