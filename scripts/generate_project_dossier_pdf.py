from pathlib import Path

PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN_X = 52
MARGIN_TOP = 60
MARGIN_BOTTOM = 48
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "drapixai-project-dossier.pdf"

SECTIONS = [
    {
        "kind": "cover",
        "title": "DrapixAI",
        "subtitle": "Project dossier covering product, technology, deployment, launch readiness, and go-to-market context.",
        "meta": [
            "Date: 2026-06-26",
            "Audience: founder, sales, engineering, launch, and support",
            "Current scope: upper-body AI try-on, standard quality only",
        ],
    },
    {
        "kind": "section",
        "title": "1. Executive Summary",
        "paragraphs": [
            "DrapixAI is a B2B AI virtual try-on platform for fashion ecommerce. It is being built as a controlled rollout product rather than a broad, hands-off consumer AI tool.",
            "The current product focus is upper-body garments only. The system emphasizes garment validation, confirmed product mapping, cached garment assets, quality controls, and operational readiness before scale.",
        ],
    },
    {
        "kind": "section",
        "title": "2. What The Product Does",
        "bullets": [
            "Lets a brand create an account and obtain an API key.",
            "Accepts isolated garment images and validates them before use.",
            "Preprocesses garments into cached assets for repeatable try-on quality.",
            "Syncs product catalog data and suggests garment-to-product matches.",
            "Requires manual confirmation of final product mappings before storefront traffic uses them.",
            "Generates shopper try-on outputs from a shopper photo plus confirmed product identifier.",
            "Returns response metadata such as quality score, latency, warnings, engine, and cache state.",
        ],
    },
    {
        "kind": "section",
        "title": "3. Current Launch Scope",
        "paragraphs": [
            "Launch-ready categories are focused on upper-body garments. Stronger categories include shirts, t-shirts, polos, blouses, and clean tops. Short kurtis, hoodies, and sweatshirts are more cautious categories.",
            "The product should not currently promise full-body support, every apparel class, or a universal cross-platform rollout. Full-body is positioned as future work rather than part of the current public launch promise.",
        ],
    },
    {
        "kind": "section",
        "title": "4. Customer Workflow",
        "bullets": [
            "Create account and log in.",
            "Receive or rotate API key.",
            "Upload garment-only images.",
            "Run garment validation and cache generation.",
            "Sync catalog products into the dashboard.",
            "Review suggested matches.",
            "Confirm the correct garment-to-product pairings manually.",
            "Install the browser SDK or call the REST API.",
            "Send shopper photo plus confirmed product context.",
            "Receive try-on image and metadata.",
        ],
    },
    {
        "kind": "section",
        "title": "5. Product Features",
        "bullets": [
            "Authentication: email/password signup, OTP verification, login, optional Google OAuth.",
            "Dashboard: usage visibility, analytics, account settings, and plan visibility.",
            "API key controls: active key lifecycle, rotation, and domain-lock behavior.",
            "Garment pipeline: upload, validation, preprocessing, cache generation, thumbnails, and approval states.",
            "Catalog flow: catalog sync, discovered products, suggested matches, and confirmed mapping.",
            "Try-on flow: SDK and REST API for standard-quality upper-body generation.",
            "Operations: readiness endpoints, admin review flows, support contacts, and email logging.",
        ],
    },
    {
        "kind": "section",
        "title": "6. Pricing And Commercial Shape",
        "bullets": [
            "Trial: 300 try-ons over 12 days.",
            "Starter: entry paid plan for smaller brands.",
            "Growth: higher-volume plan for stores with more usage.",
            "Pro: shown as future-facing / coming soon.",
            "Enterprise: sales-led custom path.",
        ],
        "paragraphs": [
            "The commercial motion is designed to be low-risk: brands validate the workflow on their own garments first, then move into paid usage only when the try-on flow is trustworthy enough for live rollout.",
            "One practical note: pricing language and some backend quota values should be reconciled before billing is treated as final.",
        ],
    },
    {
        "kind": "section",
        "title": "7. Web Stack",
        "bullets": [
            "Framework: Next.js 16.",
            "Frontend runtime: React 18.",
            "Styling: Tailwind CSS.",
            "Session/auth integration: NextAuth.",
            "Public pages include homepage, pricing, help, contact, auth flows, dashboard, admin, and settings-related views.",
        ],
    },
    {
        "kind": "section",
        "title": "8. Backend Stack",
        "bullets": [
            "Runtime: Node.js with Express and TypeScript.",
            "ORM and schema layer: Prisma.",
            "Primary data store: PostgreSQL.",
            "Queue/cache coordination: Redis.",
            "Email delivery: Nodemailer via SMTP.",
            "Scheduled background work: node-cron.",
        ],
        "paragraphs": [
            "The API is organized around auth routes, SDK routes, analytics routes, admin routes, account routes, and public routes. It also exposes health and ready checks for operations.",
        ],
    },
    {
        "kind": "section",
        "title": "9. AI Stack",
        "bullets": [
            "Runtime: Python FastAPI service.",
            "Core try-on engine: CatVTON pipeline.",
            "Garment pipeline: preprocessing, validation, cache storage, and retrieval.",
            "Request safety: internal service token for API-to-AI calls.",
            "Upper-body enforcement and standard-quality enforcement in the live path.",
            "Response metadata includes quality score, timings, warnings, candidate count, and garment source.",
        ],
    },
    {
        "kind": "section",
        "title": "10. Deployment Topology",
        "bullets": [
            "Edge host: public web app, API, and nginx reverse proxy.",
            "GPU host: RunPod A100 pod running AI API and worker.",
            "Managed Postgres recommended for production.",
            "Managed Redis recommended for production.",
            "S3-compatible object storage used for uploads, outputs, and thumbnails.",
            "SMTP provider used for OTP and transactional email.",
            "Optional Google OAuth for sign-in.",
        ],
        "paragraphs": [
            "The repo already contains Dockerfiles, environment templates, nginx config, RunPod bootstrap scripts, environment validation scripts, smoke tests, and health-check helpers.",
        ],
    },
    {
        "kind": "section",
        "title": "11. Recommended AI Runtime",
        "bullets": [
            "Preferred live environment: RunPod Ubuntu GPU stack.",
            "Preferred GPU: A100 PCIe 80GB.",
            "Base image: runpod/pytorch 2.4.0 with Python 3.11 and CUDA 12.4.1.",
            "Preset path: DRAPIXAI_GPU_PRESET=runpod-a100.",
            "Warm latency target: about 10 to 12 seconds.",
            "Model preload is enabled on the A100 path to reduce cold-start impact.",
        ],
        "paragraphs": [
            "Project docs explicitly say that Windows or local output should not be treated as the final production quality gate. The production quality gate is the Linux RunPod GPU path.",
        ],
    },
    {
        "kind": "section",
        "title": "12. Core Data Model",
        "bullets": [
            "User: account, company, plan, trial, store verification, and catalog sync metadata.",
            "ApiKey: active key storage and domain whitelist.",
            "Usage and UsageDaily: monthly and daily consumption tracking.",
            "Garment: garment assets, cache keys, thumbnails, status, and source references.",
            "CatalogProduct: discovered or synced product catalog items.",
            "GarmentMatch: suggested and confirmed mapping between garment and product.",
            "TryOnResult: generated result image, quality score, timing, warnings, and approval status.",
            "TryOnFeedback: manual realism or defect review data.",
            "EmailLog: OTP and transactional email tracking.",
            "VerificationCode: OTP and email verification support.",
        ],
    },
    {
        "kind": "section",
        "title": "13. Security And Operational Controls",
        "bullets": [
            "Helmet and CORS protections on the API.",
            "JWT-based account auth.",
            "Bcrypt hashing for passwords and API keys.",
            "Single-domain enforcement behavior for API keys in the live SDK path.",
            "Readiness checks across database, Redis, AI, and storage.",
            "Admin review filters for low quality, high latency, warnings, and cache issues.",
            "Email send logging for supportability.",
        ],
    },
    {
        "kind": "section",
        "title": "14. Marketing And Go-To-Market Assets",
        "bullets": [
            "Go-to-market strategy document.",
            "Video scripts and production kit.",
            "Prelaunch partner brief.",
            "Cold outbound email sequence and sender setup guide.",
            "Growth experiments and omnichannel roadmap.",
            "Segmented email templates for growth and enterprise accounts.",
            "Lead templates and a marketing-agent operating framework.",
        ],
        "paragraphs": [
            "The repository already contains a substantial founder-led marketing pack. That means the business side of launch has been prepared alongside the product and infrastructure.",
        ],
    },
    {
        "kind": "section",
        "title": "15. Launch Readiness",
        "paragraphs": [
            "The codebase appears structurally close to launch. Deployment documentation, environment templates, health checks, smoke-test scripts, AI presets, and support playbooks are already in place.",
            "However, the project docs still call out a few live blockers that matter before public launch.",
        ],
        "bullets": [
            "Live RunPod A100 validation.",
            "Real SMTP verification.",
            "Optional Google OAuth verification if exposed publicly.",
            "At least one successful end-to-end public try-on on the Linux GPU path.",
        ],
    },
    {
        "kind": "section",
        "title": "16. Practical Assessment",
        "paragraphs": [
            "DrapixAI should be understood as a controlled AI commerce system, not just an image-generation feature. Its real value comes from combining garment preparation, product mapping, AI generation, analytics, and launch operations into one commerce workflow.",
            "From the repository state, the project already shows serious product, engineering, and go-to-market preparation. The main remaining work is live production proof on the target A100 stack and finalizing the external infrastructure pieces needed for a safe public launch.",
        ],
    },
    {
        "kind": "section",
        "title": "17. Source Snapshot Used For This Brief",
        "bullets": [
            "deploy.md",
            "deploy/production-readiness.md",
            "deploy/launch-support-playbook.md",
            "apps/web/app/page.tsx",
            "apps/web/app/pricing/page.tsx",
            "apps/web/app/help/page.tsx",
            "apps/web/app/contact/page.tsx",
            "apps/api/prisma/schema.prisma",
            "apps/api/src/server.ts",
            "apps/api/src/routes/auth.ts",
            "apps/api/src/routes/sdk.ts",
            "apps/api/src/routes/analytics.ts",
            "apps/api/src/services/emailer.ts",
            "drapixai_ai/api/ai_server.py",
            "drapixai_ai/configs/settings.py",
            "marketing/README.md",
        ],
    },
]


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def estimate_line_width(text: str, font_size: int) -> float:
    return len(text) * font_size * 0.53


def wrap_text(text: str, font_size: int, extra_indent: int = 0) -> list[str]:
    words = [word for word in str(text).split() if word]
    max_width = CONTENT_WIDTH - extra_indent
    lines: list[str] = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        if estimate_line_width(candidate, font_size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def create_document_lines() -> list[dict]:
    lines: list[dict] = []

    for section in SECTIONS:
        if section["kind"] == "cover":
            lines.append({"text": section["title"], "size": 28, "font": "F2", "gap_before": 40, "gap_after": 10})
            lines.append({"text": section["subtitle"], "size": 13, "font": "F1", "gap_after": 18})
            for item in section["meta"]:
                lines.append({"text": item, "size": 11, "font": "F1", "gap_after": 2})
            lines.append({"text": "", "size": 12, "font": "F1", "gap_after": 22})
            continue

        lines.append({"text": section["title"], "size": 17, "font": "F2", "gap_before": 12, "gap_after": 8})

        for paragraph in section.get("paragraphs", []):
            lines.append({"text": paragraph, "size": 11, "font": "F1", "paragraph": True, "gap_after": 8})

        for bullet in section.get("bullets", []):
            lines.append({"text": bullet, "size": 11, "font": "F1", "bullet": True, "gap_after": 3})

        lines.append({"text": "", "size": 10, "font": "F1", "gap_after": 8})

    return lines


def paginate(lines: list[dict]) -> list[list[dict]]:
    pages: list[list[dict]] = []
    page: list[dict] = []
    y = PAGE_HEIGHT - MARGIN_TOP

    def commit_page() -> None:
        nonlocal page, y
        pages.append(page)
        page = []
        y = PAGE_HEIGHT - MARGIN_TOP

    for entry in lines:
        font_size = entry.get("size", 11)
        leading = font_size + 4
        indent = 18 if entry.get("bullet") else 0
        prefix = "- " if entry.get("bullet") else ""
        wrapped = wrap_text(prefix + entry["text"], font_size, indent) if entry["text"] else [""]
        required_height = max(leading * len(wrapped), leading) + entry.get("gap_before", 0) + entry.get("gap_after", 0)

        if y - required_height < MARGIN_BOTTOM:
            commit_page()

        y -= entry.get("gap_before", 0)

        for index, text in enumerate(wrapped):
            x = MARGIN_X + (indent if entry.get("bullet") and index > 0 else 0)
            page.append({
                "x": x,
                "y": y,
                "text": text,
                "size": font_size,
                "font": entry.get("font", "F1"),
            })
            y -= leading

        y -= entry.get("gap_after", 0)

    if page:
        pages.append(page)

    final_pages: list[list[dict]] = []
    total = len(pages)
    for index, items in enumerate(pages, start=1):
        annotated = list(items)
        annotated.append({
            "x": PAGE_WIDTH - MARGIN_X - 70,
            "y": 24,
            "text": f"Page {index} of {total}",
            "size": 10,
            "font": "F1",
        })
        final_pages.append(annotated)

    return final_pages


def build_content_stream(lines: list[dict]) -> str:
    commands = []
    for line in lines:
        text = escape_pdf_text(line["text"])
        commands.append(
            f"BT /{line['font']} {line['size']} Tf 1 0 0 1 {line['x']:.2f} {line['y']:.2f} Tm ({text}) Tj ET"
        )
    return "\n".join(commands)


def build_pdf(pages: list[list[dict]]) -> bytes:
    objects: dict[int, str] = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{' '.join(f'{5 + i * 2} 0 R' for i in range(len(pages)))}] /Count {len(pages)} >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    }

    for index, page_lines in enumerate(pages):
        page_object = 5 + index * 2
        content_object = page_object + 1
        stream = build_content_stream(page_lines)
        objects[page_object] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_object} 0 R >>"
        )
        objects[content_object] = f"<< /Length {len(stream.encode('utf-8'))} >>\nstream\n{stream}\nendstream"

    pdf = "%PDF-1.4\n"
    offsets = {0: 0}

    for object_number in range(1, max(objects) + 1):
        offsets[object_number] = len(pdf.encode("utf-8"))
        pdf += f"{object_number} 0 obj\n{objects[object_number]}\nendobj\n"

    xref_offset = len(pdf.encode("utf-8"))
    pdf += f"xref\n0 {max(objects) + 1}\n"
    pdf += "0000000000 65535 f \n"

    for object_number in range(1, max(objects) + 1):
        pdf += f"{offsets[object_number]:010d} 00000 n \n"

    pdf += f"trailer\n<< /Size {max(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF"
    return pdf.encode("utf-8")


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = create_document_lines()
    pages = paginate(lines)
    OUTPUT_PATH.write_bytes(build_pdf(pages))
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
