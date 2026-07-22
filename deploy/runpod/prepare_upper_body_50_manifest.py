from __future__ import annotations

import argparse
import json
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ASSET_ROOT = APP_ROOT / "runtime" / "test_assets" / "upper_body_50"
DEFAULT_OUTPUT = APP_ROOT / "runtime" / "test_assets" / "upper_body_50_manifest.json"

PEOPLE = (
    ("men_slim_straight", "men", "slim", "front_straight_arms"),
    ("men_average_relaxed", "men", "average", "front_relaxed"),
    ("men_broad_bend", "men", "broad", "front_slight_bend"),
    ("men_slim_relaxed", "men", "slim", "front_relaxed"),
    ("men_average_bend", "men", "average", "front_slight_bend"),
    ("women_slim_straight", "women", "slim", "front_straight_arms"),
    ("women_average_relaxed", "women", "average", "front_relaxed"),
    ("women_broad_bend", "women", "broad", "front_slight_bend"),
    ("women_slim_relaxed", "women", "slim", "front_relaxed"),
    ("women_average_bend", "women", "average", "front_slight_bend"),
)

GARMENTS = (
    ("shirt_plain_blue", "shirt", "Plain blue shirt", "shirt"),
    ("shirt_checked", "shirt", "Checked shirt", "shirt"),
    ("shirt_printed", "shirt", "Printed shirt", "shirt"),
    ("shirt_dark", "shirt", "Dark shirt", "shirt"),
    ("shirt_white", "shirt", "White shirt", "shirt"),
    ("shirt_folded_cuff", "shirt", "Folded-cuff shirt", "shirt"),
    ("shirt_structured_collar", "shirt", "Structured-collar shirt", "shirt"),
    ("shirt_relaxed_fit", "shirt", "Relaxed-fit shirt", "shirt"),
    ("tshirt_plain_light", "tshirt", "Plain light T-shirt", "tshirt"),
    ("tshirt_plain_dark", "tshirt", "Plain dark T-shirt", "tshirt"),
    ("tshirt_graphic", "tshirt", "Graphic T-shirt", "tshirt"),
    ("tshirt_oversized", "tshirt", "Oversized T-shirt", "tshirt"),
    ("tshirt_fitted", "tshirt", "Fitted T-shirt", "tshirt"),
    ("tshirt_striped", "tshirt", "Striped T-shirt", "tshirt"),
    ("tshirt_bold_print", "tshirt", "Bold-print T-shirt", "tshirt"),
    ("tshirt_low_contrast", "tshirt", "Low-contrast T-shirt", "tshirt"),
    ("polo_navy", "polo", "Navy polo", "polo"),
    ("polo_white", "polo", "White polo", "polo"),
    ("polo_striped", "polo", "Striped polo", "polo"),
    ("polo_fitted", "polo", "Fitted polo", "polo"),
    ("polo_relaxed", "polo", "Relaxed polo", "polo"),
    ("polo_contrast_collar", "polo", "Contrast-collar polo", "polo"),
    ("hoodie_pullover", "hoodie_sweatshirt", "Pullover hoodie", "hoodie"),
    ("hoodie_zip", "hoodie_sweatshirt", "Zip hoodie", "hoodie"),
    ("hoodie_graphic", "hoodie_sweatshirt", "Graphic hoodie", "hoodie"),
    ("sweatshirt_plain", "hoodie_sweatshirt", "Plain sweatshirt", "sweatshirt"),
    ("sweatshirt_oversized", "hoodie_sweatshirt", "Oversized sweatshirt", "sweatshirt"),
    ("sweatshirt_printed", "hoodie_sweatshirt", "Printed sweatshirt", "sweatshirt"),
    ("blouse_plain", "blouse_top", "Plain blouse", "blouse"),
    ("blouse_printed", "blouse_top", "Printed blouse", "blouse"),
    ("top_fitted", "blouse_top", "Fitted top", "top"),
    ("top_relaxed", "blouse_top", "Relaxed top", "top"),
    ("top_puff_sleeve", "blouse_top", "Puff-sleeve top", "top"),
    ("blouse_structured", "blouse_top", "Structured blouse", "blouse"),
    ("short_kurti_plain", "short_kurti", "Plain short kurti", "short_kurti"),
    ("short_kurti_printed", "short_kurti", "Printed short kurti", "short_kurti"),
    ("short_kurti_dark", "short_kurti", "Dark short kurti", "short_kurti"),
    ("short_kurti_light", "short_kurti", "Light short kurti", "short_kurti"),
    ("short_kurti_flared", "short_kurti", "Flared short kurti", "short_kurti"),
    ("short_kurti_structured", "short_kurti", "Structured short kurti", "short_kurti"),
    ("sleeveless_plain", "sleeveless_top", "Plain sleeveless top", "top"),
    ("sleeveless_printed", "sleeveless_top", "Printed sleeveless top", "top"),
    ("sleeveless_fitted", "sleeveless_top", "Fitted sleeveless top", "top"),
    ("sleeveless_relaxed", "sleeveless_top", "Relaxed sleeveless top", "top"),
    ("edge_green", "edge_case", "Green color-fidelity garment", "shirt"),
    ("edge_white", "edge_case", "White edge-case garment", "tshirt"),
    ("edge_black", "edge_case", "Black edge-case garment", "tshirt"),
    ("edge_busy_print", "edge_case", "Busy-print edge-case garment", "shirt"),
    ("edge_low_contrast", "edge_case", "Low-contrast edge-case garment", "blouse"),
    ("edge_logo_texture", "edge_case", "Logo and texture fidelity garment", "polo"),
)


def relative_to_root(path: Path) -> str:
    try:
        return path.resolve().relative_to(APP_ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def build_manifest(asset_root: Path, confirm_rights: bool, rights_reference: str, rights_scope: str) -> dict[str, object]:
    cases: list[dict[str, object]] = []
    for index, (slug, segment, label, profile) in enumerate(GARMENTS, start=1):
        person_id, gender, body_profile, pose_profile = PEOPLE[(index - 1) % len(PEOPLE)]
        cases.append(
            {
                "slug": slug,
                "segment": segment,
                "person_path": relative_to_root(asset_root / "people" / f"{person_id}.png"),
                "garment_path": relative_to_root(asset_root / "garments" / f"{slug}.png"),
                "gender": gender,
                "body_profile": body_profile,
                "pose_profile": pose_profile,
                "garment_label": label,
                "garment_profile": profile,
                "notes": "Front-facing Standard-quality launch matrix case.",
                "rights_approved": confirm_rights,
            }
        )
    return {
        "schema_version": 1,
        "rights_confirmed": confirm_rights,
        "rights_scope": rights_scope,
        "rights_reference": rights_reference,
        "cases": cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the strict DrapixAI upper-body 50-case manifest.")
    parser.add_argument("--asset-root", type=Path, default=DEFAULT_ASSET_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rights-scope", choices=("internal_qa", "public_catalog"), default="internal_qa")
    parser.add_argument("--rights-reference", default="")
    parser.add_argument("--confirm-rights", action="store_true")
    args = parser.parse_args()

    if args.confirm_rights and not args.rights_reference.strip():
        parser.error("--rights-reference is required with --confirm-rights")

    asset_root = args.asset_root.resolve()
    (asset_root / "people").mkdir(parents=True, exist_ok=True)
    (asset_root / "garments").mkdir(parents=True, exist_ok=True)
    payload = build_manifest(
        asset_root,
        confirm_rights=args.confirm_rights,
        rights_reference=args.rights_reference.strip(),
        rights_scope=args.rights_scope,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(args.output.resolve())
    if not args.confirm_rights:
        print("Template created with rights approval disabled. Add owned/licensed assets, then rerun with --confirm-rights and --rights-reference.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
