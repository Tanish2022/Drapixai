from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.quality.lower_body_release import evaluate_release_evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate lower-body public-launch evidence without enabling it.")
    parser.add_argument("--intake-report", type=Path, required=True)
    parser.add_argument("--approvals", type=Path, required=True)
    parser.add_argument("--summaries", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--required-runs", type=int, default=2)
    parser.add_argument("--maximum-latency-p95-ms", type=int, default=35_000)
    args = parser.parse_args()
    report = evaluate_release_evidence(
        json.loads(args.intake_report.read_text(encoding="utf-8")),
        [json.loads(path.read_text(encoding="utf-8")) for path in args.summaries],
        release_approvals=json.loads(args.approvals.read_text(encoding="utf-8")),
        required_runs=args.required_runs,
        maximum_latency_p95_ms=args.maximum_latency_p95_ms,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(args.output)
    return 0 if report["decision"] == "eligible_for_manual_public_enable" else 1


if __name__ == "__main__":
    raise SystemExit(main())
