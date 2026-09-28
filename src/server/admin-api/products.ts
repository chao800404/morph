import type {
  ProductDetailDTO,
  ProductListItemDTO,
} from "@/lib/product/dto/product.dto";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import type { AdminApiAccess } from "./orders";
import type {
  CreateProductInput,
  DeleteProductsInput,
  ProductWriteResult,
  UpdateProductInput,
} from "@/lib/product/service/product-write.service";
import type {
  CreateProductVariantInput,
  DeleteProductVariantsInput,
  ProductVariantWriteResult,
  UpdateProductVariantInput,
} from "@/lib/product/service/product-variant-write.service";
import {
  createVariantInputSchema,
  createProductInputSchema,
  updateVariantInputSchema,
  updateVariantInventoryKitInputSchema,
  updateProductInputSchema,
} from "@/lib/validations/product";
import { z } from "zod";

export type AdminProductsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  maxAssets: number;
  listProducts(input: {
    query?: string;
    status?: "draft" | "published" | "archived";
    collectionId?: string;
    categoryId?: string;
    salesChannelId?: string;
    sortBy: "createdAt" | "updatedAt" | "title";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ products: ProductListItemDTO[]; total: number }>;
  findProduct(id: string): Promise<ProductDetailDTO | null>;
  createProduct(
    input: CreateProductInput,
    actorId: string,
  ): Promise<ProductWriteResult>;
  updateProduct(
    input: UpdateProductInput,
    actorId: string,
  ): Promise<ProductWriteResult>;
  deleteProducts(
    input: DeleteProductsInput,
    actorId: string,
  ): Promise<ProductWriteResult>;
  createVariant(
    input: CreateProductVariantInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult>;
  updateVariant(
    input: UpdateProductVariantInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult>;
  updateInventoryKits(
    inputs: UpdateProductVariantInventoryKitInput[],
    actorId: string,
  ): Promise<ProductVariantWriteResult>;
  deleteVariants(
    input: DeleteProductVariantsInput,
    actorId: string,
  ): Promise<ProductVariantWriteResult>;
  findVariant(id: string): Promise<ProductVariantDTO | null>;
  listVariants(input: {
    productId: string;
    query?: string;
    sortBy: "createdAt" | "updatedAt" | "name";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }): Promise<{ variants: ProductVariantDTO[]; total: number }>;
};

type UpdateProductVariantInventoryKitInput = z.infer<
  typeof updateVariantInventoryKitInputSchema
>;

const listProductsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    collection_id: z.uuid().optional(),
    category_id: z.uuid().optional(),
    sales_channel_id: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "title",
        "-title",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    status: input.status,
    collectionId: input.collection_id,
    categoryId: input.category_id,
    salesChannelId: input.sales_channel_id,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("title")
        ? ("title" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const listVariantsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "title",
        "-title",
      ])
      .default("created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("title")
        ? ("name" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const inventoryItemLinkBodySchema = z
  .object({
    inventory_item_id: z.uuid(),
    required_quantity: z.number().finite().gt(0).max(1_000_000_000),
  })
  .strict();

const inventoryItemLinkUpdateBodySchema = z
  .object({
    required_quantity: z.number().finite().gt(0).max(1_000_000_000),
  })
  .strict();

const variantInventoryItemsBatchBodySchema = z
  .object({
    create: z
      .array(inventoryItemLinkBodySchema.extend({ variant_id: z.uuid() }))
      .max(100)
      .default([]),
    update: z
      .array(inventoryItemLinkBodySchema.extend({ variant_id: z.uuid() }))
      .max(100)
      .default([]),
    delete: z
      .array(
        z
          .object({ variant_id: z.uuid(), inventory_item_id: z.uuid() })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const operations = [
      ...input.create.map((item) => ({ ...item, action: "create" as const })),
      ...input.update.map((item) => ({ ...item, action: "update" as const })),
      ...input.delete.map((item) => ({ ...item, action: "delete" as const })),
    ];
    if (operations.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Provide at least one inventory item association change",
      });
    }
    if (operations.length > 100) {
      context.addIssue({
        code: "custom",
        message: "A batch can change at most 100 inventory item associations",
      });
    }
    const keys = operations.map(
      (item) => `${item.variant_id}:${item.inventory_item_id}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message:
          "A variant and inventory item pair can only appear once per batch",
      });
    }
  });

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const productListToApi = (product: ProductListItemDTO) => ({
  id: product.id,
  title: product.title,
  handle: product.handle,
  subtitle: product.subtitle,
  description: product.description,
  status: product.status,
  thumbnail: product.thumbnailUrl,
  collection_id: product.collectionId,
  collection: product.collectionTitle
    ? { id: product.collectionId, title: product.collectionTitle }
    : null,
  type_id: product.typeId,
  type: product.typeValue
    ? { id: product.typeId, value: product.typeValue }
    : null,
  discountable: product.discountable,
  weight: product.weight,
  length: product.length,
  width: product.width,
  height: product.height,
  origin_country: product.originCountry,
  hs_code: product.hsCode,
  mid_code: product.midCode,
  material: product.material,
  variant_count: product.variantCount,
  sales_channels: product.salesChannels.map((channel) => ({
    id: channel.id,
    name: channel.name,
  })),
  created_at: product.createdAt.toISOString(),
  updated_at: product.updatedAt.toISOString(),
});

const variantToApi = (
  variant: ProductVariantDTO,
  options: ProductDetailDTO["options"],
) => ({
  id: variant.id,
  product_id: variant.productId,
  title: variant.title,
  sku: variant.sku,
  barcode: variant.barcode,
  rank: variant.rank,
  manage_inventory: variant.manageInventory,
  allow_backorder: variant.allowBackorder,
  inventory_quantity: variant.inventoryQuantity,
  weight: variant.weight,
  length: variant.length,
  width: variant.width,
  height: variant.height,
  thumbnail: variant.assets[0]?.url ?? null,
  inventory_items: variant.inventoryKit.map((item) => ({
    inventory_item_id: item.inventoryItemId,
    required_quantity: item.requiredQuantity,
    inventory: {
      id: item.inventoryItemId,
      title: item.title,
      sku: item.sku,
      unit_of_measure: item.unitOfMeasure,
    },
  })),
  options: options.flatMap((option) =>
    option.values
      .filter((value) => variant.optionValueIds.includes(value.id))
      .map((value) => ({ id: value.id, value: value.value })),
  ),
  prices: variant.prices.map((price) => ({
    id: price.id,
    currency_code: price.currencyCode,
    amount: price.amount,
  })),
  metadata: variant.metadata,
  created_at: variant.createdAt.toISOString(),
  updated_at: variant.updatedAt.toISOString(),
});

const productDetailToApi = (
  product: ProductDetailDTO,
  variants: ProductVariantDTO[],
  variantsCount: number,
) => ({
  ...productListToApi({
    ...product,
    thumbnailUrl: product.assets[0]?.url ?? null,
    variantCount: variantsCount,
  }),
  metadata: product.metadata,
  created_by: product.createdBy,
  updated_by: product.updatedBy,
  shipping_profile_id: product.shippingProfileId,
  shipping_profile: product.shippingProfileId
    ? { id: product.shippingProfileId, name: product.shippingProfileName }
    : null,
  options: product.options.map((option) => ({
    id: option.id,
    title: option.title,
    values: option.values.map((value) => ({
      id: value.id,
      value: value.value,
    })),
  })),
  images: product.assets.map((asset) => ({ id: asset.id, url: asset.url })),
  tags: product.tags.map((tag) => ({ id: tag.id, value: tag.value })),
  categories: product.categories.map((category) => ({
    id: category.id,
    name: category.name,
  })),
  sales_channels: product.salesChannels.map((channel) => ({
    id: channel.id,
    name: channel.name,
  })),
  variants: variants.map((variant) => variantToApi(variant, product.options)),
  variants_count: variantsCount,
});

const createProductBodyKeys = new Set([
  "title",
  "handle",
  "subtitle",
  "description",
  "status",
  "collection_id",
  "type_value",
  "tag_values",
  "tags",
  "category_ids",
  "categories",
  "sales_channel_ids",
  "sales_channels",
  "discountable",
  "asset_ids",
  "metadata",
  "options",
  "prices",
  "variants",
]);

const updateProductBodyKeys = new Set([
  "title",
  "handle",
  "subtitle",
  "description",
  "status",
  "collection_id",
  "type_value",
  "tag_values",
  "tags",
  "category_ids",
  "categories",
  "discountable",
  "shipping_profile_id",
  "asset_ids",
  "metadata",
]);

const remap = (
  value: unknown,
  aliases: Record<string, string>,
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = { ...(value as Record<string, unknown>) };
  for (const [apiKey, key] of Object.entries(aliases)) {
    if (output[key] === undefined && output[apiKey] !== undefined) {
      output[key] = output[apiKey];
    }
    delete output[apiKey];
  }
  return output;
};

const normalizeProductBody = (
  rawBody: unknown,
  allowedKeys: Set<string>,
):
  | { success: true; data: Record<string, unknown> }
  | { success: false; unknownKeys: string[] } => {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { success: false, unknownKeys: [] };
  }
  const raw = rawBody as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) return { success: false, unknownKeys };

  const data = remap(raw, {
    collection_id: "collectionId",
    type_value: "typeValue",
    tag_values: "tagValues",
    category_ids: "categoryIds",
    sales_channel_ids: "salesChannelIds",
    asset_ids: "assetIds",
    shipping_profile_id: "shippingProfileId",
  });

  if (Array.isArray(raw.tags)) {
    data.tagValues = raw.tags.map((tag) =>
      tag && typeof tag === "object" && !Array.isArray(tag)
        ? (tag as Record<string, unknown>).value
        : tag,
    );
  }
  if (Array.isArray(raw.categories)) {
    data.categoryIds = raw.categories.map((category) =>
      category && typeof category === "object" && !Array.isArray(category)
        ? (category as Record<string, unknown>).id
        : category,
    );
  }
  if (Array.isArray(raw.sales_channels)) {
    data.salesChannelIds = raw.sales_channels.map((channel) =>
      channel && typeof channel === "object" && !Array.isArray(channel)
        ? (channel as Record<string, unknown>).id
        : channel,
    );
  }
  if (Array.isArray(raw.options)) {
    data.options = raw.options.map((option) =>
      remap(option, { option_id: "optionId", value_ids: "valueIds" }),
    );
  }
  if (Array.isArray(raw.prices)) {
    data.prices = raw.prices.map((price) =>
      remap(price, { currency_code: "currencyCode" }),
    );
  }
  if (Array.isArray(raw.variants)) {
    data.variants = raw.variants.map((variant) => {
      const normalized = remap(variant, {
        manage_inventory: "manageInventory",
        allow_backorder: "allowBackorder",
        inventory_quantity: "inventoryQuantity",
        option_values: "optionValues",
      });
      const optionMap = normalized.options;
      if (Array.isArray(optionMap)) normalized.optionValues = optionMap;
      else if (optionMap && typeof optionMap === "object") {
        normalized.optionValues = Object.values(
          optionMap as Record<string, unknown>,
        );
      }
      delete normalized.options;
      if (Array.isArray(normalized.prices)) {
        normalized.prices = normalized.prices.map((price) =>
          remap(price, { currency_code: "currencyCode" }),
        );
      }
      return normalized;
    });
  }

  return { success: true, data };
};

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const variantBodyKeys = new Set([
  "id",
  "title",
  "sku",
  "barcode",
  "rank",
  "variant_rank",
  "manage_inventory",
  "allow_backorder",
  "inventory_quantity",
  "weight",
  "length",
  "width",
  "height",
  "options",
  "option_value_ids",
  "prices",
  "asset_ids",
  "metadata",
]);

const normalizeVariantBody = (
  rawBody: unknown,
  product: ProductDetailDTO,
):
  | { success: true; data: Record<string, unknown> }
  | { success: false; unknownKeys: string[] } => {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { success: false, unknownKeys: [] };
  }
  const raw = rawBody as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !variantBodyKeys.has(key),
  );
  if (unknownKeys.length > 0) return { success: false, unknownKeys };

  const data = remap(raw, {
    variant_rank: "rank",
    manage_inventory: "manageInventory",
    allow_backorder: "allowBackorder",
    inventory_quantity: "inventoryQuantity",
    option_value_ids: "optionValueIds",
    asset_ids: "assetIds",
  });

  if (raw.options !== undefined) {
    const selected =
      raw.options &&
      typeof raw.options === "object" &&
      !Array.isArray(raw.options)
        ? (raw.options as Record<string, unknown>)
        : {};
    data.optionValueIds = product.options.flatMap((option) => {
      const value = selected[option.title];
      if (typeof value !== "string") return [];
      const match = option.values.find(
        (optionValue) =>
          optionValue.id === value || optionValue.value === value,
      );
      return match ? [match.id] : [];
    });
    delete data.options;
  }
  if (Array.isArray(raw.prices)) {
    data.prices = raw.prices.map((price) =>
      remap(price, { currency_code: "currencyCode" }),
    );
  }

  return { success: true, data };
};

const variantInvalidRequest = (message: string, details?: unknown) =>
  privateJson(
    {
      error: "INVALID_REQUEST",
      message,
      ...(details === undefined ? {} : { details }),
    },
    400,
  );

const variantWriteFailureResponse = (
  result: Extract<ProductVariantWriteResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : ["CONFLICT", "ACTIVE_RESERVATIONS", "EMPTY_KIT"].includes(
            result.error ?? "",
          ) || result.message.includes("already uses")
        ? 409
        : result.errors || result.error === "INVALID_REQUEST"
          ? 400
          : 500;
  return privateJson(
    {
      error: result.error ?? "INVALID_REQUEST",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const writeFailureResponse = (
  result: Extract<ProductWriteResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.errors || result.message.includes("already exists")
        ? result.message.includes("already exists")
          ? 409
          : 400
        : 500;
  return privateJson(
    {
      error: result.error ?? "INVALID_REQUEST",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

/** Admin product endpoints backed by Morph's shared product write service. */
export async function handleAdminProductsRequest(
  request: Request,
  dependencies: AdminProductsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  const productMatch = /^products\/([^/]+)$/.exec(path);
  const archiveMatch = /^products\/([^/]+)\/archive$/.exec(path);
  const variantsMatch = /^products\/([^/]+)\/variants$/.exec(path);
  const variantInventoryItemsBatchMatch =
    /^products\/([^/]+)\/variants\/inventory-items\/batch$/.exec(path);
  const variantInventoryItemsMatch =
    /^products\/([^/]+)\/variants\/([^/]+)\/inventory-items$/.exec(path);
  const variantInventoryItemMatch =
    /^products\/([^/]+)\/variants\/([^/]+)\/inventory-items\/([^/]+)$/.exec(
      path,
    );
  const variantMatch = /^products\/([^/]+)\/variants\/([^/]+)$/.exec(path);

  const loadProductResponse = async (id: string, status = 200) => {
    const product = await dependencies.findProduct(id);
    if (!product) return routeError("NOT_FOUND", "Product not found", 404);
    const variantResult = await dependencies.listVariants({
      productId: product.id,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: 200,
    });
    return privateJson(
      {
        product: productDetailToApi(
          product,
          variantResult.variants,
          variantResult.total,
        ),
      },
      status,
    );
  };

  const loadVariantResponse = async (
    productId: string,
    variantId: string,
    status = 200,
  ) => {
    const product = await dependencies.findProduct(productId);
    if (!product) return routeError("NOT_FOUND", "Product not found", 404);
    const variant = await dependencies.findVariant(variantId);
    if (!variant || variant.productId !== product.id) {
      return routeError("NOT_FOUND", "Product variant not found", 404);
    }
    return privateJson(
      { variant: variantToApi(variant, product.options) },
      status,
    );
  };

  if (variantInventoryItemsBatchMatch) {
    const productId = z
      .uuid()
      .safeParse(variantInventoryItemsBatchMatch[1] ?? "");
    if (!productId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use POST" }),
        {
          status: 405,
          headers: {
            allow: "POST",
            "cache-control": "private, no-store",
            "content-type": "application/json; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = variantInventoryItemsBatchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid inventory item association changes",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const product = await dependencies.findProduct(productId.data);
    if (!product) return routeError("NOT_FOUND", "Product not found", 404);

    const variantIds = [
      ...new Set([
        ...parsed.data.create.map((item) => item.variant_id),
        ...parsed.data.update.map((item) => item.variant_id),
        ...parsed.data.delete.map((item) => item.variant_id),
      ]),
    ];
    const variants = await Promise.all(
      variantIds.map((id) => dependencies.findVariant(id)),
    );
    if (
      variants.some((variant) => !variant || variant.productId !== product.id)
    ) {
      return routeError("NOT_FOUND", "Product variant not found", 404);
    }
    const variantById = new Map(
      variants.flatMap((variant) => (variant ? [[variant.id, variant]] : [])),
    );
    const desiredByVariant = new Map(
      variants.flatMap((variant) =>
        variant
          ? [
              [
                variant.id,
                new Map(
                  variant.inventoryKit.map((item) => [
                    item.inventoryItemId,
                    {
                      inventoryItemId: item.inventoryItemId,
                      requiredQuantity: item.requiredQuantity,
                    },
                  ]),
                ),
              ],
            ]
          : [],
      ),
    );
    for (const item of parsed.data.create) {
      const kit = desiredByVariant.get(item.variant_id);
      if (kit?.has(item.inventory_item_id)) {
        return routeError(
          "CONFLICT",
          "The variant already uses this inventory item",
          409,
        );
      }
      kit?.set(item.inventory_item_id, {
        inventoryItemId: item.inventory_item_id,
        requiredQuantity: item.required_quantity,
      });
    }
    for (const item of parsed.data.update) {
      const kit = desiredByVariant.get(item.variant_id);
      if (!kit?.has(item.inventory_item_id)) {
        return routeError(
          "NOT_FOUND",
          "Variant inventory item association not found",
          404,
        );
      }
      kit.set(item.inventory_item_id, {
        inventoryItemId: item.inventory_item_id,
        requiredQuantity: item.required_quantity,
      });
    }
    for (const item of parsed.data.delete) {
      const kit = desiredByVariant.get(item.variant_id);
      if (!kit?.delete(item.inventory_item_id)) {
        return routeError(
          "NOT_FOUND",
          "Variant inventory item association not found",
          404,
        );
      }
    }
    const replacements = variantIds.flatMap((variantId) => {
      const variant = variantById.get(variantId);
      const items = desiredByVariant.get(variantId);
      return variant && items
        ? [
            updateVariantInventoryKitInputSchema.parse({
              productId: product.id,
              variantId,
              expectedUpdatedAt: variant.updatedAt.toISOString(),
              items: [...items.values()],
            }),
          ]
        : [];
    });
    try {
      const result = await dependencies.updateInventoryKits(
        replacements,
        access.userId,
      );
      if (!result.success) return variantWriteFailureResponse(result);
      return privateJson({
        created: parsed.data.create.map((item) => ({
          variant_id: item.variant_id,
          inventory_item_id: item.inventory_item_id,
          required_quantity: item.required_quantity,
        })),
        updated: parsed.data.update.map((item) => ({
          variant_id: item.variant_id,
          inventory_item_id: item.inventory_item_id,
          required_quantity: item.required_quantity,
        })),
        deleted: parsed.data.delete.map((item) => ({
          variant_id: item.variant_id,
          inventory_item_id: item.inventory_item_id,
        })),
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Variant inventory items could not be updated",
        500,
      );
    }
  }

  if (variantInventoryItemsMatch || variantInventoryItemMatch) {
    const productId = z
      .uuid()
      .safeParse(
        variantInventoryItemsMatch?.[1] ?? variantInventoryItemMatch?.[1] ?? "",
      );
    const variantId = z
      .uuid()
      .safeParse(
        variantInventoryItemsMatch?.[2] ?? variantInventoryItemMatch?.[2] ?? "",
      );
    const inventoryItemId = variantInventoryItemMatch
      ? z.uuid().safeParse(variantInventoryItemMatch[3] ?? "")
      : null;
    if (
      !productId.success ||
      !variantId.success ||
      (inventoryItemId && !inventoryItemId.success)
    ) {
      return routeError(
        "INVALID_REQUEST",
        "Invalid product, variant, or inventory item ID",
        400,
      );
    }
    const product = await dependencies.findProduct(productId.data);
    if (!product) return routeError("NOT_FOUND", "Product not found", 404);
    const variant = await dependencies.findVariant(variantId.data);
    if (!variant || variant.productId !== product.id) {
      return routeError("NOT_FOUND", "Product variant not found", 404);
    }
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);

    let items = variant.inventoryKit.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      requiredQuantity: item.requiredQuantity,
    }));
    if (variantInventoryItemsMatch) {
      if (request.method !== "POST") {
        return routeError("METHOD_NOT_ALLOWED", "Use POST", 405);
      }
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const parsed = inventoryItemLinkBodySchema.safeParse(rawBody);
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid inventory item association",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      if (
        items.some(
          (item) => item.inventoryItemId === parsed.data.inventory_item_id,
        )
      ) {
        return routeError(
          "CONFLICT",
          "The variant already uses this inventory item",
          409,
        );
      }
      items = [
        ...items,
        {
          inventoryItemId: parsed.data.inventory_item_id,
          requiredQuantity: parsed.data.required_quantity,
        },
      ];
    } else {
      const linkedItem = items.find(
        (item) => item.inventoryItemId === inventoryItemId?.data,
      );
      if (!linkedItem) {
        return routeError(
          "NOT_FOUND",
          "Variant inventory item association not found",
          404,
        );
      }
      if (request.method === "DELETE") {
        items = items.filter(
          (item) => item.inventoryItemId !== inventoryItemId?.data,
        );
      } else if (request.method === "POST") {
        const rawBody = await readJson(request);
        if (rawBody === null)
          return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
        const parsed = inventoryItemLinkUpdateBodySchema.safeParse(rawBody);
        if (!parsed.success) {
          return privateJson(
            {
              error: "INVALID_REQUEST",
              message: "Invalid inventory item association",
              details: parsed.error.flatten().fieldErrors,
            },
            400,
          );
        }
        items = items.map((item) =>
          item.inventoryItemId === inventoryItemId?.data
            ? { ...item, requiredQuantity: parsed.data.required_quantity }
            : item,
        );
      } else {
        return routeError("METHOD_NOT_ALLOWED", "Use POST or DELETE", 405);
      }
    }

    try {
      const result = await dependencies.updateInventoryKits(
        [
          updateVariantInventoryKitInputSchema.parse({
            productId: product.id,
            variantId: variant.id,
            expectedUpdatedAt: variant.updatedAt.toISOString(),
            items,
          }),
        ],
        access.userId,
      );
      if (!result.success) return variantWriteFailureResponse(result);
      return await loadVariantResponse(product.id, variant.id);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Variant inventory item could not be updated",
        500,
      );
    }
  }

  if (variantsMatch) {
    const parsedId = z.uuid().safeParse(variantsMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    if (request.method === "GET") {
      const parsed = listVariantsQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid variant list query",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        const product = await dependencies.findProduct(parsedId.data);
        if (!product) return routeError("NOT_FOUND", "Product not found", 404);
        const result = await dependencies.listVariants({
          productId: product.id,
          ...parsed.data,
        });
        return privateJson({
          variants: result.variants.map((variant) =>
            variantToApi(variant, product.options),
          ),
          count: result.total,
          offset: parsed.data.offset,
          limit: parsed.data.limit,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Variants could not be loaded",
          500,
        );
      }
    }

    if (request.method === "POST") {
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const product = await dependencies.findProduct(parsedId.data);
      if (!product) return routeError("NOT_FOUND", "Product not found", 404);
      const normalized = normalizeVariantBody(rawBody, product);
      if (!normalized.success) {
        return variantInvalidRequest("Invalid variant fields", {
          unrecognized_keys: normalized.unknownKeys,
        });
      }
      const parsed = createVariantInputSchema(dependencies.maxAssets).safeParse(
        {
          ...normalized.data,
          productId: product.id,
        },
      );
      if (!parsed.success) {
        return variantInvalidRequest(
          "Invalid variant fields",
          parsed.error.flatten().fieldErrors,
        );
      }
      if (!access.userId || access.role !== "admin")
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      try {
        const result = await dependencies.createVariant(
          parsed.data,
          access.userId,
        );
        if (!result.success) return variantWriteFailureResponse(result);
        if (!result.data.id)
          return routeError(
            "INTERNAL_ERROR",
            "Created variant ID is missing",
            500,
          );
        return await loadVariantResponse(product.id, result.data.id, 201);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Variant could not be created",
          500,
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use GET, POST" }),
      {
        status: 405,
        headers: {
          allow: "GET, POST",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  if (variantMatch) {
    const parsedProductId = z.uuid().safeParse(variantMatch[1] ?? "");
    const parsedVariantId = z.uuid().safeParse(variantMatch[2] ?? "");
    if (!parsedProductId.success || !parsedVariantId.success)
      return routeError(
        "INVALID_REQUEST",
        "Invalid product or variant ID",
        400,
      );
    const product = await dependencies.findProduct(parsedProductId.data);
    if (!product) return routeError("NOT_FOUND", "Product not found", 404);
    const existing = await dependencies.findVariant(parsedVariantId.data);
    if (!existing || existing.productId !== product.id) {
      return routeError("NOT_FOUND", "Product variant not found", 404);
    }

    if (request.method === "GET") {
      return privateJson({ variant: variantToApi(existing, product.options) });
    }

    if (request.method === "PATCH" || request.method === "POST") {
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const normalized = normalizeVariantBody(rawBody, product);
      if (!normalized.success) {
        return variantInvalidRequest("Invalid variant fields", {
          unrecognized_keys: normalized.unknownKeys,
        });
      }
      const parsed = updateVariantInputSchema(dependencies.maxAssets).safeParse(
        {
          ...normalized.data,
          id: existing.id,
        },
      );
      if (!parsed.success) {
        return variantInvalidRequest(
          "Invalid variant fields",
          parsed.error.flatten().fieldErrors,
        );
      }
      if (!access.userId || access.role !== "admin")
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      try {
        const result = await dependencies.updateVariant(
          parsed.data,
          access.userId,
        );
        if (!result.success) return variantWriteFailureResponse(result);
        return await loadVariantResponse(product.id, existing.id);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Variant could not be updated",
          500,
        );
      }
    }

    if (request.method === "DELETE") {
      if (!access.userId || access.role !== "admin")
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      try {
        const result = await dependencies.deleteVariants(
          { ids: [existing.id] },
          access.userId,
        );
        if (!result.success) return variantWriteFailureResponse(result);
        return privateJson({
          id: existing.id,
          object: "product_variant",
          deleted: true,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Variant could not be deleted",
          500,
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "METHOD_NOT_ALLOWED",
        message: "Use GET, POST, PATCH, DELETE",
      }),
      {
        status: 405,
        headers: {
          allow: "GET, POST, PATCH, DELETE",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  if (request.method === "GET" && path === "products") {
    const parsed = listProductsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listProducts({
        ...parsed.data,
        page: Math.floor(parsed.data.offset / parsed.data.limit) + 1,
      });
      return privateJson({
        products: result.products.map(productListToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Products could not be loaded", 500);
    }
  }

  if (request.method === "GET" && productMatch) {
    const parsedId = z.uuid().safeParse(productMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    try {
      return await loadProductResponse(parsedId.data);
    } catch {
      return routeError("INTERNAL_ERROR", "Product could not be loaded", 500);
    }
  }

  if (request.method === "POST" && path === "products") {
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const normalized = normalizeProductBody(rawBody, createProductBodyKeys);
    if (!normalized.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product fields",
          details: normalized.unknownKeys.length
            ? { unrecognized_keys: normalized.unknownKeys }
            : {},
        },
        400,
      );
    }
    const parsed = createProductInputSchema(dependencies.maxAssets).safeParse(
      normalized.data,
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    try {
      const result = await dependencies.createProduct(
        parsed.data,
        access.userId,
      );
      if (!result.success) return writeFailureResponse(result);
      if (!result.data.id)
        return routeError(
          "INTERNAL_ERROR",
          "Created product ID is missing",
          500,
        );
      return await loadProductResponse(result.data.id, 201);
    } catch {
      return routeError("INTERNAL_ERROR", "Product could not be created", 500);
    }
  }

  if (request.method === "PATCH" && productMatch) {
    const parsedId = z.uuid().safeParse(productMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const normalized = normalizeProductBody(rawBody, updateProductBodyKeys);
    if (!normalized.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product fields",
          details: normalized.unknownKeys.length
            ? { unrecognized_keys: normalized.unknownKeys }
            : {},
        },
        400,
      );
    }
    const parsed = updateProductInputSchema(dependencies.maxAssets).safeParse({
      ...normalized.data,
      id: parsedId.data,
    });
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    try {
      const result = await dependencies.updateProduct(
        parsed.data,
        access.userId,
      );
      if (!result.success) return writeFailureResponse(result);
      return await loadProductResponse(parsedId.data);
    } catch {
      return routeError("INTERNAL_ERROR", "Product could not be updated", 500);
    }
  }

  if (request.method === "POST" && archiveMatch) {
    const parsedId = z.uuid().safeParse(archiveMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    try {
      const result = await dependencies.updateProduct(
        { id: parsedId.data, status: "archived" },
        access.userId,
      );
      if (!result.success) return writeFailureResponse(result);
      return await loadProductResponse(parsedId.data);
    } catch {
      return routeError("INTERNAL_ERROR", "Product could not be archived", 500);
    }
  }

  if (request.method === "DELETE" && productMatch) {
    const parsedId = z.uuid().safeParse(productMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid product ID", 400);
    if (!access.userId || access.role !== "admin")
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    try {
      const result = await dependencies.deleteProducts(
        { ids: [parsedId.data] },
        access.userId,
      );
      if (!result.success) return writeFailureResponse(result);
      return privateJson({
        id: parsedId.data,
        object: "product",
        deleted: true,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Product could not be deleted", 500);
    }
  }

  if (path === "products" || productMatch || archiveMatch) {
    const allow = archiveMatch
      ? "POST"
      : productMatch
        ? "GET, PATCH, DELETE"
        : "GET, POST";
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: `Use ${allow}` }),
      {
        status: 405,
        headers: {
          allow,
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
