from __future__ import annotations

import argparse
import json
from pathlib import Path


def _warning_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate DrapixAI catalog try-on results for public launch.")
    parser.add_argument("summary", type=Path, help="Path to SDK catalog summary.json")
    parser.add_argument("--min-score", type=float, default=0.95)
    parser.add_argument("--max-latency-ms", type=int, default=10000)
    args = parser.parse_args()

    rows = json.loads(args.summary.read_text())
    failures: list[str] = []
    for item in rows:
        warnings = _warning_list(item.get("warnings"))
        try:
            score = float(item.get("quality_score") or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        try:
            latency = int(item.get("latency_ms") or 0)
        except (TypeError, ValueError):
            latency = 0

        reasons = []
        if warnings:
            reasons.append(f"warnings={','.join(warnings)}")
        if score < args.min_score:
            reasons.append(f"score={score:.3f}<min={args.min_score:.3f}")
        if latency > args.max_latency_ms:
            reasons.append(f"latency={latency}ms>max={args.max_latency_ms}ms")
        if reasons:
            failures.append(f"{item.get('id', 'unknown')} ({item.get('category', 'unknown')}): " + "; ".join(reasons))

    if failures:
        print("NOT PUBLIC READY")
        for failure in failures:
            print(f"- {failure}")
        return 2

    print(
        f"PUBLIC READY: {len(rows)} cases passed with no warnings, "
        f"score >= {args.min_score}, latency <= {args.max_latency_ms} ms"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
