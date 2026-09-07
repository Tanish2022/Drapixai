#!/usr/bin/env python3
"""Negative controls for the staging template verifier; no services are started."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from staging_topology import load_compose, validate

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("topology_cli", Path(__file__).with_name("verify-staging-topology.py"))
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


class TopologyTests(unittest.TestCase):
    def setUp(self):
        self.edge = load_compose((ROOT / "deploy/staging/docker-compose.edge.yml").read_text())
        self.ai = load_compose((ROOT / "deploy/staging/docker-compose.ai.yml").read_text())
        self.images = CLI.parse_env(ROOT / "deploy/staging/.images.env.example")
        self.env = CLI.parse_env(ROOT / "deploy/env/api.staging.example")
        self.profile = CLI.parse_env(ROOT / "deploy/release/standard-catvton-rc1.env")

    def report(self):
        return validate(self.edge, self.ai, self.images, self.env, self.profile)

    def reject(self, control):
        report = self.report()
        self.assertFalse(report["passed"], report)
        self.assertFalse(report["controls"][control], report)
        self.assertTrue(report["failures"])

    def test_current_templates_pass(self):
        report = self.report()
        self.assertTrue(report["passed"], report)
        self.assertTrue(all(report["controls"].values()))

    def test_every_private_service_rejects_published_ports(self):
        for topology, names in ((self.edge, ("postgres", "redis", "minio", "minio-init")),
                                (self.ai, ("redis", "ai-worker"))):
            for name in names:
                with self.subTest(service=name, topology=topology["name"]):
                    topology["services"][name]["ports"] = ["0.0.0.0:5432:5432"]
                    self.reject("data_services_have_no_host_ports")
                    del topology["services"][name]["ports"]

    def test_every_origin_rejects_extra_public_binding(self):
        for topology, name, control in ((self.edge, "api", "web_and_api_origins_are_loopback_only"),
                                        (self.edge, "web", "web_and_api_origins_are_loopback_only"),
                                        (self.ai, "ai-api", "gpu_origin_is_loopback_only")):
            for port in ("0.0.0.0:8000:8000", "[::]:8000:8000", "8000:8000",
                         {"target": 8000, "published": 8000}):
                with self.subTest(service=name, port=port):
                    topology["services"][name]["ports"].append(port)
                    self.reject(control)
                    topology["services"][name]["ports"].pop()

    def test_host_network_and_privileged_are_rejected(self):
        for topology in (self.edge, self.ai):
            for name, service in topology["services"].items():
                for key, value in (("network_mode", "host"), ("network_mode", "service:redis"), ("privileged", True)):
                    with self.subTest(service=name, key=key, value=value):
                        service[key] = value
                        self.reject("reviewed_topology_is_preserved")
                        del service[key]

    def test_wrong_network_cannot_be_hidden_by_an_internal_network(self):
        self.edge["networks"]["data"]["internal"] = False
        self.edge["networks"]["edge"] = {"internal": True}
        self.reject("private_networks_are_isolated")
        self.setUp()
        self.ai["services"]["redis"]["networks"] = ["default"]
        self.reject("private_networks_are_isolated")

    def test_image_marker_in_comment_does_not_pin_actual_image(self):
        self.edge["services"]["api"]["image"] = "drapixai/api:latest"
        self.reject("application_release_images_are_digest_pinned")
        self.setUp()
        self.images["DRAPIXAI_REDIS_IMAGE"] = "redis:7"
        self.reject("all_staging_service_images_are_digest_pinned")

    def test_source_build_and_extra_service_rejected(self):
        self.ai["services"]["ai-worker"]["build"] = "."
        self.reject("staging_deploys_without_source_builds")
        self.setUp()
        self.edge["services"]["debug-proxy"] = {"image": "alpine", "ports": ["5432:5432"]}
        self.reject("reviewed_topology_is_preserved")

    def test_standard_profile_missing_reordered_or_overridden(self):
        for name in ("ai-api", "ai-worker"):
            for files in (["../env/ai.staging.env"],
                          ["../release/standard-catvton-rc1.env", "../env/ai.staging.env"]):
                with self.subTest(service=name, files=files):
                    self.ai["services"][name]["env_file"] = files
                    self.reject("standard_release_profile_is_loaded")
                    self.setUp()
            for value in ({"DRAPIXAI_CANDIDATE_COUNT": "4"}, ["DRAPIXAI_INFERENCE_STEPS=1"],
                          ["DRAPIXAI_QUALITY_MODE"], ["DRAPIXAI_CANDIDATE_COUNT=1", "DRAPIXAI_CANDIDATE_COUNT=4"]):
                with self.subTest(service=name, environment=value):
                    self.ai["services"][name]["environment"] = value
                    self.reject("standard_release_profile_is_loaded")
                    self.setUp()

    def test_mtls_missing_writable_and_environment_override(self):
        api = self.edge["services"]["api"]
        api["volumes"] = [v.replace("client.key:ro", "client.key:rw") for v in api["volumes"]]
        self.reject("api_to_gpu_mtls_is_configured")
        self.reject("secret_mounts_are_read_only")
        self.setUp()
        self.edge["services"]["api"]["environment"]["DRAPIXAI_AI_MTLS_ENABLED"] = "0"
        self.reject("api_to_gpu_mtls_is_configured")

    def test_duplicate_secret_target_rejected(self):
        self.edge["services"]["api"]["volumes"].append("./private/other:/run/secrets/drapixai-ai-client.key:ro")
        self.reject("secret_mounts_are_read_only")
        self.reject("api_to_gpu_mtls_is_configured")

    def test_missing_secret_and_tmpfs_shadow_rejected(self):
        self.ai["services"]["redis"]["volumes"] = []
        self.reject("secret_mounts_are_read_only")
        self.setUp()
        self.edge["services"]["api"]["tmpfs"].append("/run/secrets:size=1m")
        self.reject("secret_mounts_are_read_only")
        self.reject("api_to_gpu_mtls_is_configured")

    def test_external_network_and_composition_rejected(self):
        self.edge["networks"]["data"]["external"] = True
        self.reject("private_networks_are_isolated")
        self.setUp()
        self.edge["include"] = ["unreviewed.yml"]
        self.reject("reviewed_topology_is_preserved")

    def test_malformed_document_cli_fails_without_source_leak(self):
        original = Path.read_text
        def read(path, *args, **kwargs):
            if path.name == "docker-compose.edge.yml":
                return "services: [SECRET_SENTINEL"
            return original(path, *args, **kwargs)
        with patch.object(Path, "read_text", read), contextlib.redirect_stdout(io.StringIO()) as output:
            code = CLI.main()
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(output.getvalue())["passed"])
        self.assertNotIn("SECRET_SENTINEL", output.getvalue())

    def test_parser_rejects_duplicate_keys_and_non_mapping(self):
        for source in ("services:\n  api: {}\n  api: {}", "[]", "null", "services: ["):
            with self.subTest(source=source), self.assertRaises(Exception):
                load_compose(source)

    def test_public_port_regression_through_cli(self):
        original = Path.read_text
        def read(path, *args, **kwargs):
            source = original(path, *args, **kwargs)
            if path.name == "docker-compose.edge.yml":
                source = source.replace("    restart: unless-stopped\n",
                                        "    restart: unless-stopped\n    ports:\n      - '0.0.0.0:5432:5432'\n", 1)
            return source
        with patch.object(Path, "read_text", read), contextlib.redirect_stdout(io.StringIO()) as output:
            code = CLI.main()
        report = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertFalse(report["controls"]["data_services_have_no_host_ports"])
        self.assertIn("not-live-infrastructure", report["scope"])

    def test_git_ignore_failure_cannot_claim_secrets_protected(self):
        original = subprocess.run
        def run(args, **kwargs):
            if args[0] == "git":
                return subprocess.CompletedProcess(args, 1)
            return original(args, **kwargs)
        with patch.object(subprocess, "run", run), contextlib.redirect_stdout(io.StringIO()) as output:
            code = CLI.main()
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(output.getvalue())["controls"]["secrets_are_mounted_and_git_ignored"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
