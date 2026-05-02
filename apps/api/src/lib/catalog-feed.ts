export type CatalogSyncInputItem = {
  productId?: string;
  productName?: string;
  category?: string;
  garmentType?: string;
  imageUrl?: string;
};

export type NormalizedCatalogItem = {
  productId: string;
  productName?: string;
  category?: string;
  garmentType?: string;
  imageUrl?: string;
};

export type CatalogCategoryMatch = {
  key: string;
  label: string;
  supportLevel: 'launch_ready' | 'beta' | 'unsupported';
};

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

const normalizeHaystack = (value: unknown) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CATEGORY_RULES: Array<CatalogCategoryMatch & { aliases: string[] }> = [
  { key: 'shirt', label: 'Shirt', supportLevel: 'launch_ready', aliases: ['oxford shirt', 'button down', 'button up', 'shirt', 'flannel'] },
  { key: 'tshirt', label: 'T-Shirt', supportLevel: 'launch_ready', aliases: ['t shirt', 'tshirt', 'tee shirt', 'graphic tee', 'tee'] },
  { key: 'polo', label: 'Polo', supportLevel: 'launch_ready', aliases: ['polo shirt', 'polo'] },
  { key: 'blouse', label: 'Blouse', supportLevel: 'launch_ready', aliases: ['blouse'] },
  { key: 'top', label: 'Top', supportLevel: 'launch_ready', aliases: ['crop top', 'sleeveless top', 'tank top', 'camisole', 'cami', 'tank', 'top', 'tops'] },
  { key: 'short_kurti', label: 'Short Kurti', supportLevel: 'beta', aliases: ['short kurti', 'kurti top', 'kurti'] },
  { key: 'hoodie', label: 'Hoodie', supportLevel: 'beta', aliases: ['zip hoodie', 'hooded sweatshirt', 'hoodie'] },
  { key: 'sweatshirt', label: 'Sweatshirt', supportLevel: 'beta', aliases: ['crewneck sweatshirt', 'sweat shirt', 'sweatshirt', 'sweater'] },
  { key: 'outerwear', label: 'Outerwear', supportLevel: 'unsupported', aliases: ['blazer', 'jacket', 'coat', 'cardigan', 'outerwear', 'overshirt', 'vest'] },
  { key: 'long_kurta', label: 'Long Kurta', supportLevel: 'unsupported', aliases: ['anarkali', 'kurta dress', 'long kurta'] },
];

const UPPER_BODY_KEYWORDS = [
  'shirt',
  't-shirt',
  'tshirt',
  'tee',
  'top',
  'blouse',
  'jacket',
  'hoodie',
  'sweater',
  'sweatshirt',
  'cardigan',
  'polo',
  'tank',
  'camisole',
  'cami',
  'kurta',
  'kurti',
  'blazer',
  'coat',
  'upper',
  'outerwear',
  'vest'
];

const NON_UPPER_BODY_KEYWORDS = [
  'pant',
  'pants',
  'trouser',
  'trousers',
  'jean',
  'jeans',
  'skirt',
  'short',
  'shorts',
  'legging',
  'leggings',
  'dress',
  'gown',
  'jumpsuit',
  'romper',
  'saree',
  'lehenga',
  'dupatta',
  'scarf',
  'shoe',
  'shoes',
  'sandal',
  'heel',
  'bag',
  'belt',
  'sock',
  'socks'
];

export const detectCatalogCategory = (item: CatalogSyncInputItem): CatalogCategoryMatch | null => {
  const explicitGarmentType = normalizeHaystack(item.garmentType);
  const haystack = [item.garmentType, item.category, item.productName]
    .map((value) => normalizeHaystack(value))
    .filter(Boolean)
    .join(' ');

  const candidates: Array<{ aliasLength: number; rule: CatalogCategoryMatch }> = [];
  for (const rule of CATEGORY_RULES) {
    for (const alias of rule.aliases) {
      const normalizedAlias = normalizeHaystack(alias);
      if (normalizedAlias && haystack.includes(normalizedAlias)) {
        candidates.push({ aliasLength: normalizedAlias.length, rule });
        break;
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((left, right) => right.aliasLength - left.aliasLength);
    return candidates[0].rule;
  }

  if (NON_UPPER_BODY_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return null;
  }

  const explicitUpper = ['upper', 'upper body', 'upper_body', 'top', 'tops'].includes(explicitGarmentType);
  const inferredUpper = UPPER_BODY_KEYWORDS.some((keyword) => haystack.includes(keyword));
  if (explicitUpper || inferredUpper) {
    return { key: 'generic_top', label: 'Upper-Body Garment', supportLevel: 'launch_ready' };
  }

  return null;
};

const splitCsvLine = (line: string) =>
  line
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, ''));

const getRecordValue = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value) return value;
  }
  return '';
};

const decodeXmlText = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const readXmlField = (node: string, names: string[]) => {
  for (const name of names) {
    const regex = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
    const match = node.match(regex);
    if (match?.[1]) {
      return decodeXmlText(match[1].trim());
    }
  }
  return '';
};

const parseCsvFeed = (feedText: string): CatalogSyncInputItem[] => {
  const lines = feedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});

    return {
      productId: getRecordValue(row, ['productid', 'product_id', 'sku', 'id']),
      productName: getRecordValue(row, ['productname', 'product_name', 'title', 'name']),
      category: getRecordValue(row, ['category', 'producttype', 'product_type', 'type']),
      garmentType: getRecordValue(row, ['garmenttype', 'garment_type']),
      imageUrl: getRecordValue(row, ['imageurl', 'image_url', 'image', 'image_link']),
    };
  });
};

const parseJsonFeed = (feedText: string): CatalogSyncInputItem[] => {
  const parsed = JSON.parse(feedText);
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.products)
      ? parsed.products
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];

  return source.map((item: Record<string, unknown>) => ({
    productId: String(item.productId || item.product_id || item.sku || item.id || ''),
    productName: String(item.productName || item.product_name || item.title || item.name || ''),
    category: String(item.category || item.productType || item.product_type || item.type || ''),
    garmentType: String(item.garmentType || item.garment_type || ''),
    imageUrl: String(item.imageUrl || item.image_url || item.image || item.image_link || ''),
  }));
};

const parseXmlFeed = (feedText: string): CatalogSyncInputItem[] => {
  const productNodes = [
    ...Array.from(feedText.matchAll(/<product\b[\s\S]*?<\/product>/gi)).map((match) => match[0]),
    ...Array.from(feedText.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]),
    ...Array.from(feedText.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((match) => match[0]),
  ];

  return productNodes.map((node) => ({
    productId: readXmlField(node, ['productId', 'product_id', 'sku', 'id', 'g:id']),
    productName: readXmlField(node, ['productName', 'product_name', 'title', 'name', 'g:title']),
    category: readXmlField(node, ['category', 'productType', 'product_type', 'type', 'g:google_product_category']),
    garmentType: readXmlField(node, ['garmentType', 'garment_type']),
    imageUrl: readXmlField(node, ['imageUrl', 'image_url', 'image', 'image_link', 'g:image_link']),
  }));
};

export const normalizeCatalogItem = (item: CatalogSyncInputItem): NormalizedCatalogItem | null => {
  const productId = String(item.productId || '').trim();
  if (!productId) {
    return null;
  }

  const detectedCategory = detectCatalogCategory(item);

  return {
    productId,
    productName: String(item.productName || '').trim() || undefined,
    category: detectedCategory?.label || String(item.category || '').trim() || undefined,
    garmentType: detectedCategory ? 'upper' : String(item.garmentType || '').trim() || undefined,
    imageUrl: String(item.imageUrl || '').trim() || undefined,
  };
};

export const isSupportedUpperBodyItem = (item: CatalogSyncInputItem) => {
  const detectedCategory = detectCatalogCategory(item);
  return Boolean(detectedCategory && detectedCategory.supportLevel !== 'unsupported');
};

export const parseCatalogFeed = (feedText: string, contentType = '', sourceHint = ''): CatalogSyncInputItem[] => {
  const normalizedType = contentType.toLowerCase();
  const normalizedHint = sourceHint.toLowerCase();
  const trimmed = feedText.trim();

  if (normalizedHint.includes('json') || normalizedType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJsonFeed(feedText);
  }

  if (normalizedHint.includes('xml') || normalizedType.includes('xml') || trimmed.startsWith('<')) {
    return parseXmlFeed(feedText);
  }

  return parseCsvFeed(feedText);
};
