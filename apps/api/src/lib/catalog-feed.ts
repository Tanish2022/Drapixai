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

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

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

  return {
    productId,
    productName: String(item.productName || '').trim() || undefined,
    category: String(item.category || '').trim() || undefined,
    garmentType: String(item.garmentType || '').trim() || undefined,
    imageUrl: String(item.imageUrl || '').trim() || undefined,
  };
};

export const isSupportedUpperBodyItem = (item: CatalogSyncInputItem) => {
  const garmentType = normalizeText(item.garmentType);
  if (['upper', 'upper_body', 'top', 'tops'].includes(garmentType)) {
    return true;
  }
  if (garmentType && !['upper', 'upper_body', 'top', 'tops'].includes(garmentType)) {
    return false;
  }

  const haystack = [item.category, item.productName]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');

  if (!haystack) {
    return false;
  }
  if (NON_UPPER_BODY_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return false;
  }
  return UPPER_BODY_KEYWORDS.some((keyword) => haystack.includes(keyword));
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
