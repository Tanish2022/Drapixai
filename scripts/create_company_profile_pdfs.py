from __future__ import annotations

from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
BRAND_DIR = ROOT / "output" / "brand"
WEBSITE_DIR = ROOT / "output" / "website"

GREEN = colors.HexColor("#123F34")
TEAL = colors.HexColor("#317B7A")
MINT = colors.HexColor("#DCEDE3")
PALE = colors.HexColor("#F4F7F3")
INK = colors.HexColor("#172019")
MUTED = colors.HexColor("#5D6961")
LINE = colors.HexColor("#D7DDD7")
WHITE = colors.white


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="Times-Bold",
            fontSize=28,
            leading=31,
            textColor=INK,
            spaceAfter=10,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=12,
            leading=18,
            textColor=MUTED,
        ),
        "eyebrow": ParagraphStyle(
            "Eyebrow",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=TEAL,
            spaceAfter=7,
        ),
        "h1": ParagraphStyle(
            "Heading1",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=23,
            leading=27,
            textColor=INK,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=GREEN,
            spaceBefore=9,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.3,
            leading=14.2,
            textColor=MUTED,
            spaceAfter=7,
        ),
        "body_small": ParagraphStyle(
            "BodySmall",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=11.5,
            textColor=MUTED,
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.2,
            leading=11,
            textColor=GREEN,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=11.5,
            textColor=MUTED,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=13.3,
            leftIndent=12,
            firstLineIndent=-8,
            textColor=MUTED,
            spaceAfter=4,
        ),
        "metric": ParagraphStyle(
            "Metric",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=20,
            alignment=TA_CENTER,
            textColor=GREEN,
        ),
        "metric_label": ParagraphStyle(
            "MetricLabel",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=10,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
        "website_title": ParagraphStyle(
            "WebsiteTitle",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=22,
            leading=25,
            textColor=INK,
            alignment=TA_LEFT,
        ),
    }


STYLES = styles()


def footer(canvas, document) -> None:
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(document.leftMargin, 12 * mm, A4[0] - document.rightMargin, 12 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(document.leftMargin, 8 * mm, "DrapixAI - Detailed business profile")
    canvas.drawRightString(A4[0] - document.rightMargin, 8 * mm, f"Page {document.page}")
    canvas.restoreState()


def website_footer(canvas, document) -> None:
    page_width, _ = landscape(A4)
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(document.leftMargin, 10 * mm, page_width - document.rightMargin, 10 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(document.leftMargin, 6 * mm, "DrapixAI website overview - Local production build")
    canvas.drawRightString(page_width - document.rightMargin, 6 * mm, f"Page {document.page}")
    canvas.restoreState()


def bullet(text: str) -> Paragraph:
    return Paragraph(f"- {text}", STYLES["bullet"])


def section_title(number: str, title: str) -> list:
    return [
        Paragraph(number.upper(), STYLES["eyebrow"]),
        Paragraph(title, STYLES["h1"]),
        HRFlowable(width="100%", thickness=0.7, color=LINE, spaceAfter=8),
    ]


def cover_block(title: str, subtitle: str) -> list:
    logo = Image(str(BRAND_DIR / "DrapixAI_Logo_HD_4096.png"), width=150 * mm, height=50 * mm)
    return [
        Spacer(1, 18 * mm),
        logo,
        Spacer(1, 24 * mm),
        Paragraph("DRAPIXAI", STYLES["eyebrow"]),
        Paragraph(title, STYLES["cover_title"]),
        Paragraph(subtitle, STYLES["cover_subtitle"]),
        Spacer(1, 12 * mm),
        Table(
            [[Paragraph("Fashion commerce", STYLES["metric_label"]), Paragraph("Standard quality pipeline", STYLES["metric_label"]), Paragraph("Privacy-first", STYLES["metric_label"])]],
            colWidths=[55 * mm, 55 * mm, 55 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), PALE),
                    ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        ),
        Spacer(1, 68 * mm),
        Paragraph(f"Prepared {date.today().strftime('%d %B %Y')}", STYLES["body_small"]),
    ]


def create_logo_pdf() -> Path:
    output = OUTPUT_DIR / "DrapixAI_Logo_Brand_Sheet.pdf"
    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
    )
    logo = Image(str(BRAND_DIR / "DrapixAI_Logo_HD_4096.png"), width=148 * mm, height=49.3 * mm)
    emblem = Image(str(BRAND_DIR / "DrapixAI_Emblem_HD_2048.png"), width=50 * mm, height=50 * mm)
    story = [
        Paragraph("OFFICIAL BRAND ASSET", STYLES["eyebrow"]),
        Paragraph("DrapixAI Logo Brand Sheet", STYLES["cover_title"]),
        Paragraph("High-resolution master prepared from the supplied final logo without redesigning the mark, lettering, proportions, or colors.", STYLES["cover_subtitle"]),
        Spacer(1, 5 * mm),
        Table([[logo]], colWidths=[174 * mm], rowHeights=[54 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER")])),
        Spacer(1, 4 * mm),
        Paragraph("Primary emblem", STYLES["h2"]),
        Table([[emblem, Paragraph("Use the emblem for favicons, app icons, compact navigation, social avatars, and square placements. Keep clear space around every tip and do not crop, rotate, recolor, or add shadows.", STYLES["body"])]], colWidths=[75 * mm, 99 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)])),
        Spacer(1, 3 * mm),
        Paragraph("Delivered masters", STYLES["h2"]),
        bullet("DrapixAI_Logo_HD_4096.png - 4096-pixel-wide white-background master."),
        bullet("DrapixAI_Logo_HD_Transparent_4096.png - transparent web and presentation master."),
        bullet("DrapixAI_Emblem_HD_2048.png - transparent square emblem master."),
        Paragraph("Color direction", STYLES["h2"]),
        Paragraph("The mark uses forest green, muted sage, teal, and blue-green gradients. Maintain those relationships and use light, uncluttered backgrounds for the full wordmark.", STYLES["body"]),
    ]
    document.build(story)
    return output


def create_business_pdf() -> Path:
    output = OUTPUT_DIR / "DrapixAI_Business_Model_and_Operations.pdf"
    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    story = cover_block(
        "Business Model, Operations, and Company Details",
        "A detailed commercial briefing covering DrapixAI's services, customers, value proposition, delivery model, pricing, revenue streams, operating costs, customer lifecycle, growth strategy, scalability, business risks, and future direction.",
    )
    story.append(PageBreak())
    story.extend(section_title("01", "Executive Overview"))
    story.append(Paragraph("DrapixAI is building garment-faithful virtual try-on infrastructure for fashion brands and ecommerce storefronts. The product allows a shopper to upload a front-facing image, select an approved product, and receive a realistic try-on preview while the platform protects garment color, structure, print, sleeve, hem, collar, texture, body shape, face, and pose.", STYLES["body"]))
    story.append(Paragraph("The current public-launch scope is intentionally focused: upper-body garments, one Standard quality mode, approved garment caches, quality-gated results, and controlled storefront publication. This creates a dependable operating model before expansion into lower-body, full-body, dresses, accessories, jewellery, and other future virtual-try-on categories.", STYLES["body"]))
    metrics = [
        [Paragraph("0.95", STYLES["metric"]), Paragraph("Standard", STYLES["metric"]), Paragraph("10-12s", STYLES["metric"])],
        [Paragraph("Reference quality target", STYLES["metric_label"]), Paragraph("Single production mode", STYLES["metric_label"]), Paragraph("Warm latency target", STYLES["metric_label"])],
    ]
    story.append(Table(metrics, colWidths=[58 * mm] * 3, style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)])))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Business purpose", STYLES["h2"]))
    for item in [
        "Increase shopper confidence by showing the brand's real product on the shopper rather than a generic look-alike.",
        "Give fashion brands a controlled, brand-native try-on experience on product pages and mobile-compatible web integrations.",
        "Provide measurable quality, latency, warnings, approval status, and garment accuracy instead of presenting AI output as an unreviewed black box.",
        "Reduce onboarding friction through approved garment caching, Shopify synchronization, storefront SDK integration, and a public REST API path.",
    ]:
        story.append(bullet(item))

    story.append(PageBreak())
    story.extend(section_title("02", "Market Problem and DrapixAI Solution"))
    problem_solution = [
        [Paragraph("Market problem", STYLES["h2"]), Paragraph("DrapixAI response", STYLES["h2"])],
        [Paragraph("Shoppers cannot confidently judge fit, garment appearance, sleeve behavior, color, or silhouette from flat product photos alone.", STYLES["body"]), Paragraph("A shopper-facing try-on preview uses the selected product's approved garment asset and returns a quality-scored result.", STYLES["body"])],
        [Paragraph("Generic AI try-on can change the person, garment identity, print, background, or pose.", STYLES["body"]), Paragraph("DrapixAI validates inputs, scores garment and identity preservation, ranks results, and rejects unacceptable outputs.", STYLES["body"])],
        [Paragraph("Brands need fast integration without giving up design control or customer trust.", STYLES["body"]), Paragraph("The storefront SDK adapts to brand colors and typography, while API integration remains available for custom applications.", STYLES["body"])],
        [Paragraph("AI infrastructure can become unreliable under concurrent demand.", STYLES["body"]), Paragraph("Redis queues, per-tenant limits, GPU batching targets, worker isolation, monitoring, and a controlled three-shopper capacity plan protect service quality.", STYLES["body"])],
    ]
    story.append(Table(problem_solution, colWidths=[87 * mm, 87 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)])))
    story.append(Paragraph("Current garment scope", STYLES["h2"]))
    story.append(Paragraph("The launch target covers front-facing upper-body garments such as shirts, T-shirts, polos, hoodies and sweatshirts, blouses and tops, short kurtis, and sleeveless tops. Full-body and complex layered garments remain future scope until they meet the same realism, latency, privacy, and security bar.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("03", "Product and Customer Experience"))
    workflow = [
        ["01", "Connect", "Install the Shopify app, synchronize a catalog, or register products through the dashboard/API."],
        ["02", "Prepare", "Validate the garment-only image, normalize it, remove unsuitable backgrounds, and create a reusable high-quality cache."],
        ["03", "Approve", "Confirm the garment-to-product mapping and review product-accuracy evidence before storefront publication."],
        ["04", "Try on", "The shopper uploads a permitted front-facing photo and explicitly accepts transient processing."],
        ["05", "Generate", "The DrapixAI Standard pipeline creates one quality-controlled result using the approved garment cache."],
        ["06", "Deliver", "The SDK or API returns image bytes plus quality, latency, warning, engine, and cache metadata."],
    ]
    story.append(Table([[Paragraph("Step", STYLES["eyebrow"]), Paragraph("Stage", STYLES["eyebrow"]), Paragraph("What happens", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body"]), Paragraph(b, STYLES["body"]), Paragraph(c, STYLES["body"])] for a, b, c in workflow], colWidths=[18 * mm, 32 * mm, 124 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))
    story.append(Paragraph("Storefront experience", STYLES["h2"]))
    for item in [
        "Native-looking modal that can inherit brand color, typography, buttons, and surface styling.",
        "Clear photo permission and privacy notice before upload, linked to the current privacy policy.",
        "Download and buy actions after a successful preview.",
        "Polite retry or rejection state when quality, identity, pose, garment color, or realism falls below the publication threshold.",
    ]:
        story.append(bullet(item))

    story.append(PageBreak())
    story.extend(section_title("04", "Technology and Operating Architecture"))
    architecture = [
        ["Layer", "Current technology", "Business role"],
        ["Storefront", "Next.js, React, Shopify Theme App Extension, browser SDK", "Shopper experience and brand integration"],
        ["API", "Node.js, Express, TypeScript, Prisma", "Authentication, tenant rules, quotas, public API, admin workflows"],
        ["Data", "PostgreSQL, Redis, S3/MinIO-compatible storage", "Records, queueing, cached garment assets, operational evidence"],
        ["AI", "FastAPI, Python 3.11, PyTorch, DrapixAI VTON engine, Pillow, OpenCV, NumPy", "Preprocessing, generation, quality scoring, result delivery"],
        ["GPU", "A100 validation path; RTX PRO 6000 Blackwell target", "Warm model serving and controlled concurrent processing"],
        ["Operations", "Docker, private networking, monitoring, release evidence", "Repeatable deployment, isolation, rollback, and auditability"],
    ]
    story.append(Table([[Paragraph(cell, STYLES["eyebrow"]) for cell in architecture[0]]] + [[Paragraph(cell, STYLES["body_small"]) for cell in row] for row in architecture[1:]], colWidths=[28 * mm, 66 * mm, 80 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))
    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Quality system", STYLES["h2"]))
    story.append(Paragraph("DrapixAI treats realism as an operating system, not a single model call. The pipeline combines person validation, garment analysis, image normalization, mask construction, AI generation, candidate rules, quality scoring, warning generation, product-accuracy reporting, admin review, and automatic rejection of bad results.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("05", "Privacy, Security, and Trust"))
    for item in [
        "Shopper photos and generated previews are processed transiently and are not intentionally stored in the application database or object storage.",
        "Interrupted jobs use a bounded cleanup window; image bytes and base64 payloads are excluded from application logs.",
        "Shopper photos and generated previews are not used to train DrapixAI or third-party AI models.",
        "Explicit shopper permission and the applicable privacy-policy version are required before generation and recorded as metadata-only audit evidence.",
        "Tenant isolation, short-lived storefront tokens, rate limits, concurrency limits, immutable audit logs, retention controls, key rotation, private services, container scanning, and staged attack testing form the public-launch security program.",
        "Public launch remains blocked until all required technical, operational, legal, penetration-test, and controlled-pilot evidence is independently verified.",
    ]:
        story.append(bullet(item))
    story.append(Paragraph("Indian legal readiness", STYLES["h2"]))
    story.append(Paragraph("The company is preparing its privacy policy, terms, merchant data-processing agreement, subprocessor register, consent wording, data-request workflow, incident process, refunds, taxation, and intellectual-property records for qualified Indian legal review. The final legal gate must be signed by counsel against the exact production release and actual vendor list.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("06", "Commercial Model and Differentiation"))
    story.append(Paragraph("Revenue channels", STYLES["h2"]))
    for item in [
        "Monthly storefront SDK plans with included try-on quota.",
        "REST API usage plans drawing from the same Standard-quality quota.",
        "Enterprise onboarding, dedicated deployment, support, and service-level agreements.",
        "Garment onboarding and DrapixAI-Ready product certification services.",
        "Catalog-generation and quality-review services for brand sales and merchandising teams.",
    ]:
        story.append(bullet(item))
    story.append(Paragraph("Why DrapixAI can stand apart", STYLES["h2"]))
    differentiation = [
        ["Garment fidelity", "Color, print, logo, sleeve, hem, collar, and texture are measured and reviewed."],
        ["Brand control", "The experience stays on the merchant storefront and adapts to the brand's visual system."],
        ["Quality transparency", "Every result can expose quality, warnings, latency, engine, cache status, and confidence."],
        ["Privacy posture", "Shopper photos are transient-only and excluded from training."],
        ["One quality path", "SDK and API must use the same Standard pipeline for identical input quality."],
        ["Launch discipline", "Products are prepared and approved before shopper traffic; bad outputs are rejected."],
    ]
    story.append(Table([[Paragraph("Differentiator", STYLES["eyebrow"]), Paragraph("DrapixAI approach", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"])] for a, b in differentiation], colWidths=[48 * mm, 126 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))

    story.append(PageBreak())
    story.extend(section_title("07", "Target Market and Customer Segments"))
    story.append(Paragraph("DrapixAI operates at the intersection of Fashion Technology, Artificial Intelligence, Computer Vision, Retail Technology, and ecommerce infrastructure. The initial market focus is fashion businesses that need a practical virtual try-on capability but do not want to build and operate their own AI, GPU, privacy, quality-review, and storefront integration systems.", STYLES["body"]))
    customer_segments = [
        ["Digital-first fashion brands", "Need a fast, brand-native try-on experience for product pages without a large internal engineering team."],
        ["Mid-market apparel retailers", "Need catalog onboarding, product mapping, garment approval, analytics, and predictable monthly usage."],
        ["Large fashion enterprises", "Need APIs, dedicated capacity, tenant isolation, service-level commitments, security review, and controlled rollout."],
        ["Shopify merchants", "Need automatic catalog synchronization and a Theme App Extension rather than custom storefront development."],
        ["Marketplaces and commerce platforms", "Need a versioned API and multi-tenant controls for try-on inside existing customer journeys."],
        ["Agencies and technology partners", "Need an integration layer they can deploy for brand clients without operating the AI stack themselves."],
    ]
    story.append(Table([[Paragraph("Customer segment", STYLES["eyebrow"]), Paragraph("Primary requirement", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"])] for a, b in customer_segments], colWidths=[52 * mm, 122 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("Buying stakeholders", STYLES["h2"]))
    story.append(Paragraph("The typical buying group includes founders, ecommerce heads, digital product managers, merchandising teams, technology leaders, privacy and security reviewers, and customer-experience teams. DrapixAI gives each stakeholder measurable evidence: garment accuracy, integration effort, usage, latency, warnings, privacy behavior, and approval status.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("08", "Pricing, Revenue Model, and Go-to-Market"))
    story.append(Paragraph("Planned subscription structure", STYLES["h2"]))
    pricing = [
        ["Starter", "$49 per month", "1,000 successful try-ons", "$0.049 per successful result"],
        ["Growth", "$199 per month", "7,500 successful try-ons", "$0.0265 per successful result"],
        ["Pro", "$499 per month", "25,000 successful try-ons", "$0.0200 per successful result"],
        ["Enterprise", "Custom", "100,000+ or dedicated capacity", "Contracted volume, onboarding, support, and SLA"],
    ]
    story.append(Table([[Paragraph("Plan", STYLES["eyebrow"]), Paragraph("Price", STYLES["eyebrow"]), Paragraph("Included usage", STYLES["eyebrow"]), Paragraph("Commercial basis", STYLES["eyebrow"])]] + [[Paragraph(cell, STYLES["body_small"]) for cell in row] for row in pricing], colWidths=[28 * mm, 36 * mm, 50 * mm, 60 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Billing principle", STYLES["h2"]))
    story.append(Paragraph("The storefront SDK and REST API draw from the same monthly allowance and use the same Standard quality pipeline. The planned billable unit is the first successful, publishable result. Quality rejections, validation failures, idempotent retries, token exchange, usage reads, webhooks, and OpenAPI access are not intended to consume another unit. Commercial terms remain subject to final launch approval and customer contracts.", STYLES["body"]))
    story.append(Paragraph("Go-to-market sequence", STYLES["h2"]))
    for item in [
        "Recruit three to five controlled pilot brands with supported upper-body products.",
        "Prepare and certify a limited garment catalog, then measure quality, latency, retry rate, engagement, and conversion indicators.",
        "Convert pilot evidence into before-and-after catalogs, implementation guides, and customer case studies.",
        "Distribute through direct founder-led sales, Shopify discovery, developer/API adoption, agency partnerships, and fashion-technology networks.",
        "Expand usage and dedicated capacity only after operational, security, privacy, and customer-success evidence remains stable.",
    ]:
        story.append(bullet(item))

    story.append(PageBreak())
    story.extend(section_title("09", "Operating Model, Cost Structure, and Scalability"))
    story.append(Paragraph("How the service is delivered", STYLES["h2"]))
    story.append(Paragraph("DrapixAI is designed as a recurring software and AI-infrastructure service. Brands subscribe to a plan or negotiate an enterprise agreement, onboard and approve garments, integrate the storefront SDK, Shopify app, or REST API, and then consume successful try-on results from their allowance. DrapixAI operates the preparation, generation, quality, queueing, security, observability, and support layers behind that experience.", STYLES["body"]))
    operating_costs = [
        ["GPU inference", "Generation time, warm capacity, concurrency, idle capacity, and failover resources."],
        ["Data infrastructure", "PostgreSQL, Redis, object storage for approved garment assets, backups, monitoring, and transfer."],
        ["Engineering and operations", "AI quality work, software development, DevOps, security, testing, releases, and incident response."],
        ["Customer onboarding", "Catalog preparation, product mapping, garment review, integration assistance, and certification."],
        ["Sales and customer success", "Brand acquisition, demonstrations, pilot management, support, renewals, and account expansion."],
        ["Legal and compliance", "Contracts, privacy review, security testing, insurance, taxation, and vendor governance."],
    ]
    story.append(Table([[Paragraph("Primary cost driver", STYLES["eyebrow"]), Paragraph("What creates the cost", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"])] for a, b in operating_costs], colWidths=[48 * mm, 126 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Gross-margin and scalability levers", STYLES["h2"]))
    for item in [
        "Reusable garment caches avoid repeating product preparation on every shopper request.",
        "Warm workers, queue control, measured concurrency, and workload scheduling increase productive GPU utilization.",
        "Automatic validation and quality rejection reduce manual review and prevent low-value results from reaching shoppers.",
        "Self-service Shopify and SDK onboarding reduce custom engineering effort for repeatable customer segments.",
        "Tenant quotas, usage plans, and dedicated enterprise capacity align revenue with service consumption and operating load.",
    ]:
        story.append(bullet(item))

    story.append(PageBreak())
    story.extend(section_title("10", "Customer Lifecycle and Success Model"))
    lifecycle = [
        ["01", "Qualification", "Confirm garment category, storefront, expected volume, target geography, and integration path."],
        ["02", "Trial", "Evaluate approved products through the Standard pipeline before committing to public rollout."],
        ["03", "Onboarding", "Connect the catalog, prepare garment assets, confirm mappings, and configure brand-native UI."],
        ["04", "Activation", "Complete one storefront or API try-on, validate actions and metadata, then enable approved products."],
        ["05", "Adoption", "Monitor shopper usage, accepted results, latency, warnings, retries, product coverage, and support needs."],
        ["06", "Expansion", "Add more products, stores, traffic, team members, API use cases, or dedicated capacity."],
        ["07", "Renewal", "Review service outcomes, reliability, security evidence, support performance, and the next commercial term."],
    ]
    story.append(Table([[Paragraph("Step", STYLES["eyebrow"]), Paragraph("Stage", STYLES["eyebrow"]), Paragraph("Business activity", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"]), Paragraph(c, STYLES["body_small"])] for a, b, c in lifecycle], colWidths=[18 * mm, 34 * mm, 122 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Customer success promise", STYLES["h2"]))
    story.append(Paragraph("DrapixAI should not treat installation as the end of the sale. The ongoing service includes garment readiness, quality visibility, incident communication, documentation, usage insight, support, capacity planning, and controlled expansion. This operating relationship is important for renewal because try-on quality and storefront reliability affect the brand's customer experience directly.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("11", "Business Metrics and Management Dashboard"))
    metrics_table = [
        ["Commercial", "Trial-to-paid conversion, monthly recurring revenue, average revenue per brand, expansion revenue, churn, renewal rate."],
        ["Customer adoption", "Mapped products, approved caches, enabled products, active shoppers, try-ons per active product, repeat usage."],
        ["Quality", "Accepted-result rate, average quality score, warning-free rate, retry rate, rejection reasons, garment-category performance."],
        ["Performance", "Queue time, generation time, total latency, timeout rate, GPU utilization, requests per worker, concurrent capacity."],
        ["Reliability", "Availability, failed jobs, queue growth, incident count, recovery time, webhook delivery, backup and restore evidence."],
        ["Support", "Onboarding time, first-response time, resolution time, ticket categories, customer satisfaction, unresolved launch blockers."],
        ["Privacy and security", "Consent evidence, deletion completion, authentication failures, suspicious usage, key rotation, audit-chain verification."],
    ]
    story.append(Paragraph("DrapixAI's business dashboard should connect revenue, adoption, AI quality, infrastructure, and trust. Growth is healthy only when customer usage increases without degrading realism, latency, privacy, or support.", STYLES["body"]))
    story.append(Table([[Paragraph("Measurement area", STYLES["eyebrow"]), Paragraph("Key indicators", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"])] for a, b in metrics_table], colWidths=[46 * mm, 128 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))

    story.append(PageBreak())
    story.extend(section_title("12", "Business Risks and Mitigation"))
    risks = [
        ["Inconsistent realism", "Poor results can damage brand trust.", "Limit supported scope, certify garments, score outputs, reject unsuitable results, and expand only after evidence."],
        ["GPU capacity pressure", "Demand can increase queue time or cause failures.", "Use per-tenant limits, queue visibility, warm capacity, concurrency testing, and planned worker expansion."],
        ["Customer concentration", "Early revenue may depend on a small number of brands.", "Diversify across plan sizes, Shopify customers, API users, agencies, and controlled enterprise accounts."],
        ["Privacy or security incident", "Shopper photos and tenant data create trust and legal risk.", "Use transient processing, private services, short-lived tokens, isolation, scanning, monitoring, response plans, and external testing."],
        ["High onboarding effort", "Manual preparation can reduce margins and slow activation.", "Automate catalog sync, garment validation, cache generation, mapping suggestions, status reporting, and self-service guidance."],
        ["Competitive pricing", "Low-cost competitors may commoditize basic try-on.", "Compete on garment fidelity, brand control, quality evidence, integration consistency, privacy, and supported-product certification."],
        ["Scope expansion too early", "Full-body or complex categories can reduce quality and distract operations.", "Keep the public promise narrow until each new category passes quality, latency, rights, and capacity gates."],
    ]
    story.append(Table([[Paragraph("Risk", STYLES["eyebrow"]), Paragraph("Business effect", STYLES["eyebrow"]), Paragraph("Mitigation", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body_small"]), Paragraph(b, STYLES["body_small"]), Paragraph(c, STYLES["body_small"])] for a, b, c in risks], colWidths=[39 * mm, 52 * mm, 83 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)])))

    story.append(PageBreak())
    story.extend(section_title("13", "Roadmap and Launch Position"))
    roadmap = [
        ["Now", "Upper-body Standard try-on, approved garment caching, SDK/API integration, quality scoring, privacy controls, security certification."],
        ["Next", "Lower-body quality proof, full-body composition planning, three-shopper GPU capacity certification, Shopify production onboarding."],
        ["Future", "Full-length dresses, one-pieces, layered outfits, accessories, jewellery, size guidance, and mobile-native integration after validation."],
    ]
    story.append(Table([[Paragraph("Horizon", STYLES["eyebrow"]), Paragraph("Focus", STYLES["eyebrow"])]] + [[Paragraph(a, STYLES["body"]), Paragraph(b, STYLES["body"])] for a, b in roadmap], colWidths=[32 * mm, 142 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)])))
    story.append(Spacer(1, 9 * mm))
    story.append(Paragraph("Current launch status", STYLES["h2"]))
    story.append(Paragraph("DrapixAI is in release-candidate and public-launch certification work. The product has strong local builds, security controls, launch documentation, and preserved quality evidence, but it should not be described as fully public-launch certified until live staging, exact container scans, privacy/retention proof, SDK/direct parity, three-tenant GPU performance, the rights-cleared 50-case matrix, operational drills, independent penetration testing, legal approval, and a controlled pilot are complete.", STYLES["body"]))
    story.append(Spacer(1, 10 * mm))
    story.append(KeepTogether([
        Paragraph("Company Profile - 3 lines", STYLES["h2"]),
        Table([[Paragraph("DrapixAI is an Indian fashion-commerce technology company building garment-faithful virtual try-on infrastructure for fashion brands and online retailers. The platform combines product preparation, privacy-first shopper photo processing, quality control, and flexible storefront, Shopify, and API integrations. DrapixAI helps businesses deliver realistic, brand-native shopping experiences while protecting garment identity and shopper trust.", STYLES["cover_subtitle"])]], colWidths=[174 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), MINT), ("BOX", (0, 0), (-1, -1), 0.8, TEAL), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)])),
    ]))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Website: drapixai.com   |   Sales: sales@drapixai.com   |   Support: support@drapixai.com   |   Privacy: privacy@drapixai.com", STYLES["body_small"]))
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output


def create_website_pdf() -> Path:
    output = OUTPUT_DIR / "DrapixAI_Website_Overview.pdf"
    page_size = landscape(A4)
    document = SimpleDocTemplate(
        str(output),
        pagesize=page_size,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
    )
    logo = Image(str(BRAND_DIR / "DrapixAI_Logo_HD_4096.png"), width=120 * mm, height=40 * mm)
    story = [
        Spacer(1, 8 * mm),
        logo,
        Spacer(1, 18 * mm),
        Paragraph("WEBSITE PROFILE", STYLES["eyebrow"]),
        Paragraph("DrapixAI Company Website and Services", STYLES["cover_title"]),
        Paragraph("A detailed, screenshot-backed guide to the DrapixAI website, virtual try-on services, brand onboarding, shopper experience, pricing, integrations, quality controls, and privacy commitments.", STYLES["cover_subtitle"]),
        Spacer(1, 12 * mm),
        Table(
            [[Paragraph("Website", STYLES["metric_label"]), Paragraph("Audience", STYLES["metric_label"]), Paragraph("Primary objective", STYLES["metric_label"])], [Paragraph("drapixai.com", STYLES["metric"]), Paragraph("Fashion brands", STYLES["metric"]), Paragraph("Trust before scale", STYLES["metric"])]],
            colWidths=[82 * mm, 82 * mm, 82 * mm],
            style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.7, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]),
        ),
        Spacer(1, 36 * mm),
        Paragraph("Screenshots captured from the refreshed local production build on 22 August 2026.", STYLES["body_small"]),
    ]
    def add_screenshot_page(title: str, description: str, filename: str) -> None:
        story.append(PageBreak())
        story.append(Paragraph("DRAPIXAI WEBSITE", STYLES["eyebrow"]))
        story.append(Paragraph(title, STYLES["website_title"]))
        story.append(Paragraph(description, STYLES["body"]))
        story.append(Spacer(1, 3 * mm))
        screenshot = Image(str(WEBSITE_DIR / filename), width=198 * mm, height=137.5 * mm)
        screenshot_frame = Table([[screenshot]], colWidths=[202 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.8, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        screenshot_frame.hAlign = "CENTER"
        story.append(screenshot_frame)

    story.append(PageBreak())
    story.extend(section_title("01", "Website Purpose and Audience"))
    story.append(Paragraph("The DrapixAI website is designed to move a fashion brand from evaluation to a controlled production integration. It explains the product promise, lets teams inspect the Standard try-on workflow, publishes transparent pricing, provides integration guidance, and documents shopper privacy before a brand exposes the feature publicly.", STYLES["body"]))
    story.append(Spacer(1, 4 * mm))
    story.append(Table(
        [
            [Paragraph("Audience", STYLES["table_head"]), Paragraph("What the website provides", STYLES["table_head"])],
            [Paragraph("Brand owner / ecommerce lead", STYLES["table_cell"]), Paragraph("Product positioning, pricing, trial entry, garment approval, launch readiness, and commercial support.", STYLES["table_cell"])],
            [Paragraph("Developer / integration team", STYLES["table_cell"]), Paragraph("Shopify, storefront SDK, and REST API setup paths with quality, latency, response, and error-handling expectations.", STYLES["table_cell"])],
            [Paragraph("Merchandising / quality team", STYLES["table_cell"]), Paragraph("Garment preparation, approved cache status, product mapping, quality evidence, warnings, and publish/reject decisions.", STYLES["table_cell"])],
            [Paragraph("Shopper", STYLES["table_cell"]), Paragraph("A brand-native try-on interface, photo permission notice, result review, download, retry, and purchase actions.", STYLES["table_cell"])],
        ],
        colWidths=[75 * mm, 185 * mm],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]),
    ))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Public website structure", STYLES["h2"]))
    story.append(Paragraph("Home explains the value proposition. Demo lets prospects judge a controlled try-on. Pricing defines quotas and counted usage. Developers describes the first integration. Help supports onboarding and troubleshooting. Privacy, Terms, Cookies, Refund Policy, Contact, Status, and Changelog provide the supporting trust and operating information.", STYLES["body"]))

    add_screenshot_page(
        "Homepage and Product Positioning",
        "The homepage presents DrapixAI as garment-faithful virtual try-on infrastructure for fashion storefronts. It communicates one production mode, a 0.95 reference quality target, a 10-12 second warm latency target, approved garment caching, quality-gated publication, brand-native UI, and direct SDK/API parity. The page intentionally emphasizes product identity and controlled operations instead of promising unrestricted AI image generation.",
        "home.png",
    )

    story.append(PageBreak())
    story.extend(section_title("02", "DrapixAI Services Explained"))
    services = [
        ("Standard upper-body try-on", "Creates one quality-controlled preview for supported upper-body garments while targeting preservation of the person, garment color, print, logo, sleeve, hem, collar, and texture."),
        ("Garment preparation and cache", "Validates a garment-only product image, normalizes it, removes unsuitable backgrounds, creates a reusable high-quality cache, and connects that approved asset to the correct product or variant."),
        ("Storefront SDK", "Adds a brand-native try-on modal to an ecommerce product page. It supports photo upload and consent, generation, quality/error states, result download, and purchase continuation."),
        ("Versioned REST API", "Supports custom websites, mobile backends, enterprise applications, and other commerce systems through short-lived tokens, idempotent requests, image-byte responses, usage controls, and webhooks."),
        ("Shopify integration", "Synchronizes products and variants, prepares eligible garment images, records product mappings, and exposes DrapixAI through a Theme App Extension without permanent storefront secrets."),
        ("Quality and review operations", "Tracks quality score, latency, warnings, engine, cache readiness, product accuracy, approval/rejection, usage, and launch-readiness evidence before results reach shoppers."),
    ]
    story.append(Table(
        [[Paragraph("Service", STYLES["table_head"]), Paragraph("What it does", STYLES["table_head"])]] + [[Paragraph(name, STYLES["table_cell"]), Paragraph(body, STYLES["table_cell"])] for name, body in services],
        colWidths=[76 * mm, 184 * mm],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]),
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Current public scope", STYLES["h2"]))
    story.append(Paragraph("The current public-launch promise is Standard upper-body try-on for supported, approved garments. Full-body, lower-body, complex layered outfits, dresses, accessories, jewellery, and size recommendation remain future scope until they pass the same realism, latency, privacy, and reliability gates.", STYLES["body"]))

    story.append(PageBreak())
    story.extend(section_title("03", "Brand and Shopper Workflows"))
    brand_steps = [
        ("01", "Connect", "Install Shopify or register a web/API workspace."),
        ("02", "Prepare", "Import or upload garment-only product images and create caches."),
        ("03", "Approve", "Confirm product mapping and review garment accuracy evidence."),
        ("04", "Integrate", "Add the Theme App Extension, storefront SDK, or REST API."),
        ("05", "Verify", "Run a real try-on and check quality, latency, warnings, and actions."),
        ("06", "Publish", "Enable only approved products and monitor live performance."),
    ]
    shopper_steps = [
        ("01", "Select product", "The shopper opens an enabled product page."),
        ("02", "Upload photo", "A clear front-facing photo is selected with explicit permission."),
        ("03", "Generate", "The request uses the approved garment cache and Standard pipeline."),
        ("04", "Quality gate", "Unacceptable identity, pose, garment, or realism changes are rejected."),
        ("05", "Review", "The shopper sees the accepted preview with a clean retry state if needed."),
        ("06", "Act", "The result can be downloaded and the shopper can continue to purchase."),
    ]
    def workflow_table(title: str, rows: list[tuple[str, str, str]]) -> Table:
        data = [[Paragraph(title, STYLES["table_head"]), "", ""]] + [[Paragraph(number, STYLES["table_cell"]), Paragraph(stage, STYLES["table_cell"]), Paragraph(body, STYLES["table_cell"])] for number, stage, body in rows]
        return Table(data, colWidths=[18 * mm, 48 * mm, 194 * mm], style=TableStyle([("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 1), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(workflow_table("Brand onboarding and publication", brand_steps))
    story.append(Spacer(1, 5 * mm))
    story.append(workflow_table("Shopper try-on experience", shopper_steps))

    add_screenshot_page(
        "Public Demo",
        "The demo gives prospects a controlled way to judge DrapixAI before creating a workspace. It asks for a clear front-facing person image and one garment-only product image, validates both inputs, runs the same Standard quality path used by the storefront SDK, and returns the result for inspection and download. A production workspace adds reusable garment caches, product mapping, analytics, review, and storefront installation.",
        "demo.png",
    )

    add_screenshot_page(
        "Pricing and Billing Model",
        "The pricing page uses a trial-first model and one shared quota for the storefront SDK and REST API. Starter is $49 for 1,000 successful results, Growth is $199 for 7,500, and Pro is $499 for 25,000. Only the first successful publishable result is counted; quality rejections, validation failures, idempotent retries, token exchange, usage reads, webhooks, and OpenAPI access are not counted. Every plan uses the same Standard quality pipeline.",
        "pricing.png",
    )

    add_screenshot_page(
        "Developer and Shopify Onboarding",
        "The developer page reduces integration to three controlled steps: connect the catalog, approve one garment, and install and verify. Shopify uses read-only catalog access, product and variant synchronization, approved garment caches, and a Theme App Extension. Custom implementations use the storefront SDK or versioned REST API. The expected first integration is about one afternoon after the required brand and product information is available.",
        "developers.png",
    )

    story.append(PageBreak())
    story.extend(section_title("04", "SDK, API, and Shopify Responsibilities"))
    story.append(Table(
        [
            [Paragraph("Integration", STYLES["table_head"]), Paragraph("Best for", STYLES["table_head"]), Paragraph("Core behavior", STYLES["table_head"])],
            [Paragraph("Storefront SDK", STYLES["table_cell"]), Paragraph("Existing ecommerce websites", STYLES["table_cell"]), Paragraph("Brand-adaptive shopper UI, domain-bound short-lived token exchange, image upload, result delivery, download/buy actions, and quality/latency callbacks.", STYLES["table_cell"])],
            [Paragraph("REST API", STYLES["table_cell"]), Paragraph("Custom web, mobile backend, and enterprise systems", STYLES["table_cell"]), Paragraph("Versioned endpoints, server credentials, short-lived client tokens, idempotency, image-byte responses, quality headers, quotas, usage reads, and webhooks.", STYLES["table_cell"])],
            [Paragraph("Shopify app", STYLES["table_cell"]), Paragraph("Shopify merchants", STYLES["table_cell"]), Paragraph("OAuth installation, read-only catalog synchronization, eligible product preparation, mapping review, cache approval, and Theme App Extension placement.", STYLES["table_cell"])],
        ],
        colWidths=[48 * mm, 70 * mm, 142 * mm],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]),
    ))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Result contract", STYLES["h2"]))
    story.append(Paragraph("A successful integration returns image bytes plus result metadata such as quality score, latency, warnings, engine, candidate count, cache state, request identifiers, and timing information. SDK and API requests with identical inputs must use the same Standard settings, approved garment cache, generation resolution, postprocessing, and quality decision so integration choice never changes realism.", STYLES["body"]))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Security expectations", STYLES["h2"]))
    story.append(Paragraph("Server keys stay in the merchant backend or secret manager. Browser and mobile clients receive short-lived, tenant-bound tokens. Product mappings and garment caches are tenant-isolated. Rate limits, quotas, per-tenant concurrency controls, idempotency, audit records, upload validation, private AI/data services, and webhook verification protect the service path.", STYLES["body"]))

    add_screenshot_page(
        "Privacy Policy and Shopper Trust",
        "The privacy page explains what DrapixAI collects, how account and service information is used, Shopify data scope, storage and retention, safeguards, third-party services, and customer rights. Shopper photos and generated previews are intended for transient try-on processing, are excluded from application logs, are not intentionally retained as normal catalog records, and are not used to train DrapixAI or third-party AI models. Explicit shopper permission is required before generation.",
        "privacy.png",
    )

    story.append(PageBreak())
    story.extend(section_title("05", "Website Readiness and Contact Paths"))
    story.append(Paragraph("The website is structured to support evaluation, onboarding, integration, launch control, and ongoing support. Public claims remain intentionally bounded to the tested Standard upper-body service. Expansion claims should be added only after the corresponding garment categories, concurrency level, privacy controls, staging evidence, and penetration-test findings have passed the launch gate.", STYLES["body"]))
    story.append(Spacer(1, 5 * mm))
    story.append(Table(
        [
            [Paragraph("Website area", STYLES["table_head"]), Paragraph("Business purpose", STYLES["table_head"])],
            [Paragraph("Demo", STYLES["table_cell"]), Paragraph("Quality evaluation before account creation.", STYLES["table_cell"])],
            [Paragraph("Pricing", STYLES["table_cell"]), Paragraph("Transparent plans, quota rules, billing definitions, and enterprise contact path.", STYLES["table_cell"])],
            [Paragraph("Developers / SDK install", STYLES["table_cell"]), Paragraph("Integration instructions, product prerequisites, Shopify setup, SDK snippets, API usage, latency, metadata, and error behavior.", STYLES["table_cell"])],
            [Paragraph("Dashboard / Admin", STYLES["table_cell"]), Paragraph("Products, mappings, caches, quality review, approvals, warnings, analytics, usage, and launch readiness.", STYLES["table_cell"])],
            [Paragraph("Help / Status / Changelog", STYLES["table_cell"]), Paragraph("Setup guidance, incident communication, troubleshooting, release communication, and support escalation.", STYLES["table_cell"])],
            [Paragraph("Legal and trust pages", STYLES["table_cell"]), Paragraph("Privacy, terms, cookies, refund policy, consent, contact, and data-rights communication.", STYLES["table_cell"])],
        ],
        colWidths=[78 * mm, 182 * mm],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), MINT), ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]),
    ))
    story.append(Spacer(1, 7 * mm))
    story.append(Paragraph("Contact paths", STYLES["h2"]))
    story.append(Paragraph("Website: drapixai.com   |   Sales: sales@drapixai.com   |   Support: support@drapixai.com   |   Privacy: privacy@drapixai.com", STYLES["body_small"]))
    document.build(story, onFirstPage=website_footer, onLaterPages=website_footer)
    return output


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = [create_logo_pdf(), create_business_pdf(), create_website_pdf()]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
