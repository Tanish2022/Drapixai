"""Validate a running first-start service. Never print its environment or secrets."""
import json
import os
import sys


def verify(service, container, bucket):
    env = dict(entry.split("=", 1) for entry in container["Config"]["Env"] if "=" in entry)
    expected = {
        "api": {"DRAPIXAI_REQUIRE_NEON_STAGING": "1", "DRAPIXAI_API_ENVIRONMENT": "sandbox",
                "DRAPIXAI_TRYON_INTAKE_ENABLED": "0", "DRAPIXAI_DISABLE_STAGING_MAIL": "1",
                "SMTP_HOST": "", "DRAPIXAI_STRIPE_BILLING_ENABLED": "0", "DRAPIXAI_STRIPE_LIVE_MODE": "0",
                "DRAPIXAI_EMAIL_EVENTS_ENABLED": "0", "DRAPIXAI_SHOPIFY_ENABLED": "0",
                "DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY": "1", "DRAPIXAI_STAGING_S3_SESSION_FILE": "/run/drapixai-aws/session.json", "S3_BUCKET": bucket, "AWS_REGION": "ap-south-1",
                "DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK": "0"},
        "web": {"DRAPIXAI_PUBLIC_INDEXING": "0", "DRAPIXAI_API_URL": "http://api:8000"},
        "redis": {},
    }[service]
    if service == "api" and (not bucket or any(env.get(k) for k in
            ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "S3_ENDPOINT"))):
        raise ValueError("Invalid staging storage configuration")
    if service == "api" and not any(m.get("Type") == "bind" and m.get("Source") == "/run/drapixai/staging-s3"
            and m.get("Destination") == "/run/drapixai-aws" and m.get("RW") is False for m in container["Mounts"]):
        raise ValueError("Missing read-only staging identity mount")
    for key, value in expected.items():
        if env.get(key) != value:
            raise ValueError(f"Unexpected {service} setting {key}")
    ports = {key: value for key, value in container["NetworkSettings"]["Ports"].items() if value}
    expected_ports = {"api": {"8000/tcp"}, "web": {"3000/tcp"}, "redis": set()}[service]
    if ports.keys() != expected_ports or any(
        binding["HostIp"] not in ("127.0.0.1", "::1") for group in ports.values() for binding in group
    ):
        raise ValueError(f"Unexpected published ports for {service}")
    if container["HostConfig"]["NetworkMode"] == "host":
        raise ValueError("Host networking is incompatible with private staging")


if __name__ == "__main__":
    verify(sys.argv[1], json.load(sys.stdin)[0], os.environ.get("DRAPIXAI_STAGING_S3_BUCKET"))
