import { findCurrency, toMinorUnits } from "@/lib/currency/catalog";
import { metadataInputSchema, productStatusSchema } from "@/lib/validations/product";
import { z } from "zod";

export const PRODUCT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMPORT_MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 20_000;

export const PRODUCT_IMPORT_TEMPLATE = [
  "Product Id,Product Handle,Product Title,Product Status,Product Description,Product Subtitle,Collection Id,Product Type,Category Id 1,Product Tag 1,Sales Channel Id 1,Discountable,Product Image 1,Product Metadata,Variant Id,Variant Title,Variant Sku,Variant Barcode,Manage Inventory,Allow Backorder,Inventory Quantity,Variant Option 1 Name,Variant Option 1 Value,Variant Price USD",
  ",,Everyday Mug,draft,A ceramic mug,12 oz,,,,,,,,,,Blue / 12 oz,MUG-12-BLUE,,true,false,0,Color,Blue,12.99",
  ",,Everyday Mug,draft,A ceramic mug,12 oz,,,,,,,,,,Red / 12 oz,MUG-12-RED,,true,false,0,Color,Red,12.99",
].join("\r\n");

export interface ProductImportIssue {
  row: number | null;
  field?: string;
  message: string;
}

export interface ProductImportRow {
  row: number;
  productId?: string;
  variantId?: string;
  product: {
    title?: string;
    handle?: string;
    status?: "draft" | "published" | "archived";
    description?: string | null;
    subtitle?: string | null;
    collectionId?: string | null;
    typeValue?: string;
    categoryIds?: string[];
    categoryNames?: string[];
    tagValues?: string[];
    salesChannelIds?: string[];
    discountable?: boolean;
    assetIds?: string[];
    metadata?: Record<string, string>;
  };
  variant: {
    title?: string;
    sku?: string | null;
    barcode?: string | null;
    manageInventory?: boolean;
    allowBackorder?: boolean;
    inventoryQuantity?: number;
    optionValues?: Array<{ name: string; value: string }>;
    prices?: Array<{ currencyCode: string; amount: number }>;
    metadata?: Record<string, string>;
  };
}

export interface ProductImportGroup {
  key: string;
  productId?: string;
  rows: ProductImportRow[];
}

export interface ProductImportPlan {
  rows: number;
  groups: ProductImportGroup[];
  createCount: number;
  updateCount: number;
  variantCount: number;
  issues: ProductImportIssue[];
}

const splitCsv = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let justClosedQuote = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL_LENGTH) throw new Error("CSV cell is too long");
    row.push(cell);
    cell = "";
    justClosedQuote = false;
    if (row.length > MAX_COLUMNS) throw new Error("CSV has too many columns");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > PRODUCT_IMPORT_MAX_ROWS + 1) {
      throw new Error("CSV has too many rows");
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (justClosedQuote && character !== "," && character !== "\r" && character !== "\n" && !/\s/.test(character)) {
      throw new Error("CSV has characters after a closing quote");
    }
    if (character === '"') {
      if (cell.trim() !== "") throw new Error("CSV has a quote inside an unquoted field");
      cell = "";
      quoted = true;
    } else if (character === ",") {
      pushCell();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
    } else if (!justClosedQuote) {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
};

const normalizedHeader = (value: string) =>
  value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
const uuidSchema = z.uuid();
const optionalUuid = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return { value: undefined, error: false };
  const parsed = uuidSchema.safeParse(trimmed);
  return parsed.success
    ? { value: parsed.data, error: false }
    : { value: undefined, error: true };
};

const optionalBoolean = (value: string | undefined) => {
  if (!value?.trim()) return { value: undefined, error: false };
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return { value: true, error: false };
  if (["false", "0", "no"].includes(normalized)) return { value: false, error: false };
  return { value: undefined, error: true };
};

const optionalNumber = (value: string | undefined) => {
  if (!value?.trim()) return { value: undefined, error: false };
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0
    ? { value: parsed, error: false }
    : { value: undefined, error: true };
};

const localAssetId = (value: string): string | null => {
  const trimmed = value.trim();
  if (uuidSchema.safeParse(trimmed).success) return trimmed;
  try {
    const url = new URL(trimmed, "https://morph.invalid");
    const match = /^\/api\/store\/assets\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
    return url.origin === "https://morph.invalid" && !url.search && !url.hash && match && uuidSchema.safeParse(match[1]).success
      ? match[1]!
      : null;
  } catch {
    return null;
  }
};

const indexedValues = (
  headers: string[],
  cells: string[],
  pattern: RegExp,
  row: number,
  issues: ProductImportIssue[],
) => {
  const entries: Array<{ index: number; value: string }> = [];
  headers.forEach((header, index) => {
    const match = pattern.exec(header);
    const value = cells[index]?.trim() ?? "";
    if (match && value) entries.push({ index: Number(match[1]), value });
  });
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.index)) {
      issues.push({ row, message: "A numbered CSV field appears more than once" });
    }
    seen.add(entry.index);
  }
  return entries.sort((a, b) => a.index - b.index).map((entry) => entry.value);
};

const parsePrices = (
  headers: string[],
  cells: string[],
  row: number,
  issues: ProductImportIssue[],
) => {
  const prices: Array<{ currencyCode: string; amount: number }> = [];
  const currencies = new Set<string>();
  headers.forEach((header, index) => {
    const match = /^(?:variant )?price(?: .+?)?(?:\[([a-z]{3})\]|\s([a-z]{3}))$/i.exec(header);
    const value = cells[index]?.trim() ?? "";
    if (!value) return;
    if (!match) {
      if (/^(?:variant )?price\b/i.test(header)) {
        issues.push({ row, field: header, message: "Price columns must end with a supported three-letter currency code" });
      }
      return;
    }
    const currencyCode = (match[1] ?? match[2] ?? "").toLowerCase();
    if (currencies.has(currencyCode)) {
      issues.push({ row, field: header, message: `Currency ${currencyCode.toUpperCase()} is listed more than once` });
      return;
    }
    const currency = findCurrency(currencyCode);
    const numeric = /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
    if (!currency || !Number.isFinite(numeric) || numeric > 1_000_000_000) {
      issues.push({ row, field: header, message: "Use a supported ISO currency and a non-negative decimal price" });
      return;
    }
    const amount = toMinorUnits(numeric, currency);
    if (!Number.isSafeInteger(amount) || amount > 1_000_000_000_000) {
      issues.push({ row, field: header, message: "Price is above the supported maximum" });
      return;
    }
    prices.push({ currencyCode, amount });
    currencies.add(currencyCode);
  });
  return prices;
};

const parseJsonCell = (value: string, row: number, field: string, issues: ProductImportIssue[]): unknown => {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    issues.push({ row, field, message: "This cell must contain valid JSON" });
    return undefined;
  }
};

const stringArray = (value: string, row: number, field: string, issues: ProductImportIssue[]) => {
  const parsed = parseJsonCell(value, row, field, issues);
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    issues.push({ row, field, message: "Use a JSON array of strings" });
    return [];
  }
  return parsed as string[];
};

const jsonPrices = (value: string, row: number, issues: ProductImportIssue[]) => {
  if (!value.trim()) return [] as Array<{ currencyCode: string; amount: number }>;
  const parsed = parseJsonCell(value, row, "Variant Prices", issues);
  if (!Array.isArray(parsed)) {
    issues.push({ row, field: "Variant Prices", message: "Use a JSON array of {currencyCode, amount}" });
    return [];
  }
  const prices: Array<{ currencyCode: string; amount: number }> = [];
  const currencies = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || !("currencyCode" in entry) || !("amount" in entry)) {
      issues.push({ row, field: "Variant Prices", message: "Each price needs currencyCode and amount" });
      continue;
    }
    const currencyCode = typeof entry.currencyCode === "string" ? entry.currencyCode.toLowerCase() : "";
    const amount = entry.amount;
    if (!findCurrency(currencyCode) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000_000 || currencies.has(currencyCode)) {
      issues.push({ row, field: "Variant Prices", message: "Each price needs one supported currency and a valid minor-unit amount" });
      continue;
    }
    currencies.add(currencyCode);
    prices.push({ currencyCode, amount });
  }
  return prices;
};

const metadataValue = (
  value: string | undefined,
  row: number,
  field: string,
  issues: ProductImportIssue[],
) => {
  if (!value?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = metadataInputSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // Report below with a field-local error.
  }
  issues.push({ row, field, message: "Metadata must be a JSON object with string values" });
  return undefined;
};

export function parseProductImportCsv(source: string): ProductImportPlan {
  const issues: ProductImportIssue[] = [];
  if (new TextEncoder().encode(source).byteLength > PRODUCT_IMPORT_MAX_BYTES) {
    return { rows: 0, groups: [], createCount: 0, updateCount: 0, variantCount: 0, issues: [{ row: null, message: "CSV file exceeds the 5 MB limit" }] };
  }

  let records: string[][];
  try {
    records = splitCsv(source);
  } catch (error) {
    return { rows: 0, groups: [], createCount: 0, updateCount: 0, variantCount: 0, issues: [{ row: null, message: error instanceof Error ? error.message : "CSV could not be parsed" }] };
  }
  if (records.length < 2) {
    return { rows: 0, groups: [], createCount: 0, updateCount: 0, variantCount: 0, issues: [{ row: null, message: "CSV must include a header and at least one product row" }] };
  }

  const headers = records[0]!.map(normalizedHeader);
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    return { rows: 0, groups: [], createCount: 0, updateCount: 0, variantCount: 0, issues: [{ row: 1, message: `Duplicate column: ${duplicateHeaders[0]}` }] };
  }
  if (!headers.includes("product title") && !headers.includes("product id")) {
    return { rows: 0, groups: [], createCount: 0, updateCount: 0, variantCount: 0, issues: [{ row: 1, message: "CSV needs a Product Title or Product Id column" }] };
  }
  const groups = new Map<string, ProductImportGroup>();
  const aliases = new Map([
    ["collection id", "product collection id"],
    ["product type", "product type"],
    ["discountable", "product discountable"],
    ["thumbnail url", "product thumbnail"],
    ["thumbnail asset id", "product thumbnail asset id"],
    ["variant manage inventory", "manage inventory"],
    ["variant allow backorder", "allow backorder"],
    ["variant inventory quantity", "inventory quantity"],
    ["variant prices", "variant prices"],
    ["variant option values", "variant option values"],
    ["option values", "variant option values"],
    ["image urls", "image urls"],
    ["sales channels", "sales channels"],
    ["tags", "tags"],
    ["categories", "categories"],
  ]);
  const canonicalHeaders = headers.map((header) => aliases.get(header) ?? header);
  const knownFixed = new Set([
    "product id", "product handle", "product title", "product status", "product description", "product subtitle",
    "product collection id", "product type", "product discountable", "product thumbnail", "product thumbnail asset id",
    // These exported audit/display fields are informational and are rebuilt by
    // Morph when a product is created or updated.
    "collection title", "type id", "variant rank", "created at", "updated at",
    "product metadata", "variant id", "variant title", "variant sku", "variant barcode", "manage inventory", "allow backorder",
    "inventory quantity", "variant metadata", "variant prices", "variant option values", "image urls", "sales channels", "tags", "categories",
  ]);

  records.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim())) {
      issues.push({ row: rowNumber, message: "This row has more values than the header" });
    }
    const rowValues = new Map(canonicalHeaders.map((header, column) => [header, cells[column]?.trim() ?? ""]));
    const get = (name: string) => rowValues.get(name) ?? "";
    const productIdResult = optionalUuid(get("product id"));
    const variantIdResult = optionalUuid(get("variant id"));
    if (productIdResult.error) issues.push({ row: rowNumber, field: "Product Id", message: "Product Id must be a Morph product UUID" });
    if (variantIdResult.error) issues.push({ row: rowNumber, field: "Variant Id", message: "Variant Id must be a Morph variant UUID" });

    for (const [header, value] of rowValues) {
      if (!value) continue;
      const isDynamic = /^(?:product )?(?:category(?: id)?|tag|sales channel id|image) \d+$|^variant option \d+ (?:name|value)$|^(?:variant )?price .+$/i.test(header);
      if (!knownFixed.has(header) && !isDynamic) {
        issues.push({ row: rowNumber, field: header, message: "This column is not supported by Morph's product importer" });
      }
    }

    const title = get("product title") || undefined;
    if (!productIdResult.value && !title) issues.push({ row: rowNumber, field: "Product Title", message: "New products need a title" });
    const rawStatus = get("product status").toLowerCase();
    const status = rawStatus ? productStatusSchema.safeParse(rawStatus) : undefined;
    if (status && !status.success) issues.push({ row: rowNumber, field: "Product Status", message: "Status must be draft, published, or archived" });

    const discountable = optionalBoolean(get("product discountable"));
    const manageInventory = optionalBoolean(get("variant manage inventory"));
    const allowBackorder = optionalBoolean(get("variant allow backorder"));
    const quantity = optionalNumber(get("variant inventory quantity"));
    if (discountable.error) issues.push({ row: rowNumber, field: "Product Discountable", message: "Use true or false" });
    if (manageInventory.error) issues.push({ row: rowNumber, field: "Variant Manage Inventory", message: "Use true or false" });
    if (allowBackorder.error) issues.push({ row: rowNumber, field: "Variant Allow Backorder", message: "Use true or false" });
    if (quantity.error || (quantity.value !== undefined && (!Number.isInteger(quantity.value) || quantity.value > 1_000_000))) {
      issues.push({ row: rowNumber, field: "Variant Inventory Quantity", message: "Quantity must be a whole number between 0 and 1,000,000" });
    }

    const collection = optionalUuid(get("product collection id"));
    const type = get("product type").trim();
    const categories = indexedValues(headers, cells, /^(?:product )?category id (\d+)$/i, rowNumber, issues)
      .map((value) => optionalUuid(value));
    const namedCategories = indexedValues(headers, cells, /^(?:product )?category (\d+)$/i, rowNumber, issues);
    const tags = indexedValues(headers, cells, /^(?:product )?tag (\d+)$/i, rowNumber, issues);
    const channels = indexedValues(headers, cells, /^(?:product )?sales channel id (\d+)$/i, rowNumber, issues)
      .map((value) => optionalUuid(value));
    for (const [field, result] of [["Product Collection Id", collection]] as const) {
      if (result.error) issues.push({ row: rowNumber, field, message: `${field} must be a Morph UUID` });
    }
    for (const [field, values] of [["Product Category", categories], ["Product Sales Channel", channels]] as const) {
      if (values.some((value) => value.error)) issues.push({ row: rowNumber, field, message: `${field} values must be Morph UUIDs` });
    }

    const exportTags = stringArray(get("tags"), rowNumber, "Tags", issues);
    const allTagValues = [...tags, ...exportTags];
    const exportCategories = stringArray(get("categories"), rowNumber, "Categories", issues);
    const categoryIds = [
      ...categories.flatMap((value) => value.value ? [value.value] : []),
      ...namedCategories.flatMap((value) => uuidSchema.safeParse(value).success ? [value] : []),
    ];
    const categoryNames = [
      ...namedCategories.filter((value) => !uuidSchema.safeParse(value).success),
      ...exportCategories.filter((value) => !uuidSchema.safeParse(value).success),
    ];
    const exportChannels: string[] = [];
    if (get("sales channels")) {
      const parsedChannels = parseJsonCell(get("sales channels"), rowNumber, "Sales Channels", issues);
      if (!Array.isArray(parsedChannels)) {
        issues.push({ row: rowNumber, field: "Sales Channels", message: "Use a JSON array of channel objects with an id" });
      } else {
        for (const channel of parsedChannels) {
          const id = channel && typeof channel === "object" && "id" in channel && typeof channel.id === "string" ? channel.id : "";
          if (!uuidSchema.safeParse(id).success) issues.push({ row: rowNumber, field: "Sales Channels", message: "Every sales channel needs a Morph UUID id" });
          else exportChannels.push(id);
        }
      }
    }

    const assetValues = [
      ...indexedValues(headers, cells, /^(?:product )?image (\d+)$/i, rowNumber, issues),
      ...stringArray(get("image urls"), rowNumber, "Image URLs", issues),
      get("product thumbnail asset id"),
      get("product thumbnail"),
    ].filter(Boolean);
    const assetIds: string[] = [];
    for (const value of assetValues) {
      const id = localAssetId(value);
      if (!id) issues.push({ row: rowNumber, field: "Product Image", message: "Images must reference an existing Morph asset UUID or /api/store/assets/{id} URL" });
      else if (!assetIds.includes(id)) assetIds.push(id);
    }

    const optionNames = headers.flatMap((header) => {
      const match = /^variant option (\d+) name$/i.exec(header);
      return match ? [{ index: Number(match[1]), name: get(header) }] : [];
    }).filter((option) => option.name).sort((a, b) => a.index - b.index);
    const optionValues = optionNames.flatMap((option) => {
      const header = `variant option ${option.index} value`;
      const value = get(header);
      return value ? [{ name: option.name, value }] : [];
    });
    if (optionNames.some((option) => !get(`variant option ${option.index} value`))) {
      issues.push({ row: rowNumber, field: "Variant Option", message: "Every option name needs a matching value" });
    }
    if (get("variant option values")) {
      const parsedOptions = parseJsonCell(get("variant option values"), rowNumber, "Variant Option Values", issues);
      if (!Array.isArray(parsedOptions)) {
        issues.push({ row: rowNumber, field: "Variant Option Values", message: "Use a JSON array of {option, value}" });
      } else {
        for (const option of parsedOptions) {
          if (option && typeof option === "object" && "option" in option && "value" in option && typeof option.option === "string" && typeof option.value === "string") {
            optionValues.push({ name: option.option, value: option.value });
          } else issues.push({ row: rowNumber, field: "Variant Option Values", message: "Each option needs option and value strings" });
        }
      }
    }
    const optionNameSet = new Set(optionValues.map((option) => option.name.toLowerCase()));
    if (optionNameSet.size !== optionValues.length) {
      issues.push({ row: rowNumber, field: "Variant Option", message: "Option names must be unique within a variant" });
    }
    const metadata = metadataValue(get("product metadata"), rowNumber, "Product Metadata", issues);
    const variantMetadata = metadataValue(get("variant metadata"), rowNumber, "Variant Metadata", issues);
    const prices = [...parsePrices(headers, cells, rowNumber, issues), ...jsonPrices(get("variant prices"), rowNumber, issues)];
    const priceCurrencies = new Set<string>();
    for (const price of prices) {
      if (priceCurrencies.has(price.currencyCode)) {
        issues.push({ row: rowNumber, field: "Variant Price", message: `Currency ${price.currencyCode.toUpperCase()} is listed more than once` });
      }
      priceCurrencies.add(price.currencyCode);
    }
    const variantTitle = get("variant title") || optionValues.map((option) => option.value).join(" / ") || undefined;
    const row: ProductImportRow = {
      row: rowNumber,
      ...(productIdResult.value ? { productId: productIdResult.value } : {}),
      ...(variantIdResult.value ? { variantId: variantIdResult.value } : {}),
      product: {
        ...(title ? { title } : {}),
        ...(get("product handle") ? { handle: get("product handle") } : {}),
        ...(status?.success ? { status: status.data } : {}),
        ...(get("product description") ? { description: get("product description") } : {}),
        ...(get("product subtitle") ? { subtitle: get("product subtitle") } : {}),
        ...(collection.value ? { collectionId: collection.value } : get("product collection id") ? { collectionId: null } : {}),
        ...(type ? { typeValue: type } : {}),
        ...(categoryIds.length
          ? { categoryIds: [...new Set(categoryIds)] }
          : {}),
        ...(categoryNames.length ? { categoryNames: [...new Set(categoryNames)] } : {}),
        ...(allTagValues.length ? { tagValues: [...new Set(allTagValues)] } : {}),
        ...([...channels.flatMap((value) => value.value ? [value.value] : []), ...exportChannels].length
          ? { salesChannelIds: [...new Set([...channels.flatMap((value) => value.value ? [value.value] : []), ...exportChannels])] }
          : {}),
        ...(discountable.value !== undefined ? { discountable: discountable.value } : {}),
        ...(assetIds.length ? { assetIds } : {}),
        ...(metadata ? { metadata } : {}),
      },
      variant: {
        ...(get("variant title") || optionValues.length ? { title: variantTitle } : {}),
        ...(get("variant sku") ? { sku: get("variant sku") } : {}),
        ...(get("variant barcode") ? { barcode: get("variant barcode") } : {}),
        ...(manageInventory.value !== undefined ? { manageInventory: manageInventory.value } : {}),
        ...(allowBackorder.value !== undefined ? { allowBackorder: allowBackorder.value } : {}),
        ...(quantity.value !== undefined ? { inventoryQuantity: quantity.value } : {}),
        ...(optionValues.length ? { optionValues } : {}),
        ...((prices.length || get("variant prices")) ? { prices } : {}),
        ...(variantMetadata ? { metadata: variantMetadata } : {}),
      },
    };

    const key = row.productId ?? `new:${(row.product.handle || row.product.title || "").trim().toLowerCase()}`;
    const group = groups.get(key) ?? { key, ...(row.productId ? { productId: row.productId } : {}), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  });

  for (const group of groups.values()) {
    if (group.rows.length > 200) {
      issues.push({ row: group.rows[200]?.row ?? null, message: "A product may contain at most 200 variants per import" });
    }
    const optionCount = (group.rows[0]?.variant.optionValues ?? []).length;
    if (optionCount > 3) {
      issues.push({ row: group.rows[0]?.row ?? null, field: "Variant Option", message: "A product may use at most three option axes" });
    }
    if (!group.productId && group.rows.length > 1 && group.rows.every((row) => (row.variant.optionValues ?? []).length === 0)) {
      issues.push({ row: group.rows[0]?.row ?? null, message: "Multiple variants need Variant Option Name/Value columns" });
    }
    const options = new Set<string>();
    const productFields = ["title", "handle", "status", "description", "subtitle", "collectionId", "typeValue", "categoryIds", "categoryNames", "tagValues", "salesChannelIds", "discountable", "assetIds", "metadata"] as const;
    for (const field of productFields) {
      const values = group.rows.flatMap((row) => row.product[field] === undefined ? [] : [JSON.stringify(row.product[field])]);
      if (new Set(values).size > 1) {
        issues.push({ row: group.rows[1]?.row ?? null, field: `Product ${field}`, message: "Product fields must match across all rows for the same product" });
      }
    }
    const axes = group.rows.map((row) => (row.variant.optionValues ?? []).map((option) => option.name.trim().toLowerCase()));
    const firstAxes = axes[0] ?? [];
    for (const [rowIndex, rowAxes] of axes.entries()) {
      if (rowAxes.join("\u0000") !== firstAxes.join("\u0000")) {
        issues.push({ row: group.rows[rowIndex]?.row ?? null, field: "Variant Option", message: "Every variant in one product must use the same option names and order" });
      }
    }
    for (const row of group.rows) {
      const combination = (row.variant.optionValues ?? []).map((option) => `${option.name.toLowerCase()}=${option.value.toLowerCase()}`).join("|");
      if (combination && options.has(combination)) issues.push({ row: row.row, field: "Variant Option", message: "This product has a duplicate variant option combination" });
      if (combination) options.add(combination);
    }
  }

  const variantOwner = new Map<string, string>();
  for (const group of groups.values()) {
    for (const row of group.rows) {
      if (!row.variantId) continue;
      const owner = variantOwner.get(row.variantId);
      if (owner) {
        issues.push({ row: row.row, field: "Variant Id", message: "A variant may only appear once per import" });
      } else variantOwner.set(row.variantId, group.key);
      if (!group.productId) {
        issues.push({ row: row.row, field: "Variant Id", message: "Variant Id requires a Product Id" });
      }
    }
  }

  const values = [...groups.values()];
  const updateCount = values.filter((group) => Boolean(group.productId)).length;
  return {
    rows: records.length - 1,
    groups: values,
    createCount: values.length - updateCount,
    updateCount,
    variantCount: values.reduce((count, group) => count + group.rows.length, 0),
    issues,
  };
}
