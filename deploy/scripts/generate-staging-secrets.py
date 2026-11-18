#!/usr/bin/env python3
"""Generate an isolated, git-ignored mounted-secret set for staging."""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import tempfile
from pathlib import Path
from urllib.parse import quote


def token(bytes_count: int = 48) -> str:
    return secrets.token_urlsafe(bytes_count)


def write_private(path: Path, value: str) -> None:
    # mkstemp creates a private inode before any value is written. Replacing the
    # destination never follows a pre-existing symlink or modifies its target.
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(value)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repo_root / "deploy" / "staging" / "private",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    existing = [path for path in output_dir.iterdir() if path.is_file()]
    if existing and not args.force:
        raise SystemExit(
            "Staging secret files already exist. Refusing to rotate them without --force."
        )

    postgres_password = token()
    api_database_password = token()
    redis_password = token()
    ai_redis_password = token()
    minio_user = f"drapixai-staging-{secrets.token_hex(6)}"
    minio_password = token()
    ai_service_token = token(64)
    stripe_secret_key = os.environ.get("DRAPIXAI_STRIPE_SECRET_KEY", "").strip()
    stripe_webhook_secret = os.environ.get("DRAPIXAI_STRIPE_WEBHOOK_SECRET", "").strip()
    if not stripe_secret_key.startswith("sk_test_") or len(stripe_secret_key) < 32:
        raise SystemExit(
            "Export a valid test-mode DRAPIXAI_STRIPE_SECRET_KEY before generating staging secrets."
        )
    if not stripe_webhook_secret.startswith("whsec_") or len(stripe_webhook_secret) < 32:
        raise SystemExit(
            "Export a valid staging DRAPIXAI_STRIPE_WEBHOOK_SECRET before generating staging secrets."
        )

    write_private(output_dir / "postgres_password", postgres_password)
    write_private(output_dir / "api_database_password", api_database_password)
    write_private(output_dir / "redis_password", redis_password)
    write_private(output_dir / "ai_redis_password", ai_redis_password)
    write_private(output_dir / "minio_root_user", minio_user)
    write_private(output_dir / "minio_root_password", minio_password)

    api_secrets = {
        "DATABASE_URL": (
            "postgresql://drapixai_staging_api:"
            f"{quote(api_database_password, safe='')}@postgres:5432/drapixai_staging"
        ),
        "REDIS_URL": (
            "redis://default:"
            f"{quote(redis_password, safe='')}@redis:6379/1"
        ),
        "JWT_SECRET": token(64),
        "DRAPIXAI_AUTH_SYNC_TOKEN": token(48),
        "DRAPIXAI_DASHBOARD_PROXY_TOKEN": token(48),
        "DRAPIXAI_AI_SERVICE_TOKEN": ai_service_token,
        "DRAPIXAI_ADMIN_TOKEN": token(48),
        "DRAPIXAI_ADMIN_PASSWORD": token(32),
        "DRAPIXAI_ADMIN_TOTP_SECRET": base64.b32encode(secrets.token_bytes(20)).decode("ascii"),
        "DRAPIXAI_STOREFRONT_TOKEN_SECRET": token(64),
        "DRAPIXAI_AUDIT_LOG_SECRET": token(64),
        "DRAPIXAI_WEBHOOK_ENCRYPTION_KEY": token(32),
        "DRAPIXAI_METRICS_TOKEN": token(48),
        "DRAPIXAI_STRIPE_SECRET_KEY": stripe_secret_key,
        "DRAPIXAI_STRIPE_WEBHOOK_SECRET": stripe_webhook_secret,
        "SMTP_PASS": token(32),
        "AWS_ACCESS_KEY_ID": minio_user,
        "AWS_SECRET_ACCESS_KEY": minio_password,
    }
    write_private(
        output_dir / "drapixai-api.json",
        json.dumps(api_secrets, indent=2, sort_keys=True) + "\n",
    )
    write_private(output_dir / "ai_service_token", ai_service_token)

    print(f"Generated isolated staging secrets in {output_dir}")
    print("Copy ai_redis_password and ai_service_token to the GPU host through the VPN.")
    print("Never commit, email, or paste these files into tickets or chat.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
