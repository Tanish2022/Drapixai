import runpy
import unittest
from pathlib import Path

verify = runpy.run_path(str(Path(__file__).with_name("check-cpu-container.py")))["verify"]


def fixture(env, ports):
    return {"Config": {"Env": env}, "NetworkSettings": {"Ports": ports},
            "HostConfig": {"NetworkMode": "test_bridge"}}


class CpuContainerTests(unittest.TestCase):
    def test_web_requires_private_listener_and_server_origin(self):
        data = fixture(["DRAPIXAI_PUBLIC_INDEXING=0", "DRAPIXAI_API_URL=http://api:8000"],
                       {"3000/tcp": [{"HostIp": "127.0.0.1"}]})
        verify("web", data, None)
        data["NetworkSettings"]["Ports"]["3000/tcp"].append({"HostIp": "0.0.0.0"})
        with self.assertRaises(ValueError):
            verify("web", data, None)

    def test_redis_rejects_published_ports_or_host_network(self):
        data = fixture([], {"6379/tcp": None})
        verify("redis", data, None)
        data["HostConfig"]["NetworkMode"] = "host"
        with self.assertRaises(ValueError):
            verify("redis", data, None)
        data["HostConfig"]["NetworkMode"] = "test_bridge"
        data["NetworkSettings"]["Ports"]["6379/tcp"] = [{"HostIp": "127.0.0.1"}]
        with self.assertRaises(ValueError):
            verify("redis", data, None)

    def test_api_requires_staging_identity_and_disabled_billing(self):
        env = ["DRAPIXAI_REQUIRE_NEON_STAGING=1", "DRAPIXAI_API_ENVIRONMENT=sandbox",
               "DRAPIXAI_TRYON_INTAKE_ENABLED=0", "DRAPIXAI_DISABLE_STAGING_MAIL=1", "SMTP_HOST=",
               "DRAPIXAI_STRIPE_BILLING_ENABLED=0", "DRAPIXAI_STRIPE_LIVE_MODE=0",
               "DRAPIXAI_EMAIL_EVENTS_ENABLED=0", "DRAPIXAI_SHOPIFY_ENABLED=0",
               "DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY=1", "AWS_REGION=ap-south-1", "S3_BUCKET=fixture-bucket",
               "DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK=0", "DRAPIXAI_STAGING_S3_SESSION_FILE=/run/drapixai-aws/session.json"]
        data = fixture(env, {"8000/tcp": [{"HostIp": "127.0.0.1"}]})
        data["Mounts"] = [{"Type": "bind", "Source": "/run/drapixai/staging-s3", "Destination": "/run/drapixai-aws", "RW": False}]
        verify("api", data, "fixture-bucket")
        for setting in ("DRAPIXAI_STRIPE_BILLING_ENABLED=1", "SMTP_HOST=fixture", "AWS_ACCESS_KEY_ID=fixture"):
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                data["Config"]["Env"] = env + [setting]
                verify("api", data, "fixture-bucket")
        data["Config"]["Env"] = env
        data["Mounts"][0]["RW"] = True
        with self.assertRaises(ValueError):
            verify("api", data, "fixture-bucket")


if __name__ == "__main__":
    unittest.main()
