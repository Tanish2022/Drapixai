const fs = require('fs');
const path = require('path');

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 52;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const outputPath = path.resolve(__dirname, '..', 'docs', 'drapixai-project-dossier.pdf');

const sections = [
  {
    kind: 'cover',
    title: 'DrapixAI',
    subtitle:
      'Project dossier covering product, technology, deployment, launch readiness, and go-to-market context.',
    meta: [
      'Date: 2026-06-26',
      'Audience: founder, sales, engineering, launch, and support',
      'Current scope: upper-body AI try-on, standard quality only',
    ],
  },
  {
    kind: 'section',
    title: '1. Executive Summary',
    paragraphs: [
      'DrapixAI is a B2B AI virtual try-on platform for fashion ecommerce. It is being built as a controlled rollout product rather than a broad, hands-off consumer AI tool.',
      'The current product focus is upper-body garments only. The system emphasizes garment validation, confirmed product mapping, cached garment assets, quality controls, and operational readiness before scale.',
    ],
  },
  {
    kind: 'section',
    title: '2. What The Product Does',
    bullets: [
      'Lets a brand create an account and obtain an API key.',
      'Accepts isolated garment images and validates them before use.',
      'Preprocesses garments into cached assets for repeatable try-on quality.',
      'Syncs product catalog data and suggests garment-to-product matches.',
      'Requires manual confirmation of final product mappings before storefront traffic uses them.',
      'Generates shopper try-on outputs from a shopper photo plus confirmed product identifier.',
      'Returns response metadata such as quality score, latency, warnings, engine, and cache state.',
    ],
  },
  {
    kind: 'section',
    title: '3. Current Launch Scope',
    paragraphs: [
      'Launch-ready categories are focused on upper-body garments. Stronger categories include shirts, t-shirts, polos, blouses, and clean tops. Short kurtis, hoodies, and sweatshirts are more cautious categories.',
      'The product should not currently promise full-body support, every apparel class, or a universal cross-platform rollout. Full-body is positioned as future work rather than part of the current public launch promise.',
    ],
  },
  {
    kind: 'section',
    title: '4. Customer Workflow',
    bullets: [
      'Create account and log in.',
      'Receive or rotate API key.',
      'Upload garment-only images.',
      'Run garment validation and cache generation.',
      'Sync catalog products into the dashboard.',
      'Review suggested matches.',
      'Confirm the correct garment-to-product pairings manually.',
      'Install the browser SDK or call the REST API.',
      'Send shopper photo plus confirmed product context.',
      'Receive try-on image and metadata.',
    ],
  },
  {
    kind: 'section',
    title: '5. Product Features',
    bullets: [
      'Authentication: email/password signup, OTP verification, login, optional Google OAuth.',
      'Dashboard: usage visibility, analytics, account settings, and plan visibility.',
      'API key controls: active key lifecycle, rotation, and domain-lock behavior.',
      'Garment pipeline: upload, validation, preprocessing, cache generation, thumbnails, and approval states.',
      'Catalog flow: catalog sync, discovered products, suggested matches, and confirmed mapping.',
      'Try-on flow: SDK and REST API for standard-quality upper-body generation.',
      'Operations: readiness endpoints, admin review flows, support contacts, and email logging.',
    ],
  },
  {
    kind: 'section',
    title: '6. Pricing And Commercial Shape',
    bullets: [
      'Trial: 300 try-ons over 12 days.',
      'Starter: entry paid plan for smaller brands.',
      'Growth: higher-volume plan for stores with more usage.',
      'Pro: shown as future-facing / coming soon.',
      'Enterprise: sales-led custom path.',
    ],
    paragraphs: [
      'The commercial motion is designed to be low-risk: brands validate the workflow on their own garments first, then move into paid usage only when the try-on flow is trustworthy enough for live rollout.',
      'One practical note: pricing language and some backend quota values should be reconciled before billing is treated as final.',
    ],
  },
  {
    kind: 'section',
    title: '7. Web Stack',
    bullets: [
      'Framework: Next.js 16.',
      'Frontend runtime: React 18.',
      'Styling: Tailwind CSS.',
      'Session/auth integration: NextAuth.',
      'Public pages include homepage, pricing, help, contact, auth flows, dashboard, admin, and settings-related views.',
    ],
  },
  {
    kind: 'section',
    title: '8. Backend Stack',
    bullets: [
      'Runtime: Node.js with Express and TypeScript.',
      'ORM and schema layer: Prisma.',
      'Primary data store: PostgreSQL.',
      'Queue/cache coordination: Redis.',
      'Email delivery: Nodemailer via SMTP.',
      'Scheduled background work: node-cron.',
    ],
    paragraphs: [
      'The API is organized around auth routes, SDK routes, analytics routes, admin routes, account routes, and public routes. It also exposes health and ready checks for operations.',
    ],
  },
  {
    kind: 'section',
    title: '9. AI Stack',
    bullets: [
      'Runtime: Python FastAPI service.',
      'Core try-on engine: CatVTON pipeline.',
      'Garment pipeline: preprocessing, validation, cache storage, and retrieval.',
      'Request safety: internal service token for API-to-AI calls.',
      'Upper-body enforcement and standard-quality enforcement in the live path.',
      'Response metadata includes quality score, timings, warnings, candidate count, and garment source.',
    ],
  },
  {
    kind: 'section',
    title: '10. Deployment Topology',
    bullets: [
      'Edge host: public web app, API, and nginx reverse proxy.',
      'GPU host: RunPod A100 pod running AI API and worker.',
      'Managed Postgres recommended for production.',
      'Managed Redis recommended for production.',
      'S3-compatible object storage used for uploads, outputs, and thumbnails.',
      'SMTP provider used for OTP and transactional email.',
      'Optional Google OAuth for sign-in.',
    ],
    paragraphs: [
      'The repo already contains Dockerfiles, environment templates, nginx config, RunPod bootstrap scripts, environment validation scripts, smoke tests, and health-check helpers.',
    ],
  },
  {
    kind: 'section',
    title: '11. Recommended AI Runtime',
    bullets: [
      'Preferred live environment: RunPod Ubuntu GPU stack.',
      'Preferred GPU: A100 PCIe 80GB.',
      'Base image: runpod/pytorch 2.4.0 with Python 3.11 and CUDA 12.4.1.',
      'Preset path: DRAPIXAI_GPU_PRESET=runpod-a100.',
      'Warm latency target: about 10 to 12 seconds.',
      'Model preload is enabled on the A100 path to reduce cold-start impact.',
    ],
    paragraphs: [
      'Project docs explicitly say that Windows or local output should not be treated as the final production quality gate. The production quality gate is the Linux RunPod GPU path.',
    ],
  },
  {
    kind: 'section',
    title: '12. Core Data Model',
    bullets: [
      'User: account, company, plan, trial, store verification, and catalog sync metadata.',
      'ApiKey: active key storage and domain whitelist.',
      'Usage and UsageDaily: monthly and daily consumption tracking.',
      'Garment: garment assets, cache keys, thumbnails, status, and source references.',
      'CatalogProduct: discovered or synced product catalog items.',
      'GarmentMatch: suggested and confirmed mapping between garment and product.',
      'TryOnResult: generated result image, quality score, timing, warnings, and approval status.',
      'TryOnFeedback: manual realism or defect review data.',
      'EmailLog: OTP and transactional email tracking.',
      'VerificationCode: OTP and email verification support.',
    ],
  },
  {
    kind: 'section',
    title: '13. Security And Operational Controls',
    bullets: [
      'Helmet and CORS protections on the API.',
      'JWT-based account auth.',
      'Bcrypt hashing for passwords and API keys.',
      'Single-domain enforcement behavior for API keys in the live SDK path.',
      'Readiness checks across database, Redis, AI, and storage.',
      'Admin review filters for low quality, high latency, warnings, and cache issues.',
      'Email send logging for supportability.',
    ],
  },
  {
    kind: 'section',
    title: '14. Marketing And Go-To-Market Assets',
    bullets: [
      'Go-to-market strategy document.',
      'Video scripts and production kit.',
      'Prelaunch partner brief.',
      'Cold outbound email sequence and sender setup guide.',
      'Growth experiments and omnichannel roadmap.',
      'Segmented email templates for growth and enterprise accounts.',
      'Lead templates and a marketing-agent operating framework.',
    ],
    paragraphs: [
      'The repository already contains a substantial founder-led marketing pack. That means the business side of launch has been prepared alongside the product and infrastructure.',
    ],
  },
  {
    kind: 'section',
    title: '15. Launch Readiness',
    paragraphs: [
      'The codebase appears structurally close to launch. Deployment documentation, environment templates, health checks, smoke-test scripts, AI presets, and support playbooks are already in place.',
      'However, the project docs still call out a few live blockers that matter before public launch.',
    ],
    bullets: [
      'Live RunPod A100 validation.',
      'Real SMTP verification.',
      'Optional Google OAuth verification if exposed publicly.',
      'At least one successful end-to-end public try-on on the Linux GPU path.',
    ],
  },
  {
    kind: 'section',
    title: '16. Practical Assessment',
    paragraphs: [
      'DrapixAI should be understood as a controlled AI commerce system, not just an image-generation feature. Its real value comes from combining garment preparation, product mapping, AI generation, analytics, and launch operations into one commerce workflow.',
      'From the repository state, the project already shows serious product, engineering, and go-to-market preparation. The main remaining work is live production proof on the target A100 stack and finalizing the external infrastructure pieces needed for a safe public launch.',
    ],
  },
  {
    kind: 'section',
    title: '17. Source Snapshot Used For This Brief',
    bullets: [
      'deploy.md',
      'deploy/production-readiness.md',
      'deploy/launch-support-playbook.md',
      'apps/web/app/page.tsx',
      'apps/web/app/pricing/page.tsx',
      'apps/web/app/help/page.tsx',
      'apps/web/app/contact/page.tsx',
      'apps/api/prisma/schema.prisma',
      'apps/api/src/server.ts',
      'apps/api/src/routes/auth.ts',
      'apps/api/src/routes/sdk.ts',
      'apps/api/src/routes/analytics.ts',
      'apps/api/src/services/emailer.ts',
      'drapixai_ai/api/ai_server.py',
      'drapixai_ai/configs/settings.py',
      'marketing/README.md',
    ],
  },
];

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function estimateLineWidth(text, fontSize) {
  return text.length * fontSize * 0.53;
}

function wrapText(text, fontSize, extraIndent = 0) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const maxWidth = CONTENT_WIDTH - extraIndent;
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateLineWidth(next, fontSize) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function createDocumentLines() {
  const lines = [];

  for (const section of sections) {
    if (section.kind === 'cover') {
      lines.push({ text: section.title, size: 28, font: 'F2', gapBefore: 40, gapAfter: 10 });
      lines.push({ text: section.subtitle, size: 13, font: 'F1', gapAfter: 18 });
      for (const item of section.meta) {
        lines.push({ text: item, size: 11, font: 'F1', bullet: false, gapAfter: 2 });
      }
      lines.push({ text: '', size: 12, font: 'F1', gapAfter: 22 });
      continue;
    }

    lines.push({ text: section.title, size: 17, font: 'F2', gapBefore: 12, gapAfter: 8 });

    for (const paragraph of section.paragraphs || []) {
      lines.push({ text: paragraph, size: 11, font: 'F1', paragraph: true, gapAfter: 8 });
    }

    for (const bullet of section.bullets || []) {
      lines.push({ text: bullet, size: 11, font: 'F1', bullet: true, gapAfter: 3 });
    }

    lines.push({ text: '', size: 10, font: 'F1', gapAfter: 8 });
  }

  return lines;
}

function paginate(lines) {
  const pages = [];
  let page = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const commitPage = () => {
    pages.push(page);
    page = [];
    y = PAGE_HEIGHT - MARGIN_TOP;
  };

  for (const entry of lines) {
    const fontSize = entry.size || 11;
    const leading = fontSize + 4;
    const indent = entry.bullet ? 18 : 0;
    const prefix = entry.bullet ? '\u2022 ' : '';
    const wrapped = entry.text
      ? wrapText(prefix + entry.text, fontSize, indent)
      : [''];

    const requiredHeight = Math.max(leading * wrapped.length, leading) + (entry.gapBefore || 0) + (entry.gapAfter || 0);

    if (y - requiredHeight < MARGIN_BOTTOM) {
      commitPage();
    }

    y -= entry.gapBefore || 0;

    for (let index = 0; index < wrapped.length; index += 1) {
      const text = wrapped[index];
      const x = MARGIN_X + (entry.bullet && index > 0 ? indent : 0);
      page.push({
        x,
        y,
        text,
        size: fontSize,
        font: entry.font || 'F1',
      });
      y -= leading;
    }

    y -= entry.gapAfter || 0;
  }

  if (page.length > 0) {
    pages.push(page);
  }

  return pages.map((items, pageIndex, allPages) => {
    const pageNumberText = `Page ${pageIndex + 1} of ${allPages.length}`;
    return [
      ...items,
      { x: PAGE_WIDTH - MARGIN_X - 70, y: 24, text: pageNumberText, size: 10, font: 'F1' },
    ];
  });
}

function buildContentStream(lines) {
  return lines
    .map((line) => {
      const escaped = escapePdfText(line.text);
      return `BT /${line.font} ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm (${escaped}) Tj ET`;
    })
    .join('\n');
}

function buildPdf(pages) {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  pages.forEach((pageLines, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    const stream = buildContentStream(pageLines);
    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';

  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

const lines = createDocumentLines();
const pages = paginate(lines);
const pdf = buildPdf(pages);

fs.writeFileSync(outputPath, pdf, 'binary');
console.log(`Wrote ${outputPath}`);
