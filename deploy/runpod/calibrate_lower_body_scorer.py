from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.quality.lower_body_release import calibrate_metrics


def main() -> int:
    parser = argparse.ArgumentParser(description="Propose scorer thresholds from reviewed lower-body runs.")
    parser.add_argument("--summaries", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-per-label", type=int, default=6)
    args = parser.parse_args()
    report = calibrate_metrics(
        [json.loads(path.read_text(encoding="utf-8")) for path in args.summaries],
        minimum_per_label=args.minimum_per_label,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
