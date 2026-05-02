import { PrismaClient } from '@prisma/client';
import { CatalogSyncInputItem, detectCatalogCategory, isSupportedUpperBodyItem, normalizeCatalogItem } from './catalog-feed';

type MatchCandidate = {
  productId: string;
  productName?: string | null;
  confidence: number;
  reason: string;
};

const normalizeText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokenize = (value: unknown) =>
  Array.from(new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 1)));

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

export const humanizeIdentifier = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const buildGarmentAssetId = (rawLabel: string) => {
  const base = slugify(rawLabel) || 'garment';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
};

const listActualGarments = async (prisma: PrismaClient, userId: number) =>
  prisma.garment.findMany({
    where: {
      userId,
      status: { not: 'rejected' },
      OR: [
        { originalUrl: { not: null } },
        { cacheKey: { not: null } },
        { thumbnailUrl: { not: null } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

const scoreMatch = (
  garment: { garmentId: string; displayName?: string | null; productName?: string | null; category?: string | null; garmentType?: string | null },
  product: { productId: string; productName?: string | null; category?: string | null; garmentType?: string | null }
): MatchCandidate | null => {
  const garmentId = normalizeText(garment.garmentId);
  const productId = normalizeText(product.productId);
  const garmentLabel = normalizeText(garment.displayName || garment.productName || garment.garmentId);
  const productLabel = normalizeText(product.productName || product.productId);
  const garmentCategory = normalizeText(`${garment.category || ''} ${garment.garmentType || ''}`);
  const productCategory = normalizeText(`${product.category || ''} ${product.garmentType || ''}`);

  let confidence = 0;
  const reasons: string[] = [];

  if (garmentId && productId && garmentId === productId) {
    confidence += 0.98;
    reasons.push('exact product id match');
  } else if (garmentId && productId && (garmentId.includes(productId) || productId.includes(garmentId))) {
    confidence += 0.65;
    reasons.push('similar asset and product ids');
  }

  if (garmentLabel && productLabel && garmentLabel === productLabel) {
    confidence += 0.9;
    reasons.push('matching garment and product names');
  }

  const garmentTokens = tokenize(`${garment.displayName || ''} ${garment.productName || ''} ${garment.garmentId}`);
  const productTokens = tokenize(`${product.productName || ''} ${product.productId} ${product.category || ''}`);
  const overlap = garmentTokens.filter((token) => productTokens.includes(token));
  if (overlap.length) {
    confidence += Math.min(0.55, overlap.length * 0.16);
    reasons.push(`shared terms: ${overlap.slice(0, 3).join(', ')}`);
  }

  if (garmentCategory && productCategory && (garmentCategory === productCategory || garmentCategory.includes(productCategory) || productCategory.includes(garmentCategory))) {
    confidence += 0.18;
    reasons.push('matching category context');
  }

  if (confidence < 0.24) {
    return null;
  }

  return {
    productId: product.productId,
    productName: product.productName,
    confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    reason: reasons.join(' | '),
  };
};

export const recomputeGarmentMatchesForUser = async (prisma: PrismaClient, userId: number) => {
  const [garments, products, existingMatches] = await Promise.all([
    listActualGarments(prisma, userId),
    prisma.catalogProduct.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.garmentMatch.findMany({ where: { userId } }),
  ]);

  const existingByGarmentId = new Map(existingMatches.map((match) => [match.garmentId, match]));

  for (const garment of garments) {
    const current = existingByGarmentId.get(garment.garmentId);

    if (current?.status === 'confirmed' && current.confirmedProductId) {
      const stillExists = products.some((product) => product.productId === current.confirmedProductId);
      if (!stillExists) {
        await prisma.garmentMatch.update({
          where: { userId_garmentId: { userId, garmentId: garment.garmentId } },
          data: {
            confirmedProductId: null,
            status: 'unmatched',
            confidence: null,
            matchReason: 'Confirmed product is no longer in the discovered catalog.',
          },
        });
      }
      continue;
    }

    const best = products
      .map((product) => scoreMatch(garment, product))
      .filter((candidate): candidate is MatchCandidate => Boolean(candidate))
      .sort((left, right) => right.confidence - left.confidence)[0];

    const nextData = best
      ? {
          suggestedProductId: best.productId,
          confirmedProductId: null,
          status: 'suggested',
          confidence: best.confidence,
          matchReason: best.reason,
        }
      : {
          suggestedProductId: null,
          confirmedProductId: null,
          status: 'unmatched',
          confidence: null,
          matchReason: products.length ? 'No confident catalog match yet.' : 'Run catalog discovery first.',
        };

    await prisma.garmentMatch.upsert({
      where: { userId_garmentId: { userId, garmentId: garment.garmentId } },
      update: nextData,
      create: { userId, garmentId: garment.garmentId, ...nextData },
    });
  }
};

export const upsertCatalogProductsForUser = async (
  prisma: PrismaClient,
  userId: number,
  sourceItems: CatalogSyncInputItem[],
  source = 'manual'
) => {
  const normalizedItems = sourceItems
    .map((item) => normalizeCatalogItem(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const uniqueItems = Array.from(new Map(normalizedItems.map((item) => [item.productId, item])).values());
  const discovered: Array<{ productId: string; status: string; category?: string }> = [];
  const skipped: Array<{ productId: string; reason: string }> = [];

  for (const item of uniqueItems) {
    const detectedCategory = detectCatalogCategory(item);
    if (!detectedCategory) {
      skipped.push({ productId: item.productId, reason: 'NOT_UPPER_BODY' });
      continue;
    }

    if (detectedCategory.supportLevel === 'unsupported' || !isSupportedUpperBodyItem(item)) {
      skipped.push({ productId: item.productId, reason: 'UNSUPPORTED_UPPER_BODY_CATEGORY' });
      continue;
    }

    const record = await prisma.catalogProduct.upsert({
      where: { userId_productId: { userId, productId: item.productId } },
      update: {
        productName: item.productName,
        category: detectedCategory.label,
        garmentType: 'upper',
        imageUrl: item.imageUrl,
        source,
        status: 'discovered',
      },
      create: {
        userId,
        productId: item.productId,
        productName: item.productName,
        category: detectedCategory.label,
        garmentType: 'upper',
        imageUrl: item.imageUrl,
        source,
        status: 'discovered',
      },
    });

    discovered.push({ productId: record.productId, status: record.status, category: detectedCategory.label });
  }

  await recomputeGarmentMatchesForUser(prisma, userId);
  return { discovered, skipped };
};

export const confirmGarmentMatch = async (
  prisma: PrismaClient,
  userId: number,
  garmentId: string,
  productId: string
) => {
  const [garment, product] = await Promise.all([
    prisma.garment.findUnique({ where: { userId_garmentId: { userId, garmentId } } }),
    prisma.catalogProduct.findUnique({ where: { userId_productId: { userId, productId } } }),
  ]);

  if (!garment) {
    throw new Error('GARMENT_NOT_FOUND');
  }
  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  await prisma.garmentMatch.updateMany({
    where: { userId, confirmedProductId: productId, NOT: { garmentId } },
    data: { confirmedProductId: null, status: 'suggested' },
  });

  return prisma.garmentMatch.upsert({
    where: { userId_garmentId: { userId, garmentId } },
    update: {
      suggestedProductId: productId,
      confirmedProductId: productId,
      status: 'confirmed',
      confidence: 1,
      matchReason: 'Confirmed by brand operator.',
    },
    create: {
      userId,
      garmentId,
      suggestedProductId: productId,
      confirmedProductId: productId,
      status: 'confirmed',
      confidence: 1,
      matchReason: 'Confirmed by brand operator.',
    },
  });
};

export const clearConfirmedGarmentMatch = async (prisma: PrismaClient, userId: number, garmentId: string) => {
  const match = await prisma.garmentMatch.findUnique({
    where: { userId_garmentId: { userId, garmentId } },
  });

  if (!match) {
    return null;
  }

  await prisma.garmentMatch.update({
    where: { userId_garmentId: { userId, garmentId } },
    data: { confirmedProductId: null },
  });

  await recomputeGarmentMatchesForUser(prisma, userId);
  return prisma.garmentMatch.findUnique({
    where: { userId_garmentId: { userId, garmentId } },
  });
};

export const resolveConfirmedGarmentForProduct = async (
  prisma: PrismaClient,
  userId: number,
  productIdOrGarmentId: string
) => {
  const direct = await prisma.garment.findUnique({
    where: { userId_garmentId: { userId, garmentId: productIdOrGarmentId } },
  });

  if (direct?.cacheKey) {
    return direct;
  }

  const match = await prisma.garmentMatch.findFirst({
    where: {
      userId,
      confirmedProductId: productIdOrGarmentId,
      status: 'confirmed',
    },
  });

  if (!match) {
    return null;
  }

  return prisma.garment.findUnique({
    where: { userId_garmentId: { userId, garmentId: match.garmentId } },
  });
};
