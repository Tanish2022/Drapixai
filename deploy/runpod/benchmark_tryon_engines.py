from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path.cwd()))
BENCH_ROOT = Path(os.getenv("DRAPIXAI_BENCHMARK_DIR", APP_ROOT / "runtime" / "benchmarks"))
ENGINES = ["catvton"]


def run_engine(engine: str, run_root: Path) -> dict[str, object]:
    matrix_dir = run_root / engine
    env = os.environ.copy()
    env["PYTHONPATH"] = str(APP_ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env.setdefault("DRAPIXAI_RUNTIME_CACHE_ROOT", str(APP_ROOT / "runtime" / "cache"))
    env.setdefault("U2NET_HOME", str(APP_ROOT / "runtime" / "cache" / "u2net"))
    env.setdefault("HF_HOME", str(APP_ROOT / "runtime" / "cache" / "huggingface"))
    env.setdefault("TORCH_HOME", str(APP_ROOT / "runtime" / "cache" / "torch"))
    env["DRAPIXAI_TRYON_ENGINE"] = engine
    env["DRAPIXAI_TEST_MATRIX_DIR"] = str(matrix_dir)
    env["DRAPIXAI_MODEL_DIR"] = env.get("DRAPIXAI_CATVTON_MODEL_DIR", str(APP_ROOT / "models" / "catvton"))

    started_at = datetime.now(timezone.utc)
    completed = subprocess.run(
        [sys.executable, str(APP_ROOT / "deploy" / "runpod" / "smoke_matrix.py")],
        cwd=str(APP_ROOT),
        env=env,
        text=True,
        capture_output=True,
    )
    finished_at = datetime.now(timezone.utc)

    summary_path = matrix_dir / "summary.json"
    cases = []
    if summary_path.exists():
        cases = json.loads(summary_path.read_text(encoding="utf-8"))

    succeeded = sum(1 for item in cases if item.get("status") == "succeeded")
    failed = sum(1 for item in cases if item.get("status") == "failed")
    quality_scores = [
        float(item.get("result_metadata", {}).get("quality_score"))
        for item in cases
        if item.get("result_metadata", {}).get("quality_score") is not None
    ]

    return {
        "engine": engine,
        "status": "succeeded" if completed.returncode == 0 else "failed",
        "returncode": completed.returncode,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "case_count": len(cases),
        "succeeded": succeeded,
        "failed": failed,
        "average_quality_score": sum(quality_scores) / len(quality_scores) if quality_scores else None,
        "summary_path": str(summary_path),
        "stdout_tail": completed.stdout[-4000:],
        "stderr_tail": completed.stderr[-4000:],
    }


def main() -> int:
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_root = BENCH_ROOT / run_id
    if run_root.exists():
        shutil.rmtree(run_root)
    run_root.mkdir(parents=True, exist_ok=True)

    results = [run_engine(engine, run_root) for engine in ENGINES]
    report = {
        "run_id": run_id,
        "run_root": str(run_root),
        "engines": results,
        "decision": "CatVTON is the only configured engine; production rollout is gated by manual image review.",
    }
    report_path = run_root / "benchmark_summary.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(report_path)
    return 0 if all(item["status"] == "succeeded" for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
