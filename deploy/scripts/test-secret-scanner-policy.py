"""Prove the configured scanner detects a synthetic credential, not just exits 0."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gitleaks", default="gitleaks")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    policy = root / ".gitleaks.toml"
    with tempfile.TemporaryDirectory(prefix="drapixai-scanner-control-") as temporary:
        work = Path(temporary)
        fixtures = work / "fixtures"
        fixtures.mkdir()
        # Deliberately synthetic and never submitted to any service. Constructed
        # here so this test source does not itself contain a credential pattern.
        canary = "ghp_" + "A0b1C2d3E4f5G6h7I8j9K0l1M2n3O4p5Q6r7"
        (fixtures / "synthetic.txt").write_text("token = " + canary + "\n", encoding="utf-8")

        def scan(config: Path, report_name: str) -> tuple[int, list]:
            report = work / report_name
            result = subprocess.run(
                [args.gitleaks, "dir", "--config", str(config), "--redact",
                 "--no-banner", "--no-color", "--report-format", "json",
                 "--report-path", str(report), str(fixtures)],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if result.returncode not in (0, 1) or not report.is_file():
                raise AssertionError("SCANNER_EXECUTION_FAILED")
            return result.returncode, json.loads(report.read_text(encoding="utf-8"))

        disabled = work / "disabled.toml"
        disabled.write_text('title = "negative control with no detection rules"\n', encoding="utf-8")
        status, findings = scan(disabled, "disabled.json")
        assert status == 0 and not findings, "NEGATIVE_CONTROL_INVALID"
        status, findings = scan(policy, "enabled.json")
        assert status == 1 and any(item.get("RuleID") == "github-pat" for item in findings), (
            "SECRET_SCANNER_POLICY_DOES_NOT_DETECT_SYNTHETIC_TOKEN"
        )
        public_examples = (
            'repo_id = "zhengchong/CatVTON"\n'
            'api = "DRAPIXAI_ALLOW_LEGACY_API_KEYS=0"\n'
            'curl https://example.test -H "Authorization: Bearer SERVER_API_KEY"\n'
        )
        (fixtures / "synthetic.txt").write_text(public_examples, encoding="utf-8")
        status, findings = scan(policy, "placeholders.json")
        assert status == 0 and not findings, "EXACT_PUBLIC_PLACEHOLDERS_NOT_RECOGNIZED"
        (fixtures / "synthetic.txt").write_text(
            public_examples + 'token = "' + canary + '" # SERVER_API_KEY zhengchong/CatVTON\n',
            encoding="utf-8",
        )
        status, findings = scan(policy, "adjacent-token.json")
        assert status == 1 and any(item.get("RuleID") == "github-pat" for item in findings), (
            "PUBLIC_PLACEHOLDER_MUST_NOT_SUPPRESS_ADJACENT_CREDENTIAL"
        )
        print("PASS secret scanner policy: default detection active; disabled-rule negative control rejected")


if __name__ == "__main__":
    main()
