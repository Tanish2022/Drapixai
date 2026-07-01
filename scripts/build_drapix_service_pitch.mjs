import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const THREAD_ID = "manual-20260618";
const TASK_SLUG = "drapixai-service-pitch";
const TOPIC_SLUG = "drapixai-service-pitch-deck";
const ARTIFACT_UTILS_URL = new URL(`file:///${path.resolve("scripts/vendor/artifact_tool_utils.mjs").replace(/\\/g, "/")}`).href;

const WORKSPACE = path.join(os.tmpdir(), "codex-presentations", THREAD_ID, TASK_SLUG);
const TMP_DIR = path.join(WORKSPACE, "tmp");
const PREVIEW_DIR = path.join(TMP_DIR, "preview");
const QA_DIR = path.join(TMP_DIR, "qa");
const OUTPUT_DIR = path.resolve("outputs");
const FINAL_PPTX = path.join(OUTPUT_DIR, `${TOPIC_SLUG}.pptx`);

const SLIDE_SIZE = { width: 1280, height: 720 };
const FONTS = {
  title: "Aptos Display",
  body: "Aptos",
};
const COLORS = {
  bg: "#F8FAFF",
  title: "#0F172A",
  body: "#475569",
  muted: "#64748B",
  border: "#E2E8F0",
  blue: "#4F46E5",
  cyan: "#0EA5E9",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  softBlue: "#E8F1FF",
  softPurple: "#EEF0FF",
  softGreen: "#ECFDF5",
  softAmber: "#FFF7E8",
  softRed: "#FEEDEE",
  slatePanel: "#0B1120",
  slatePanelSoft: "#111827",
};

const logoPath = path.resolve("assets/branding/drapixai-final-logo.jpeg");

const slides = [
  {
    layout: "cover",
    eyebrow: "STRATEGIC PARTNER PITCH",
    title: "DrapixAI",
    subtitle:
      "A simpler, safer way for fashion brands to bring realistic virtual try-on to their online stores without jumping straight into a risky public launch.",
    tag: "Built for brands, pilots, and real rollout",
  },
  {
    layout: "cards3",
    eyebrow: "WHAT WE ARE",
    title: "What DrapixAI is",
    cards: [
      {
        title: "A virtual try-on platform",
        color: COLORS.blue,
        soft: COLORS.softPurple,
        body:
          "DrapixAI helps brands offer virtual try-on for upper-body fashion so shoppers can better imagine how a product may look before buying.",
      },
      {
        title: "A brand-friendly workflow",
        color: COLORS.amber,
        soft: COLORS.softAmber,
        body:
          "It is not only about generating an image. It gives brands a clear path from garment upload to product matching, review, preview, and launch.",
      },
      {
        title: "A controlled launch system",
        color: COLORS.green,
        soft: COLORS.softGreen,
        body:
          "We help brands move step by step instead of switching on AI for every product at once and hoping the output is good enough.",
      },
    ],
  },
  {
    layout: "cards3",
    eyebrow: "OUR OBJECTIVE",
    title: "What we want to achieve through DrapixAI",
    cards: [
      {
        title: "Make online fashion feel more real",
        color: COLORS.blue,
        soft: COLORS.softPurple,
        body:
          "We want shoppers to feel more confident when buying clothes online by giving them a more believable way to preview selected products.",
      },
      {
        title: "Help brands launch with confidence",
        color: COLORS.green,
        soft: COLORS.softGreen,
        body:
          "Our goal is to help brands test, review, and launch virtual try-on in a way that feels operationally safe and commercially sensible.",
      },
      {
        title: "Keep the experience simple",
        color: COLORS.amber,
        soft: COLORS.softAmber,
        body:
          "We want both technical teams and non-technical brand operators to understand what is happening and what needs to be approved before launch.",
      },
    ],
  },
  {
    layout: "cards3",
    eyebrow: "THE REAL PROBLEM",
    title: "What problem exists in the real world",
    cards: [
      {
        title: "Shoppers still buy with uncertainty",
        color: COLORS.red,
        soft: COLORS.softRed,
        body:
          "Even with strong product photography, many shoppers still cannot clearly imagine how an item may look on them before they purchase.",
      },
      {
        title: "Brands worry about weak AI output",
        color: COLORS.amber,
        soft: COLORS.softAmber,
        body:
          "If the try-on result looks fake, mismatched, or careless, it can damage trust faster than it improves conversion.",
      },
      {
        title: "Most teams do not want a messy setup",
        color: COLORS.blue,
        soft: COLORS.softPurple,
        body:
          "Brands want a solution that is understandable, reviewable, and manageable. They do not want a confusing workflow that only engineers can follow.",
      },
    ],
  },
  {
    layout: "solution",
    eyebrow: "HOW WE SOLVE IT",
    title: "How DrapixAI solves the problem",
    highlight: "Simple flow, controlled output, safer launch",
    body:
      "DrapixAI gives brands a structured process instead of a one-click gamble. We validate garments, connect them to real products, let teams confirm what is correct, and only then use those approved mappings in the storefront experience.",
    bullets: [
      "Cleaner garment inputs lead to better output quality",
      "Product matching keeps the system tied to real catalog items",
      "Manual confirmation reduces wrong live mappings",
      "Preview-first launch reduces public risk",
    ],
  },
  {
    layout: "cards4",
    eyebrow: "WHY IT FEELS EASIER",
    title: "Why this is easier for brands to work with",
    cards: [
      {
        title: "Clear onboarding",
        body:
          "Brands move through a visible flow instead of guessing what to do next or relying on scattered setup steps.",
      },
      {
        title: "Human review stays in the loop",
        body:
          "The final product-to-garment mapping can be checked by a real person before the storefront depends on it.",
      },
      {
        title: "Launch risk is lower",
        body:
          "Brands can test privately, run a smaller pilot, and expand only when the experience looks good enough.",
      },
      {
        title: "It works for non-technical teams too",
        body:
          "The workflow is easier to understand for founders, ecommerce operators, and brand teams, not only developers.",
      },
    ],
  },
  {
    layout: "steps",
    eyebrow: "ONBOARDING",
    title: "How brand onboarding works in DrapixAI",
    steps: [
      "Upload garments",
      "Discover products",
      "See suggested matches",
      "Confirm the right pairings",
      "Go live with approved mappings",
    ],
    note:
      "This is the part that makes the product feel simpler. A brand thinks in products and approvals, not technical setup details.",
  },
  {
    layout: "scope",
    eyebrow: "CURRENT SCOPE",
    title: "What DrapixAI is best at today",
    columns: [
      {
        heading: "Launch-ready",
        tone: "green",
        items: ["Shirts", "T-shirts", "Polos", "Blouses", "Clean tops"],
      },
      {
        heading: "Beta",
        tone: "amber",
        items: ["Short kurtis", "Hoodies", "Sweatshirts"],
      },
      {
        heading: "Not ready yet",
        tone: "red",
        items: ["Long kurtas", "Jackets", "Blazers", "Layered outerwear"],
      },
    ],
    note:
      "We prefer to be honest about scope. It is better to launch a strong upper-body experience than promise everything and disappoint the brand.",
  },
  {
    layout: "phases",
    eyebrow: "GO-LIVE PATH",
    title: "How brands can launch safely",
    phases: [
      {
        title: "Step 1",
        subtitle: "Private testing",
        body: "Check garment quality and output realism internally before showing the experience to shoppers.",
      },
      {
        title: "Step 2",
        subtitle: "Small pilot",
        body: "Use a focused set of products so the team can review results carefully and learn what works best.",
      },
      {
        title: "Step 3",
        subtitle: "Selected live launch",
        body: "Turn it on for chosen SKUs or a smaller storefront segment rather than the full catalog at once.",
      },
      {
        title: "Step 4",
        subtitle: "Scale gradually",
        body: "Expand only after the experience, support process, and internal confidence are strong enough.",
      },
    ],
  },
  {
    layout: "cards3note",
    eyebrow: "COMMERCIAL MODEL",
    title: "How the business side works",
    cards: [
      {
        title: "Proof first",
        body:
          "Brands can start with a 300 try-on trial over 12 days and see whether the product actually fits their catalog and quality bar.",
      },
      {
        title: "Simple public plans",
        body:
          "Starter and Growth keep pricing simple for brands that want to test value first before moving into larger commercial usage.",
      },
      {
        title: "Enterprise support is available",
        body:
          "Larger partners can move into custom onboarding, higher usage, and a more hands-on rollout path once the pilot proves the fit.",
      },
    ],
    note:
      "This is a service conversation, not a fundraising conversation. The focus is whether DrapixAI is useful, believable, and safe enough for real brand rollout.",
  },
  {
    layout: "cards4",
    eyebrow: "PILOT REQUIREMENTS",
    title: "What we need from a strong brand partner",
    cards: [
      {
        title: "Clean garment assets",
        body:
          "Garment-only upper-body images that are clean, centered, and good enough to support strong virtual try-on output.",
      },
      {
        title: "Focused pilot catalog",
        body:
          "A selected group of products instead of the full catalog on day one, so the pilot stays manageable and easier to review.",
      },
      {
        title: "One internal owner",
        body:
          "One person inside the brand who can own feedback, review pairings, and help the rollout move clearly from test to launch.",
      },
      {
        title: "Clear success criteria",
        body:
          "A shared idea of success such as better shopper confidence, smoother onboarding, or proof that the workflow is ready to expand.",
      },
    ],
  },
  {
    layout: "close",
    eyebrow: "CLOSE",
    title: "Let's build a believable try-on experience together",
    subtitle:
      "DrapixAI is for brands that want virtual try-on to feel useful, professional, and trustworthy. We are looking for partners who care about real output quality and a clean launch path.",
    contact: "drapixai.com  |  sales@drapixai.com",
  },
];

async function ensureDirs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.mkdir(QA_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function setText(shape, { text, fontSize, color = COLORS.title, bold = false, typeface = FONTS.body, align = "left", valign = "top" }) {
  shape.text = text;
  shape.text.fontSize = fontSize;
  shape.text.color = color;
  shape.text.bold = bold;
  shape.text.typeface = typeface;
  shape.text.alignment = align;
  shape.text.verticalAlignment = valign;
  return shape;
}

function addGlow(slide, left, top, width, height, fill) {
  slide.shapes.add({
    geometry: "ellipse",
    position: { left, top, width, height },
    fill,
    line: { style: "solid", fill: "none", width: 0 },
  });
}

function addBackground(slide) {
  slide.background.fill = COLORS.bg;
  addGlow(slide, -50, -40, 250, 250, "#DFF6FF66");
  addGlow(slide, 1050, -50, 250, 250, "#EAE7FF66");
}

function addFooter(slide, pageNumber) {
  slide.shapes.add({
    geometry: "rect",
    position: { left: 72, top: 680, width: 1136, height: 1 },
    fill: "#E8EDF6",
    line: { style: "solid", fill: "#E8EDF6", width: 0 },
  });

  const left = slide.shapes.add({
    geometry: "textbox",
    position: { left: 72, top: 688, width: 320, height: 20 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(left, {
    text: "DrapixAI | Strategic partner pitch | June 2026",
    fontSize: 11,
    color: COLORS.muted,
    typeface: FONTS.body,
  });

  const right = slide.shapes.add({
    geometry: "textbox",
    position: { left: 1140, top: 688, width: 68, height: 20 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(right, {
    text: String(pageNumber),
    fontSize: 11,
    color: COLORS.muted,
    typeface: FONTS.body,
    align: "right",
  });
}

function addEyebrow(slide, text) {
  const pill = slide.shapes.add({
    geometry: "roundRect",
    position: { left: 72, top: 34, width: 220, height: 34 },
    fill: COLORS.softBlue,
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(pill, {
    text,
    fontSize: 13,
    color: COLORS.cyan,
    bold: true,
    typeface: FONTS.body,
    align: "center",
    valign: "middle",
  });
}

function addTitle(slide, title) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: 72, top: 110, width: 1120, height: 86 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(shape, {
    text: title,
    fontSize: 34,
    color: COLORS.title,
    bold: true,
    typeface: FONTS.title,
  });
}

function addBodyText(slide, text, position, fontSize = 18, align = "left") {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(shape, {
    text,
    fontSize,
    color: COLORS.body,
    typeface: FONTS.body,
    align,
  });
}

function addCard(slide, position, title, body, options = {}) {
  const {
    titleColor = COLORS.title,
    fill = "white",
    border = COLORS.border,
    titleSize = 18,
    bodySize = 16,
    titleTop = 24,
    bodyTop = 72,
  } = options;

  slide.shapes.add({
    geometry: "roundRect",
    position,
    fill,
    line: { style: "solid", fill: border, width: 1 },
  });

  const titleShape = slide.shapes.add({
    geometry: "textbox",
    position: {
      left: position.left + 24,
      top: position.top + titleTop,
      width: position.width - 48,
      height: 52,
    },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(titleShape, {
    text: title,
    fontSize: titleSize,
    color: titleColor,
    bold: true,
    typeface: FONTS.title,
  });

  const bodyShape = slide.shapes.add({
    geometry: "textbox",
    position: {
      left: position.left + 24,
      top: position.top + bodyTop,
      width: position.width - 48,
      height: position.height - bodyTop - 24,
    },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(bodyShape, {
    text: body,
    fontSize: bodySize,
    color: COLORS.body,
    typeface: FONTS.body,
  });
}

async function buildCoverSlide(ctx, slide, data) {
  const title = slide.shapes.add({
    geometry: "textbox",
    position: { left: 72, top: 222, width: 960, height: 140 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(title, {
    text: data.title,
    fontSize: 52,
    color: COLORS.title,
    bold: true,
    typeface: FONTS.title,
  });

  addBodyText(slide, data.subtitle, { left: 72, top: 390, width: 970, height: 120 }, 20);

  const tag = slide.shapes.add({
    geometry: "roundRect",
    position: { left: 72, top: 538, width: 340, height: 48 },
    fill: COLORS.softPurple,
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(tag, {
    text: data.tag,
    fontSize: 16,
    color: COLORS.blue,
    bold: true,
    typeface: FONTS.body,
    align: "center",
    valign: "middle",
  });

  addBodyText(
    slide,
    "Not a fundraising deck. This is a buyer and partner-facing services pitch.",
    { left: 72, top: 614, width: 620, height: 28 },
    14
  );

  await ctx.addImage(slide, {
    path: logoPath,
    left: 1110,
    top: 234,
    width: 72,
    height: 72,
    fit: "contain",
    alt: "DrapixAI emblem",
  });
}

function buildCards3Slide(slide, data) {
  addTitle(slide, data.title);
  const positions = [
    { left: 72, top: 248, width: 344, height: 320 },
    { left: 468, top: 248, width: 344, height: 320 },
    { left: 864, top: 248, width: 344, height: 320 },
  ];

  data.cards.forEach((card, index) => {
    slide.shapes.add({
      geometry: "roundRect",
      position: positions[index],
      fill: "white",
      line: { style: "solid", fill: COLORS.border, width: 1 },
    });

    slide.shapes.add({
      geometry: "ellipse",
      position: { left: positions[index].left + 24, top: positions[index].top + 22, width: 56, height: 56 },
      fill: card.soft,
      line: { style: "solid", fill: "none", width: 0 },
    });

    const cardTitle = slide.shapes.add({
      geometry: "textbox",
      position: { left: positions[index].left + 24, top: positions[index].top + 96, width: 288, height: 64 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(cardTitle, {
      text: card.title,
      fontSize: 18,
      color: card.color || COLORS.title,
      bold: true,
      typeface: FONTS.title,
    });

    const cardBody = slide.shapes.add({
      geometry: "textbox",
      position: { left: positions[index].left + 24, top: positions[index].top + 170, width: 288, height: 126 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(cardBody, {
      text: card.body,
      fontSize: 16,
      color: COLORS.body,
      typeface: FONTS.body,
    });
  });
}

async function buildSolutionSlide(ctx, slide, data) {
  addTitle(slide, data.title);

  const highlight = slide.shapes.add({
    geometry: "textbox",
    position: { left: 72, top: 214, width: 480, height: 52 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(highlight, {
    text: data.highlight,
    fontSize: 24,
    color: COLORS.blue,
    bold: true,
    typeface: FONTS.title,
  });

  addBodyText(slide, data.body, { left: 72, top: 286, width: 500, height: 176 }, 18);

  data.bullets.forEach((item, index) => {
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: 78, top: 488 + index * 34, width: 10, height: 10 },
      fill: COLORS.cyan,
      line: { style: "solid", fill: "none", width: 0 },
    });
    addBodyText(slide, item, { left: 100, top: 478 + index * 34, width: 440, height: 24 }, 16);
  });

  slide.shapes.add({
    geometry: "roundRect",
    position: { left: 612, top: 190, width: 596, height: 412 },
    fill: COLORS.slatePanel,
    line: { style: "solid", fill: COLORS.slatePanel, width: 0 },
  });

  slide.shapes.add({
    geometry: "roundRect",
    position: { left: 650, top: 226, width: 520, height: 58 },
    fill: COLORS.slatePanelSoft,
    line: { style: "solid", fill: "#1F2937", width: 1 },
  });
  addBodyText(slide, "Brand dashboard | rollout preview", { left: 678, top: 242, width: 300, height: 24 }, 18);

  const miniCards = [
    { left: 650, top: 312, width: 160, height: 92, label: "Garment validation" },
    { left: 830, top: 312, width: 160, height: 92, label: "Catalog discovery" },
    { left: 1010, top: 312, width: 160, height: 92, label: "Confirmed mappings" },
    { left: 650, top: 426, width: 250, height: 120, label: "Internal preview before public launch" },
    { left: 920, top: 426, width: 250, height: 120, label: "SDK live only on approved pairings" },
  ];

  miniCards.forEach((card) => {
    slide.shapes.add({
      geometry: "roundRect",
      position: { left: card.left, top: card.top, width: card.width, height: card.height },
      fill: COLORS.slatePanelSoft,
      line: { style: "solid", fill: "#1F2937", width: 1 },
    });
    const text = slide.shapes.add({
      geometry: "textbox",
      position: { left: card.left + 18, top: card.top + 18, width: card.width - 36, height: card.height - 36 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(text, {
      text: card.label,
      fontSize: 16,
      color: "#F8FAFC",
      bold: true,
      typeface: FONTS.title,
    });
  });

  await ctx.addImage(slide, {
    path: logoPath,
    left: 1116,
    top: 204,
    width: 48,
    height: 48,
    fit: "contain",
    alt: "DrapixAI emblem",
  });
}

function buildScopeSlide(slide, data) {
  addTitle(slide, data.title);
  const toneMap = {
    green: { fill: COLORS.softGreen, color: COLORS.green },
    amber: { fill: COLORS.softAmber, color: COLORS.amber },
    red: { fill: COLORS.softRed, color: COLORS.red },
  };
  const positions = [
    { left: 72, top: 238, width: 344, height: 300 },
    { left: 468, top: 238, width: 344, height: 300 },
    { left: 864, top: 238, width: 344, height: 300 },
  ];

  data.columns.forEach((column, index) => {
    const tone = toneMap[column.tone];
    slide.shapes.add({
      geometry: "roundRect",
      position: positions[index],
      fill: "white",
      line: { style: "solid", fill: COLORS.border, width: 1 },
    });
    const pill = slide.shapes.add({
      geometry: "roundRect",
      position: { left: positions[index].left + 24, top: 262, width: 156, height: 36 },
      fill: tone.fill,
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(pill, {
      text: column.heading,
      fontSize: 15,
      color: tone.color,
      bold: true,
      typeface: FONTS.body,
      align: "center",
      valign: "middle",
    });

    column.items.forEach((item, rowIndex) => {
      addBodyText(
        slide,
        `- ${item}`,
        { left: positions[index].left + 24, top: 326 + rowIndex * 36, width: 296, height: 24 },
        18
      );
    });
  });

  addBodyText(slide, data.note, { left: 72, top: 580, width: 1080, height: 42 }, 16);
}

function buildStepsSlide(slide, data) {
  addTitle(slide, data.title);
  const stepWidth = 196;
  const gap = 24;
  data.steps.forEach((step, index) => {
    const left = 72 + index * (stepWidth + gap);
    slide.shapes.add({
      geometry: "roundRect",
      position: { left, top: 292, width: stepWidth, height: 150 },
      fill: "white",
      line: { style: "solid", fill: COLORS.border, width: 1 },
    });

    const badge = slide.shapes.add({
      geometry: "ellipse",
      position: { left: left + 18, top: 310, width: 32, height: 32 },
      fill: COLORS.softPurple,
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(badge, {
      text: String(index + 1),
      fontSize: 14,
      color: COLORS.blue,
      bold: true,
      typeface: FONTS.body,
      align: "center",
      valign: "middle",
    });

    const text = slide.shapes.add({
      geometry: "textbox",
      position: { left: left + 18, top: 356, width: stepWidth - 36, height: 70 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(text, {
      text: step,
      fontSize: 17,
      color: COLORS.title,
      bold: true,
      typeface: FONTS.title,
    });

    if (index < data.steps.length - 1) {
      slide.shapes.add({
        geometry: "rect",
        position: { left: left + stepWidth + 6, top: 366, width: 12, height: 4 },
        fill: COLORS.blue,
        line: { style: "solid", fill: COLORS.blue, width: 0 },
      });
    }
  });

  addBodyText(slide, data.note, { left: 72, top: 516, width: 1080, height: 44 }, 16);
}

function buildCards4Slide(slide, data) {
  addTitle(slide, data.title);
  const positions = [
    { left: 72, top: 244, width: 548, height: 154 },
    { left: 660, top: 244, width: 548, height: 154 },
    { left: 72, top: 438, width: 548, height: 154 },
    { left: 660, top: 438, width: 548, height: 154 },
  ];

  data.cards.forEach((card, index) => {
    addCard(slide, positions[index], card.title, card.body, {
      titleSize: 18,
      bodySize: 16,
      titleTop: 24,
      bodyTop: 60,
    });
  });
}

function buildPhasesSlide(slide, data) {
  addTitle(slide, data.title);

  slide.shapes.add({
    geometry: "rect",
    position: { left: 120, top: 326, width: 1040, height: 6 },
    fill: COLORS.softBlue,
    line: { style: "solid", fill: "none", width: 0 },
  });

  data.phases.forEach((phase, index) => {
    const left = 90 + index * 258;
    const dot = slide.shapes.add({
      geometry: "ellipse",
      position: { left, top: 312, width: 34, height: 34 },
      fill: COLORS.blue,
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(dot, {
      text: String(index + 1),
      fontSize: 15,
      color: "white",
      bold: true,
      typeface: FONTS.body,
      align: "center",
      valign: "middle",
    });

    addBodyText(slide, phase.title, { left: left - 8, top: 364, width: 180, height: 24 }, 16);
    const subtitle = slide.shapes.add({
      geometry: "textbox",
      position: { left: left - 8, top: 392, width: 214, height: 26 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(subtitle, {
      text: phase.subtitle,
      fontSize: 18,
      color: COLORS.title,
      bold: true,
      typeface: FONTS.title,
    });

    addBodyText(slide, phase.body, { left: left - 8, top: 426, width: 214, height: 118 }, 15);
  });
}

function buildCompareSlide(slide, data) {
  addTitle(slide, data.title);
  const left = 72;
  const top = 248;
  const rowHeight = 58;
  const widths = [300, 250, 300];
  const headers = ["Decision area", "DrapixAI", "Generic AI demos"];
  const columns = [left, left + widths[0], left + widths[0] + widths[1]];

  slide.shapes.add({
    geometry: "roundRect",
    position: { left, top, width: 1136, height: 52 },
    fill: COLORS.softBlue,
    line: { style: "solid", fill: "none", width: 0 },
  });

  headers.forEach((header, index) => {
    const cell = slide.shapes.add({
      geometry: "textbox",
      position: { left: columns[index] + 18, top: top + 14, width: widths[index] - 20, height: 24 },
      fill: "none",
      line: { style: "solid", fill: "none", width: 0 },
    });
    setText(cell, {
      text: header,
      fontSize: 16,
      color: COLORS.title,
      bold: true,
      typeface: FONTS.title,
    });
  });

  data.compare.forEach((row, rowIndex) => {
    const y = top + 70 + rowIndex * rowHeight;
    slide.shapes.add({
      geometry: "roundRect",
      position: { left, top: y, width: 1136, height: 46 },
      fill: rowIndex % 2 === 0 ? "white" : "#FBFDFF",
      line: { style: "solid", fill: COLORS.border, width: 0.8 },
    });

    row.forEach((cellText, columnIndex) => {
      const cell = slide.shapes.add({
        geometry: "textbox",
        position: { left: columns[columnIndex] + 18, top: y + 11, width: widths[columnIndex] - 20, height: 24 },
        fill: "none",
        line: { style: "solid", fill: "none", width: 0 },
      });
      setText(cell, {
        text: cellText,
        fontSize: 15,
        color: columnIndex === 1 ? COLORS.green : COLORS.body,
        bold: columnIndex === 0 || columnIndex === 1,
        typeface: columnIndex === 0 ? FONTS.title : FONTS.body,
      });
    });
  });
}

function buildCards3NoteSlide(slide, data) {
  addTitle(slide, data.title);
  const positions = [
    { left: 72, top: 250, width: 344, height: 234 },
    { left: 468, top: 250, width: 344, height: 234 },
    { left: 864, top: 250, width: 344, height: 234 },
  ];

  data.cards.forEach((card, index) => {
    addCard(slide, positions[index], card.title, card.body, {
      titleSize: 18,
      bodySize: 16,
      titleTop: 26,
      bodyTop: 86,
    });
  });

  addBodyText(slide, data.note, { left: 72, top: 540, width: 1080, height: 56 }, 16);
}

async function buildCloseSlide(ctx, slide, data) {
  const title = slide.shapes.add({
    geometry: "textbox",
    position: { left: 170, top: 248, width: 940, height: 92 },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  setText(title, {
    text: data.title,
    fontSize: 54,
    color: COLORS.blue,
    bold: true,
    typeface: FONTS.title,
    align: "center",
  });

  addBodyText(slide, data.subtitle, { left: 180, top: 382, width: 920, height: 120 }, 19, "center");
  addBodyText(slide, data.contact, { left: 300, top: 560, width: 680, height: 32 }, 18, "center");

  await ctx.addImage(slide, {
    path: logoPath,
    left: 610,
    top: 112,
    width: 60,
    height: 60,
    fit: "contain",
    alt: "DrapixAI emblem",
  });
}

async function writePlanningNotes() {
  await fs.writeFile(
    path.join(TMP_DIR, "source-notes.txt"),
    [
      "DrapixAI source notes",
      "",
      "Primary internal sources:",
      "- apps/web/app/page.tsx: homepage positioning, rollout claims, and public pricing posture.",
      "- apps/web/app/help/page.tsx: supported upper-body categories, rollout guidance, and support-first messaging.",
      "- apps/web/app/dashboard/page.tsx: onboarding flow and confirmed mapping workflow.",
      "- drapixai_ai/docs/garment_api.md: upload standard, cache version, latency target, and live try-on requirements.",
      "- prior conversation context: this deck is for pitching services to larger buyers, not fundraising.",
      "",
      "Content discipline:",
      "- No invented traction, ROI, valuation, or market size metrics.",
      "- Product scope framed honestly around current upper-body rollout readiness.",
      "- Commercial details stay factual: 300 try-on trial, 12-day trial window, public plans, and enterprise path.",
      "- CTA positioned as pilot or strategic rollout partnership, not capital raise.",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(TMP_DIR, "slide-plan.txt"),
    [
      "DrapixAI strategic partner pitch slide plan",
      "",
      `Background: ${COLORS.bg}`,
      `Text: ${COLORS.title}`,
      `Accent colors: ${COLORS.blue}, ${COLORS.cyan}`,
      `Fonts: ${FONTS.title} headings, ${FONTS.body} body`,
      "",
      "Slides:",
      "1. Cover",
      "2. Problem framing",
      "3. Our solution",
      "4. Current product scope and realism discipline",
      "5. Onboarding workflow",
      "6. Live stack explanation",
      "7. Rollout model",
      "8. Why brand teams care",
      "9. Why DrapixAI vs generic demos",
      "10. Commercial model",
      "11. Pilot requirements",
      "12. Closing CTA",
    ].join("\n"),
    "utf8"
  );
}

async function buildDeck() {
  const artifactUtils = await import(ARTIFACT_UTILS_URL);
  const { ensureArtifactToolWorkspace, importArtifactTool, saveBlobToFile } = artifactUtils;

  await ensureDirs();
  await ensureArtifactToolWorkspace(WORKSPACE);
  const artifact = await importArtifactTool(WORKSPACE);
  const { Presentation, PresentationFile } = artifact;
  const presentation = Presentation.create({ slideSize: SLIDE_SIZE });
  const ctx = artifactUtils.createSlideContext(artifact, {
    workspaceDir: WORKSPACE,
    slideSize: SLIDE_SIZE,
    titleFont: FONTS.title,
    bodyFont: FONTS.body,
  });

  await writePlanningNotes();

  for (let index = 0; index < slides.length; index += 1) {
    const data = slides[index];
    const slide = presentation.slides.add();
    addBackground(slide);
    addEyebrow(slide, data.eyebrow);

    switch (data.layout) {
      case "cover":
        await buildCoverSlide(ctx, slide, data);
        break;
      case "cards3":
        buildCards3Slide(slide, data);
        break;
      case "solution":
        await buildSolutionSlide(ctx, slide, data);
        break;
      case "scope":
        buildScopeSlide(slide, data);
        break;
      case "steps":
        buildStepsSlide(slide, data);
        break;
      case "cards4":
        buildCards4Slide(slide, data);
        break;
      case "phases":
        buildPhasesSlide(slide, data);
        break;
      case "compare":
        buildCompareSlide(slide, data);
        break;
      case "cards3note":
        buildCards3NoteSlide(slide, data);
        break;
      case "close":
        await buildCloseSlide(ctx, slide, data);
        break;
      default:
        throw new Error(`Unsupported layout: ${data.layout}`);
    }

    addFooter(slide, index + 1);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    await saveBlobToFile(
      await presentation.export({ slide, format: "png", scale: 1 }),
      path.join(PREVIEW_DIR, `slide-${String(index + 1).padStart(2, "0")}.png`)
    );
  }

  await saveBlobToFile(
    await presentation.export({ format: "webp", montage: true, scale: 1 }),
    path.join(PREVIEW_DIR, "deck-montage.webp")
  );

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);

  await fs.writeFile(
    path.join(QA_DIR, "visual-qa.txt"),
    [
      "Visual QA summary",
      "",
      "- White editorial background with blue and lilac accent treatment.",
      "- Message reframed from fundraising to strategic partner services pitch.",
      "- Scope and commercial details kept factual to current DrapixAI product posture.",
      "- Deck built for enterprise buyers who care about rollout confidence, not startup theater.",
      "",
      `Final PPTX: ${FINAL_PPTX}`,
    ].join("\n"),
    "utf8"
  );

  return {
    finalPptx: FINAL_PPTX,
    previewDir: PREVIEW_DIR,
    workspace: WORKSPACE,
  };
}

export { buildDeck };

buildDeck()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
