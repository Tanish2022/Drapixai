from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.quality.lower_body_release import apply_admin_reviews


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply exact-match admin reviews to a lower-body run.")
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--reviews", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-admin-rate", type=float, default=0.95)
    args = parser.parse_args()
    summary, errors = apply_admin_reviews(
        json.loads(args.summary.read_text(encoding="utf-8")),
        json.loads(args.reviews.read_text(encoding="utf-8")),
        minimum_admin_rate=args.minimum_admin_rate,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(args.output)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
