import { z } from "zod";
import { PRODUCT_OPTION_CREATED_WITHIN_VALUES } from "@/lib/product/config/product-option-list";

/**
 * Catalogue input schemas.
 *
 * Every server function treats its input as `unknown` and parses it here, so
 * these are the only place the accepted shape is defined. Actor fields
 * (`createdBy` / `updatedBy`) are deliberately absent: they come from the
 * verified session, never from the client.
 */

export const productStatusSchema = z.enum(["draft", "published", "archived"]);

/** URL-safe identifier: lowercase letters, digits and single hyphens. */
export const handleSchema = z
  .string()
  .trim()
  .min(1, "Handle is required")
  .max(120, "Handle is too long")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Handle may only contain lowercase letters, numbers and hyphens",
  );

/** Derive a handle from a title. Callers still validate the result. */
export const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

export const currencyCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .length(3, "Currency code must be 3 letters")
  .regex(/^[a-z]{3}$/, "Currency code must be 3 letters");

/** Money is an integer in the currency's minor unit. */
export const priceAmountSchema = z
  .number()
  .int("Amount must be a whole number of minor units")
  .min(0, "Amount cannot be negative")
  .max(1_000_000_000_000);

export const priceInputSchema = z.object({
  currencyCode: currencyCodeSchema,
  amount: priceAmountSchema,
});

/**
 * How a product adopts an option.
 *
 * Either it reuses one from the shared library and names which of that option's
 * values apply, or it defines an option that belongs to this product alone.
 */
export const productOptionSelectionInputSchema = z.union([
  z.object({
    optionId: z.uuid("Invalid option ID"),
    valueIds: z
      .array(z.uuid("Invalid option value ID"))
      .min(1, "Select at least one value")
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Option values must be unique",
      ),
  }),
  z.object({
    title: z.string().trim().min(1, "Option title is required").max(100),
    values: z
      .array(z.string().trim().min(1).max(100))
      .min(1, "An option needs at least one value")
      .max(50, "An option may have at most 50 values")
      .refine(
        (values) => new Set(values).size === values.length,
        "Option values must be unique",
      ),
  }),
]);

/** How many values a selection carries, whichever shape it uses. */
export const optionSelectionValueCount = (
  selection: z.infer<typeof productOptionSelectionInputSchema>,
): number =>
  "optionId" in selection ? selection.valueIds.length : selection.values.length;

export const listProductsInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  status: productStatusSchema.nullish(),
  collectionId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  sortBy: z.enum(["title", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getProductInputSchema = z.object({
  id: z.uuid("Invalid product ID"),
});

/**
 * A variant the client chose explicitly.
 *
 * Option values are sent as strings in the same order as `options`, because the
 * option value IDs do not exist until the server creates them.
 */
export const productVariantInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).nullish(),
  manageInventory: z.boolean().default(true),
  allowBackorder: z.boolean().default(false),
  inventoryQuantity: z.number().int().min(0).max(1_000_000).default(0),
  optionValues: z.array(z.string().trim().min(1)).max(3).default([]),
  prices: z.array(priceInputSchema).max(20).default([]),
});

/**
 * Type and tags travel as values, not ids.
 *
 * Both are keyed by a unique value and the Organize step lets an author type a
 * name that may not exist yet, so the server upserts. Sending ids would force
 * the client to create the row first, in a second round trip that could leave
 * an orphan if the product then failed to save.
 */
export const productTypeValueSchema = z.string().trim().max(100);
export const productTagValuesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(20, "A product may have at most 20 tags")
  .default([]);

export const createProductInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  handle: handleSchema.optional(),
  subtitle: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(5000).nullish(),
  status: productStatusSchema.default("draft"),
  collectionId: z.uuid().nullish(),
  typeValue: productTypeValueSchema.nullish(),
  tagValues: productTagValuesSchema,
  categoryIds: z.array(z.uuid()).max(20).default([]),
  discountable: z.boolean().default(true),
  thumbnailAssetId: z.uuid().nullish(),
  assetIds: z.array(z.uuid()).max(50).default([]),
  options: z.array(productOptionSelectionInputSchema).max(3).default([]),
  /** Prices applied to every generated variant when `variants` is omitted. */
  prices: z.array(priceInputSchema).max(20).default([]),
  /**
   * Explicit variant list. When present it replaces the generated cartesian
   * product, so the caller controls which combinations exist and what each one
   * costs. Omit it to have every combination generated automatically.
   */
  variants: z.array(productVariantInputSchema).max(200).optional(),
});

export const updateProductInputSchema = z.object({
  id: z.uuid("Invalid product ID"),
  title: z.string().trim().min(1).max(200).optional(),
  handle: handleSchema.optional(),
  subtitle: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(5000).nullish(),
  status: productStatusSchema.optional(),
  collectionId: z.uuid().nullish(),
  typeValue: productTypeValueSchema.nullish(),
  tagValues: productTagValuesSchema.optional(),
  categoryIds: z.array(z.uuid()).max(20).optional(),
  discountable: z.boolean().optional(),
  thumbnailAssetId: z.uuid().nullish(),
  assetIds: z.array(z.uuid()).max(50).optional(),
});

export const deleteProductsInputSchema = z.object({
  ids: z
    .array(z.uuid("Invalid product ID"))
    .min(1, "Select at least one product")
    .max(100, "A maximum of 100 products may be deleted at once"),
});

export const updateVariantInputSchema = z.object({
  id: z.uuid("Invalid variant ID"),
  title: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(100).nullish(),
  rank: z.number().int().min(0).max(10_000).optional(),
  manageInventory: z.boolean().optional(),
  allowBackorder: z.boolean().optional(),
  inventoryQuantity: z.number().int().min(0).max(1_000_000).optional(),
  weight: z.number().int().min(0).nullish(),
  length: z.number().int().min(0).nullish(),
  width: z.number().int().min(0).nullish(),
  height: z.number().int().min(0).nullish(),
  prices: z.array(priceInputSchema).max(20).optional(),
});

export const deleteVariantsInputSchema = z.object({
  ids: z
    .array(z.uuid("Invalid variant ID"))
    .min(1, "Select at least one variant")
    .max(100),
});

export const listCollectionsInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  sortBy: z.enum(["title", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const createCollectionInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  handle: handleSchema.optional(),
  description: z.string().trim().max(2000).nullish(),
});

export const updateCollectionInputSchema = z.object({
  id: z.uuid("Invalid collection ID"),
  title: z.string().trim().min(1).max(200).optional(),
  handle: handleSchema.optional(),
  description: z.string().trim().max(2000).nullish(),
});

export const deleteCollectionsInputSchema = z.object({
  ids: z
    .array(z.uuid("Invalid collection ID"))
    .min(1, "Select at least one collection")
    .max(100),
});

export const listProductOptionsInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  createdWithin: z.enum(PRODUCT_OPTION_CREATED_WITHIN_VALUES).nullish(),
  sortBy: z.enum(["title", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export const createProductOptionInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  values: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one value")
    .max(50, "An option may have at most 50 values")
    .refine(
      (values) => new Set(values).size === values.length,
      "Values must be unique",
    ),
});

export const updateProductOptionInputSchema = z.object({
  id: z.uuid("Invalid option ID"),
  title: z.string().trim().min(1).max(100).optional(),
  values: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one value")
    .max(50)
    .refine(
      (values) => new Set(values).size === values.length,
      "Values must be unique",
    )
    .optional(),
});

export const deleteProductOptionsInputSchema = z.object({
  ids: z
    .array(z.uuid("Invalid option ID"))
    .min(1, "Select at least one option")
    .max(100),
});

/**
 * Categories.
 *
 * `parentCategoryId` is only accepted on create: moving a category would have
 * to rewrite every descendant's materialised path, so the update schema
 * deliberately omits it — the same fields Medusa's edit form exposes.
 */
export const listProductCategoriesInputSchema = z.object({
  query: z.string().trim().max(200).nullish(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const createProductCategoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  handle: handleSchema.optional(),
  description: z.string().trim().max(2000).default(""),
  parentCategoryId: z.uuid().nullish(),
  isActive: z.boolean().default(false),
  isInternal: z.boolean().default(false),
});

export const updateProductCategoryInputSchema = z.object({
  id: z.uuid("Invalid category ID"),
  name: z.string().trim().min(1).max(200).optional(),
  handle: handleSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
  isInternal: z.boolean().optional(),
});

export const deleteProductCategoriesInputSchema = z.object({
  ids: z
    .array(z.uuid("Invalid category ID"))
    .min(1, "Select at least one category")
    .max(100, "A maximum of 100 categories may be deleted at once"),
});

export type ListProductsInput = z.infer<typeof listProductsInputSchema>;
export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantInputSchema>;
