from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image


APP_ROOT = Path(__file__).resolve().parents[2]
PREPARE_SCRIPT = APP_ROOT / "deploy" / "runpod" / "prepare_upper_body_50_manifest.py"
CATALOG_SCRIPT = APP_ROOT / "deploy" / "runpod" / "build_upper_body_50_catalog.py"
EXPECTED = {
    "shirt": 8,
    "tshirt": 8,
    "polo": 6,
    "hoodie_sweatshirt": 6,
    "blouse_top": 6,
    "short_kurti": 6,
    "sleeveless_top": 4,
    "edge_case": 6,
}


def load_prepare_module():
    spec = importlib.util.spec_from_file_location("prepare_upper_body_50_manifest", PREPARE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load manifest preparation module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    prepare = load_prepare_module()
    with tempfile.TemporaryDirectory(prefix="drapixai-upper-50-") as temporary:
        root = Path(temporary)
        manifest = prepare.build_manifest(root / "assets", False, "", "internal_qa")
        cases = manifest["cases"]
        assert len(cases) == 50
        assert Counter(case["segment"] for case in cases) == EXPECTED
        assert len({case["slug"] for case in cases}) == 50
        assert len({case["garment_path"] for case in cases}) == 50
        assert len({case["person_path"] for case in cases}) == 10
        assert {case["gender"] for case in cases} == {"men", "women"}
        assert {case["body_profile"] for case in cases} == {"slim", "average", "broad"}
        assert {case["pose_profile"] for case in cases} == {
            "front_straight_arms",
            "front_slight_bend",
            "front_relaxed",
        }
        assert manifest["rights_confirmed"] is False
        assert all(case["rights_approved"] is False for case in cases)

        entries: list[dict[str, object]] = []
        for index, status in enumerate(("passed", "rejected"), start=1):
            slug = f"fixture_{index}"
            case_dir = root / f"{index:02d}_{slug}"
            case_dir.mkdir(parents=True)
            Image.new("RGB", (300, 400), (210, 220, 230)).save(case_dir / "person.png")
            Image.new("RGB", (300, 400), (40, 140, 90)).save(case_dir / "garment.png")
            if status == "passed":
                Image.new("RGB", (300, 400), (80, 155, 110)).save(case_dir / "result.png")
            entries.append(
                {
                    "case": {
                        "index": index,
                        "slug": slug,
                        "segment": "shirt",
                        "gender": "men",
                        "body_profile": "average",
                        "pose_profile": "front_relaxed",
                        "garment_label": f"Fixture {index}",
                        "notes": "Catalog renderer fixture.",
                    },
                    "status": status,
                    "latency_ms": 9500,
                    "gate_failures": [] if status == "passed" else ["FIXTURE_REJECTION"],
                    "result_metadata": {"quality_score": 0.97 if status == "passed" else 0.8, "warnings": []},
                }
            )
        summary = {
            "selected_cases": 2,
            "full_matrix_run": False,
            "statuses": {"passed": 1, "rejected": 1, "generation_failed": 0},
            "average_quality_score": 0.885,
            "cases": entries,
        }
        summary_path = root / "summary.json"
        summary_path.write_text(json.dumps(summary), encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, str(CATALOG_SCRIPT), "--summary", str(summary_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or completed.stdout)
        for name in (
            "drapixai_upper_body_50_catalog.pdf",
            "drapixai_upper_body_50_catalog.html",
            "drapixai_upper_body_50_contact_sheet.jpg",
            "catalog_artifacts.json",
        ):
            path = root / name
            assert path.is_file() and path.stat().st_size > 0, name
        artifacts = json.loads((root / "catalog_artifacts.json").read_text(encoding="utf-8"))
        assert artifacts["public_catalog_ready"] is False
    print("Upper-body 50-case manifest and catalog tooling validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
