from __future__ import annotations

import argparse
import html
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


PAGE_SIZE = (1600, 1200)
PANEL_SIZE = (460, 760)
BACKGROUND = "#f4f6f8"
INK = "#111827"
MUTED = "#526173"
ACCENT = "#0f766e"
FAIL = "#b42318"


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], width: int, *, size: int, fill: str, bold: bool = False) -> int:
    selected = font(size, bold)
    approximate_chars = max(12, int(width / max(size * 0.56, 1)))
    lines = textwrap.wrap(text, width=approximate_chars) or [""]
    y = xy[1]
    for line in lines:
        draw.text((xy[0], y), line, font=selected, fill=fill)
        y += int(size * 1.3)
    return y


def case_directory(root: Path, entry: dict[str, object]) -> Path:
    case = entry.get("case") if isinstance(entry.get("case"), dict) else {}
    return root / f"{int(case.get('index') or 0):02d}_{case.get('slug') or 'unknown'}"


def paste_panel(page: Image.Image, source_path: Path, origin: tuple[int, int], label: str) -> None:
    draw = ImageDraw.Draw(page)
    x, y = origin
    draw.rounded_rectangle((x, y, x + PANEL_SIZE[0], y + PANEL_SIZE[1]), radius=8, fill="white", outline="#d0d5dd", width=2)
    draw.text((x + 16, y + 14), label, font=font(25, True), fill=INK)
    image_box = (x + 14, y + 58, x + PANEL_SIZE[0] - 14, y + PANEL_SIZE[1] - 14)
    if source_path.is_file():
        with Image.open(source_path) as source:
            prepared = ImageOps.contain(source.convert("RGB"), (image_box[2] - image_box[0], image_box[3] - image_box[1]), Image.Resampling.LANCZOS)
        paste_x = image_box[0] + (image_box[2] - image_box[0] - prepared.width) // 2
        paste_y = image_box[1] + (image_box[3] - image_box[1] - prepared.height) // 2
        page.paste(prepared, (paste_x, paste_y))
    else:
        draw.rectangle(image_box, fill="#eef1f4")
        draw.text((image_box[0] + 24, image_box[1] + 40), "Image unavailable", font=font(24), fill=MUTED)


def render_case_page(root: Path, entry: dict[str, object]) -> Image.Image:
    case = entry.get("case") if isinstance(entry.get("case"), dict) else {}
    metadata = entry.get("result_metadata") if isinstance(entry.get("result_metadata"), dict) else {}
    page = Image.new("RGB", PAGE_SIZE, BACKGROUND)
    draw = ImageDraw.Draw(page)
    status = str(entry.get("status") or "unknown")
    status_color = ACCENT if status == "passed" else FAIL
    title = f"{int(case.get('index') or 0):02d}. {case.get('garment_label') or case.get('slug') or 'Try-on case'}"
    draw.text((54, 34), title, font=font(38, True), fill=INK)
    draw.text((54, 86), f"{case.get('segment', 'unknown')}  |  {case.get('gender', 'unknown')}  |  {case.get('body_profile', 'unknown')}  |  {case.get('pose_profile', 'unknown')}", font=font(22), fill=MUTED)
    draw.rounded_rectangle((1350, 35, 1538, 91), radius=8, fill=status_color)
    draw.text((1372, 50), status.upper(), font=font(22, True), fill="white")

    directory = case_directory(root, entry)
    paste_panel(page, directory / "person.png", (54, 130), "Model input")
    paste_panel(page, directory / "garment.png", (570, 130), "Garment input")
    paste_panel(page, directory / "result.png", (1086, 130), "DrapixAI result")

    quality = metadata.get("quality_score")
    latency = entry.get("latency_ms")
    warnings = metadata.get("warnings") if isinstance(metadata.get("warnings"), list) else []
    failures = entry.get("gate_failures") if isinstance(entry.get("gate_failures"), list) else []
    metrics = f"Quality: {float(quality):.4f}" if isinstance(quality, (int, float)) else "Quality: unavailable"
    metrics += f"    Latency: {int(latency)} ms" if isinstance(latency, (int, float)) else "    Latency: unavailable"
    metrics += f"    Warnings: {len(warnings)}"
    draw.text((54, 930), metrics, font=font(28, True), fill=status_color)
    notes = "; ".join(str(item) for item in failures) or str(case.get("notes") or "No gate failures.")
    draw_wrapped(draw, notes, (54, 984), 1480, size=22, fill=MUTED)
    draw.text((54, 1144), "DrapixAI Standard quality - internal QA evidence", font=font(18), fill=MUTED)
    return page


def render_cover(summary: dict[str, object]) -> Image.Image:
    page = Image.new("RGB", PAGE_SIZE, BACKGROUND)
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, 54, PAGE_SIZE[1]), fill=ACCENT)
    draw.text((115, 150), "DrapixAI", font=font(70, True), fill=INK)
    draw.text((115, 245), "Upper-body 50-case launch catalog", font=font(46, True), fill=INK)
    draw.text((115, 320), "Model input + garment input = Standard try-on result", font=font(30), fill=MUTED)
    statuses = summary.get("statuses") if isinstance(summary.get("statuses"), dict) else {}
    selected = int(summary.get("selected_cases") or 0)
    lines = (
        f"Cases rendered: {selected}",
        f"Passed: {statuses.get('passed', 0)}",
        f"Rejected: {statuses.get('rejected', 0)}",
        f"Generation failed: {statuses.get('generation_failed', 0)}",
        f"Average quality: {summary.get('average_quality_score') if summary.get('average_quality_score') is not None else 'unavailable'}",
        "Publication gate: all 50 cases must pass with no warnings.",
    )
    y = 470
    for line in lines:
        draw.text((115, y), line, font=font(30, line.startswith("Publication")), fill=INK if not line.startswith("Publication") else FAIL)
        y += 62
    draw.text((115, 1080), "Internal QA artifact. Publish only when asset rights and every launch gate are verified.", font=font(22), fill=MUTED)
    return page


def render_contact_sheet(root: Path, entries: list[dict[str, object]]) -> Image.Image:
    columns, tile_w, tile_h = 5, 360, 440
    rows = max(1, (len(entries) + columns - 1) // columns)
    sheet = Image.new("RGB", (columns * tile_w, rows * tile_h), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    for offset, entry in enumerate(entries):
        x = (offset % columns) * tile_w
        y = (offset // columns) * tile_h
        case = entry.get("case") if isinstance(entry.get("case"), dict) else {}
        status = str(entry.get("status") or "unknown")
        result_path = case_directory(root, entry) / "result.png"
        draw.rectangle((x + 8, y + 8, x + tile_w - 8, y + tile_h - 8), fill="white", outline="#d0d5dd", width=2)
        if result_path.is_file():
            with Image.open(result_path) as source:
                thumb = ImageOps.contain(source.convert("RGB"), (tile_w - 36, tile_h - 100), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (x + (tile_w - thumb.width) // 2, y + 16))
        draw.text((x + 18, y + tile_h - 76), f"{int(case.get('index') or 0):02d} {case.get('slug') or 'unknown'}", font=font(17, True), fill=INK)
        draw.text((x + 18, y + tile_h - 48), status.upper(), font=font(17, True), fill=ACCENT if status == "passed" else FAIL)
    return sheet


def write_html(path: Path, root: Path, summary: dict[str, object], entries: list[dict[str, object]]) -> None:
    cards: list[str] = []
    for entry in entries:
        case = entry.get("case") if isinstance(entry.get("case"), dict) else {}
        metadata = entry.get("result_metadata") if isinstance(entry.get("result_metadata"), dict) else {}
        directory = case_directory(root, entry)
        relative = directory.relative_to(root).as_posix()
        status = str(entry.get("status") or "unknown")
        quality = metadata.get("quality_score")
        latency = entry.get("latency_ms")
        cards.append(
            f"<article class='case {html.escape(status)}'><h2>{int(case.get('index') or 0):02d}. {html.escape(str(case.get('garment_label') or case.get('slug') or 'Case'))}</h2>"
            f"<p>{html.escape(str(case.get('segment') or 'unknown'))} | {html.escape(str(case.get('gender') or 'unknown'))} | {html.escape(str(case.get('body_profile') or 'unknown'))} | {html.escape(str(case.get('pose_profile') or 'unknown'))}</p>"
            f"<div class='images'><figure><img src='{relative}/person.png' alt='Model input'><figcaption>Model input</figcaption></figure>"
            f"<figure><img src='{relative}/garment.png' alt='Garment input'><figcaption>Garment input</figcaption></figure>"
            f"<figure><img src='{relative}/result.png' alt='Try-on result'><figcaption>DrapixAI result</figcaption></figure></div>"
            f"<p class='metrics'>Status: {html.escape(status)} | Quality: {html.escape(str(quality if quality is not None else 'unavailable'))} | Latency: {html.escape(str(latency if latency is not None else 'unavailable'))} ms</p></article>"
        )
    document = f"""<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>DrapixAI 50-case catalog</title><style>
body{{margin:0;background:#f4f6f8;color:#111827;font:16px Arial,sans-serif}}header{{padding:40px max(24px,5vw);background:#fff;border-bottom:1px solid #d0d5dd}}main{{max-width:1500px;margin:auto;padding:32px}}.case{{background:#fff;border:1px solid #d0d5dd;border-left:6px solid #b42318;margin:0 0 28px;padding:22px}}.case.passed{{border-left-color:#0f766e}}h1,h2{{margin:0 0 10px}}.images{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}}figure{{margin:0}}img{{display:block;width:100%;height:520px;object-fit:contain;background:#eef1f4}}figcaption{{padding:8px 0;font-weight:700}}.metrics{{font-weight:700}}@media(max-width:800px){{.images{{grid-template-columns:1fr}}img{{height:auto;max-height:640px}}}}</style></head><body><header><h1>DrapixAI upper-body launch catalog</h1><p>Internal QA evidence: model + garment = Standard try-on result. Cases: {len(entries)}.</p></header><main>{''.join(cards)}</main></body></html>"""
    path.write_text(document, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render DrapixAI upper-body matrix evidence as PDF, HTML, and contact sheet.")
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()
    summary_path = args.summary.resolve()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    entries = summary.get("cases")
    if not isinstance(entries, list) or not entries:
        raise ValueError("MATRIX_SUMMARY_CASES_MISSING")
    root = summary_path.parent
    pages = [render_cover(summary), *(render_case_page(root, entry) for entry in entries if isinstance(entry, dict))]
    pdf_path = root / "drapixai_upper_body_50_catalog.pdf"
    pages[0].save(pdf_path, format="PDF", save_all=True, append_images=pages[1:], resolution=144.0, quality=90)
    contact_sheet = render_contact_sheet(root, [entry for entry in entries if isinstance(entry, dict)])
    contact_sheet_path = root / "drapixai_upper_body_50_contact_sheet.jpg"
    contact_sheet.save(contact_sheet_path, format="JPEG", quality=90, optimize=True)
    html_path = root / "drapixai_upper_body_50_catalog.html"
    write_html(html_path, root, summary, [entry for entry in entries if isinstance(entry, dict)])
    result = {
        "pdf": str(pdf_path),
        "html": str(html_path),
        "contact_sheet": str(contact_sheet_path),
        "public_catalog_ready": bool(summary.get("full_matrix_run")) and all(entry.get("status") == "passed" for entry in entries if isinstance(entry, dict)),
    }
    (root / "catalog_artifacts.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
