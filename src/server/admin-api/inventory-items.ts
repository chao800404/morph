import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";
import type {
  CreateInventoryItemInput,
  InventoryCreateResult,
  InventoryItemFields,
  InventoryLevelsWriteResult,
  InventoryLocationLevelsBatchInput,
  InventoryLocationLevelsBatchResult,
  InventoryLocationLevelInput,
  InventoryUpdateResult,
} from "@/lib/inventory/service/inventory-write.service";
import type { AdminApiAccess } from "./orders";
import { metadataInputSchema } from "@/lib/validations/product";
import { z } from "zod";

export type AdminInventoryItemsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listItems(input: {
    query?: string;
    ids?: string[];
    skus?: string[];
    originCountries?: string[];
    midCodes?: string[];
    hsCodes?: string[];
    materials?: string[];
    requiresShipping?: boolean;
    locationIds?: string[];
    withDeleted?: boolean;
    sortBy:
      | "name"
      | "createdAt"
      | "updatedAt"
      | "sku"
      | "originCountry"
      | "midCode"
      | "hsCode"
      | "material";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ items: InventoryListItemDTO[]; total: number }>;
  findItem(
    id: string,
    options?: { withDeletedLocationLevels?: boolean },
  ): Promise<InventoryListItemDTO | null>;
  createItem(input: CreateInventoryItemInput): Promise<InventoryCreateResult>;
  updateItem(
    id: string,
    input: InventoryItemFields,
  ): Promise<InventoryUpdateResult>;
  setLocationLevels(
    id: string,
    levels: InventoryLocationLevelInput[],
  ): Promise<InventoryLevelsWriteResult>;
  removeLocationLevels(
    id: string,
    locationIds: string[],
  ): Promise<InventoryLevelsWriteResult>;
  createLocationLevel(input: {
    inventoryItemId: string;
    locationId: string;
    stockedQuantity: number;
    incomingQuantity: number;
  }): Promise<InventoryLevelsWriteResult>;
  updateLocationLevel(
    inventoryItemId: string,
    locationId: string,
    input: { stockedQuantity?: number; incomingQuantity?: number },
  ): Promise<InventoryLevelsWriteResult>;
  batchLocationLevels(
    input: InventoryLocationLevelsBatchInput,
  ): Promise<InventoryLocationLevelsBatchResult>;
  archiveItem(id: string): Promise<"archived" | "not-found" | "in-use">;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const inventoryItemFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    sku: optionalText(100).optional(),
    unit_of_measure: optionalText(100).optional(),
    description: optionalText(5000).optional(),
    thumbnail: optionalText(2000).optional(),
    requires_shipping: z.boolean().optional(),
    weight: z.number().finite().min(0).max(1_000_000).nullish(),
    length: z.number().finite().min(0).max(1_000_000).nullish(),
    height: z.number().finite().min(0).max(1_000_000).nullish(),
    width: z.number().finite().min(0).max(1_000_000).nullish(),
    origin_country: z
      .string()
      .trim()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
    hs_code: optionalText(100).optional(),
    mid_code: optionalText(100).optional(),
    material: optionalText(200).optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

const createItemBodySchema = inventoryItemFieldsSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    requires_shipping: z.boolean().default(true),
    weight: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    length: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    height: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    width: z.number().finite().min(0).max(1_000_000).nullable().default(null),
    location_levels: z
      .array(
        z
          .object({
            location_id: z.uuid(),
            stocked_quantity: z.number().finite().min(0).max(1_000_000_000),
            incoming_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = input.location_levels.map((level) => level.location_id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["location_levels"],
        message: "A location can only appear once",
      });
    }
  });

const updateItemBodySchema = inventoryItemFieldsSchema
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "Provide at least one inventory item field to update",
  )
  .strict();

const setLocationLevelsBodySchema = z
  .object({
    location_levels: z
      .array(
        z
          .object({
            location_id: z.uuid(),
            stocked_quantity: z.number().finite().min(0).max(1_000_000_000),
            incoming_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = input.location_levels.map((level) => level.location_id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["location_levels"],
        message: "A location can only appear once",
      });
    }
  });

const removeLocationLevelsBodySchema = z
  .object({ location_ids: z.array(z.uuid()).min(1).max(100) })
  .strict()
  .refine(
    ({ location_ids }) => new Set(location_ids).size === location_ids.length,
    "A location can only appear once",
  );

const createLocationLevelBodySchema = z
  .object({
    location_id: z.uuid(),
    stocked_quantity: z.number().finite().min(0).max(1_000_000_000).default(0),
    incoming_quantity: z.number().finite().min(0).max(1_000_000_000).default(0),
  })
  .strict();

const updateLocationLevelBodySchema = z
  .object({
    stocked_quantity: z.number().finite().min(0).max(1_000_000_000).optional(),
    incoming_quantity: z.number().finite().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "Provide at least one inventory level field to update",
  );

const batchLocationLevelUpdateSchema = z
  .object({
    id: z.uuid(),
    location_id: z.uuid().optional(),
    stocked_quantity: z.number().finite().min(0).max(1_000_000_000).optional(),
    incoming_quantity: z.number().finite().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.stocked_quantity !== undefined ||
      input.incoming_quantity !== undefined,
    "Provide at least one inventory level quantity to update",
  );

const batchScopedLocationLevelsBodySchema = z
  .object({
    create: z
      .array(
        z
          .object({
            location_id: z.uuid(),
            stocked_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .default(0),
            incoming_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .default(0),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    update: z.array(batchLocationLevelUpdateSchema).max(100).default([]),
    delete: z.array(z.uuid()).max(100).default([]),
    force: z.boolean().default(false),
  })
  .strict();

const batchGlobalLocationLevelsBodySchema = z
  .object({
    create: z
      .array(
        z
          .object({
            inventory_item_id: z.uuid(),
            location_id: z.uuid(),
            stocked_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .default(0),
            incoming_quantity: z
              .number()
              .finite()
              .min(0)
              .max(1_000_000_000)
              .default(0),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    update: z
      .array(
        batchLocationLevelUpdateSchema
          .safeExtend({
            inventory_item_id: z.uuid().optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    delete: z.array(z.uuid()).max(100).default([]),
    force: z.boolean().default(false),
  })
  .strict();

const stringFilterSchema = z.union([
  z.string().trim().min(1).max(200),
  z.array(z.string().trim().min(1).max(200)).min(1).max(100),
]);

const idFilterSchema = z.union([z.uuid(), z.array(z.uuid()).min(1).max(100)]);

const repeatedQueryParams = (searchParams: URLSearchParams) => {
  const result: Record<string, string | string[]> = {};
  for (const [rawKey, value] of searchParams.entries()) {
    const withoutArraySuffix = rawKey.endsWith("[]")
      ? rawKey.slice(0, -2)
      : rawKey;
    const key = withoutArraySuffix.replace(
      "location_levels[location_id]",
      "location_levels.location_id",
    );
    const previous = result[key];
    if (previous === undefined) result[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else result[key] = [previous, value];
  }
  return result;
};

const asArray = <T>(value: T | T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const listLocationLevelsQuerySchema = z
  .object({
    location_id: idFilterSchema.optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "updated_at", "-updated_at"])
      .default("created_at"),
    with_deleted: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict()
  .transform((input) => ({
    locationIds: asArray(input.location_id),
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
    withDeleted: input.with_deleted === true,
  }));

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    id: idFilterSchema.optional(),
    sku: stringFilterSchema.optional(),
    origin_country: stringFilterSchema.optional(),
    mid_code: stringFilterSchema.optional(),
    hs_code: stringFilterSchema.optional(),
    material: stringFilterSchema.optional(),
    requires_shipping: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    with_deleted: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    "location_levels.location_id": idFilterSchema.optional(),
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
        "sku",
        "-sku",
        "origin_country",
        "-origin_country",
        "mid_code",
        "-mid_code",
        "hs_code",
        "-hs_code",
        "material",
        "-material",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => {
    const orderField = input.order.replace(/^-/, "");
    const sortBy =
      orderField === "updated_at"
        ? ("updatedAt" as const)
        : orderField === "title"
          ? ("name" as const)
          : orderField === "sku"
            ? ("sku" as const)
            : orderField === "origin_country"
              ? ("originCountry" as const)
              : orderField === "mid_code"
                ? ("midCode" as const)
                : orderField === "hs_code"
                  ? ("hsCode" as const)
                  : orderField === "material"
                    ? ("material" as const)
                    : ("createdAt" as const);
    return {
      query: input.q || undefined,
      ...(asArray(input.id) ? { ids: asArray(input.id) } : {}),
      ...(asArray(input.sku) ? { skus: asArray(input.sku) } : {}),
      ...(asArray(input.origin_country)
        ? { originCountries: asArray(input.origin_country) }
        : {}),
      ...(asArray(input.mid_code) ? { midCodes: asArray(input.mid_code) } : {}),
      ...(asArray(input.hs_code) ? { hsCodes: asArray(input.hs_code) } : {}),
      ...(asArray(input.material)
        ? { materials: asArray(input.material) }
        : {}),
      ...(input.requires_shipping !== undefined
        ? { requiresShipping: input.requires_shipping }
        : {}),
      ...(input.with_deleted ? { withDeleted: true } : {}),
      ...(asArray(input["location_levels.location_id"])
        ? { locationIds: asArray(input["location_levels.location_id"]) }
        : {}),
      offset: input.offset,
      limit: input.limit,
      page: Math.floor(input.offset / input.limit) + 1,
      sortBy,
      sortOrder: input.order.startsWith("-")
        ? ("desc" as const)
        : ("asc" as const),
    };
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

const levelToApi = (
  inventoryItemId: string,
  level: InventoryListItemDTO["locationLevels"][number],
) => ({
  id: level.id,
  inventory_item_id: inventoryItemId,
  location_id: level.locationId,
  location: level.locationName
    ? { id: level.locationId, name: level.locationName }
    : null,
  stocked_quantity: level.stockedQuantity,
  reserved_quantity: level.reservedQuantity,
  incoming_quantity: level.incomingQuantity,
  available_quantity: level.availableQuantity,
  metadata: level.metadata,
  created_at: level.createdAt,
  updated_at: level.updatedAt,
  ...(level.deletedAt !== undefined
    ? { deleted_at: level.deletedAt?.toISOString() ?? null }
    : {}),
});

const itemToApi = (item: InventoryListItemDTO) => ({
  id: item.id,
  sku: item.sku,
  title: item.title,
  description: item.description,
  thumbnail: item.thumbnail,
  unit_of_measure: item.unitOfMeasure,
  requires_shipping: item.requiresShipping,
  weight: item.weight,
  length: item.length,
  height: item.height,
  width: item.width,
  origin_country: item.originCountry,
  hs_code: item.hsCode,
  mid_code: item.midCode,
  material: item.material,
  ...(item.deletedAt !== undefined
    ? { deleted_at: item.deletedAt?.toISOString() ?? null }
    : {}),
  metadata: item.metadata,
  location_levels: item.locationLevels.map((level) =>
    levelToApi(item.id, level),
  ),
  stocked_quantity: item.stockedQuantity,
  reserved_quantity: item.reservedQuantity,
  incoming_quantity: item.incomingQuantity,
  available_quantity: item.availableQuantity,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
});

const fieldsFromApi = (input: z.infer<typeof inventoryItemFieldsSchema>) => ({
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.sku !== undefined ? { sku: input.sku } : {}),
  ...(input.description !== undefined
    ? { description: input.description }
    : {}),
  ...(input.thumbnail !== undefined ? { thumbnail: input.thumbnail } : {}),
  ...(input.unit_of_measure !== undefined
    ? { unitOfMeasure: input.unit_of_measure }
    : {}),
  ...(input.requires_shipping !== undefined
    ? { requiresShipping: input.requires_shipping }
    : {}),
  ...(input.weight !== undefined ? { weight: input.weight } : {}),
  ...(input.length !== undefined ? { length: input.length } : {}),
  ...(input.height !== undefined ? { height: input.height } : {}),
  ...(input.width !== undefined ? { width: input.width } : {}),
  ...(input.origin_country !== undefined
    ? { originCountry: input.origin_country }
    : {}),
  ...(input.hs_code !== undefined ? { hsCode: input.hs_code } : {}),
  ...(input.mid_code !== undefined ? { midCode: input.mid_code } : {}),
  ...(input.material !== undefined ? { material: input.material } : {}),
  ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
});

const parseJsonBody = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const validationError = (error: z.ZodError) =>
  privateJson(
    {
      error: "INVALID_REQUEST",
      message: "Invalid inventory item request",
      details: error.flatten().fieldErrors,
    },
    400,
  );

const writeError = (reason: string) => {
  const known: Record<string, { message: string; status: number }> = {
    NOT_FOUND: { message: "Inventory item not found", status: 404 },
    SKU_CONFLICT: {
      message: "An inventory item with this SKU already exists",
      status: 409,
    },
    INVALID_LOCATION: {
      message: "One or more stock locations are unavailable",
      status: 400,
    },
    RESERVED_QUANTITY: {
      message: "Stocked quantity cannot be lower than reserved quantity",
      status: 409,
    },
    CONFLICT: {
      message: "Inventory changed or this location level already exists",
      status: 409,
    },
    IN_USE: {
      message:
        "Inventory linked to variants, reservations, or stock cannot be deleted",
      status: 409,
    },
  };
  const result = known[reason] ?? {
    message: "Inventory operation failed",
    status: 500,
  };
  return routeError(reason, result.message, result.status);
};

/** Admin API routes for inventory items, shaped after Medusa's API contract. */
export async function handleAdminInventoryItemsRequest(
  request: Request,
  dependencies: AdminInventoryItemsApiDependencies,
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

  const requireAdmin = () =>
    access.userId && access.role === "admin"
      ? null
      : routeError("FORBIDDEN", "Administrator access is required", 403);

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");

  const applyLocationLevelsBatch = async (
    input: InventoryLocationLevelsBatchInput,
  ) => {
    try {
      const result = await dependencies.batchLocationLevels(input);
      return result.success ? privateJson({}) : writeError(result.reason);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory levels could not be updated",
        500,
      );
    }
  };

  if (path === "inventory-items/location-levels/batch") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    const parsed = batchGlobalLocationLevelsBodySchema.safeParse(
      await parseJsonBody(request),
    );
    if (!parsed.success) return validationError(parsed.error);
    return applyLocationLevelsBatch({
      creates: parsed.data.create.map((level) => ({
        inventoryItemId: level.inventory_item_id,
        locationId: level.location_id,
        stockedQuantity: level.stocked_quantity,
        incomingQuantity: level.incoming_quantity,
      })),
      updates: parsed.data.update.map((level) => ({
        id: level.id,
        ...(level.inventory_item_id
          ? { inventoryItemId: level.inventory_item_id }
          : {}),
        ...(level.location_id ? { locationId: level.location_id } : {}),
        ...(level.stocked_quantity !== undefined
          ? { stockedQuantity: level.stocked_quantity }
          : {}),
        ...(level.incoming_quantity !== undefined
          ? { incomingQuantity: level.incoming_quantity }
          : {}),
      })),
      deleteIds: parsed.data.delete,
      force: parsed.data.force,
    });
  }

  if (path === "inventory-items") {
    if (request.method === "POST") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      const parsed = createItemBodySchema.safeParse(
        await parseJsonBody(request),
      );
      if (!parsed.success) return validationError(parsed.error);
      const body = parsed.data;
      try {
        const created = await dependencies.createItem({
          title: body.title,
          sku: body.sku ?? null,
          description: body.description ?? null,
          thumbnail: body.thumbnail ?? null,
          unitOfMeasure: body.unit_of_measure ?? null,
          requiresShipping: body.requires_shipping,
          weight: body.weight,
          length: body.length,
          height: body.height,
          width: body.width,
          originCountry: body.origin_country ?? null,
          hsCode: body.hs_code ?? null,
          midCode: body.mid_code ?? null,
          material: body.material ?? null,
          metadata: body.metadata ?? {},
          locationLevels: body.location_levels.map((level) => ({
            locationId: level.location_id,
            stockedQuantity: level.stocked_quantity,
            incomingQuantity: level.incoming_quantity ?? 0,
          })),
        });
        if (!created.success) return writeError(created.reason);
        const item = await dependencies.findItem(created.id);
        return item
          ? privateJson({ inventory_item: itemToApi(item) }, 201)
          : routeError(
              "INTERNAL_ERROR",
              "Created inventory item could not be loaded",
              500,
            );
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory item could not be created",
          500,
        );
      }
    }
    if (request.method !== "GET") {
      return methodNotAllowed("GET, POST");
    }
    const query = listQuerySchema.safeParse(
      repeatedQueryParams(new URL(request.url).searchParams),
    );
    if (!query.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid inventory item query",
          details: query.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.listItems(query.data);
      return privateJson({
        inventory_items: result.items.map(itemToApi),
        count: result.total,
        offset: query.data.offset,
        limit: query.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory items could not be loaded",
        500,
      );
    }
  }

  const itemMatch = /^inventory-items\/([^/]+)$/.exec(path);
  const levelsMatch = /^inventory-items\/([^/]+)\/location-levels$/.exec(path);
  const scopedLevelsBatchMatch =
    /^inventory-items\/([^/]+)\/location-levels\/batch$/.exec(path);
  const locationLevelMatch =
    /^inventory-items\/([^/]+)\/location-levels\/([^/]+)$/.exec(path);
  if (
    !itemMatch &&
    !levelsMatch &&
    !scopedLevelsBatchMatch &&
    !locationLevelMatch
  )
    return routeError("NOT_FOUND", "Admin API route not found", 404);
  const id = z
    .uuid()
    .safeParse(
      itemMatch?.[1] ??
        levelsMatch?.[1] ??
        scopedLevelsBatchMatch?.[1] ??
        locationLevelMatch?.[1] ??
        "",
    );
  if (!id.success)
    return routeError("INVALID_REQUEST", "Invalid inventory item ID", 400);

  if (scopedLevelsBatchMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    const parsed = batchScopedLocationLevelsBodySchema.safeParse(
      await parseJsonBody(request),
    );
    if (!parsed.success) return validationError(parsed.error);
    return applyLocationLevelsBatch({
      inventoryItemId: id.data,
      creates: parsed.data.create.map((level) => ({
        locationId: level.location_id,
        stockedQuantity: level.stocked_quantity,
        incomingQuantity: level.incoming_quantity,
      })),
      updates: parsed.data.update.map((level) => ({
        id: level.id,
        ...(level.location_id ? { locationId: level.location_id } : {}),
        ...(level.stocked_quantity !== undefined
          ? { stockedQuantity: level.stocked_quantity }
          : {}),
        ...(level.incoming_quantity !== undefined
          ? { incomingQuantity: level.incoming_quantity }
          : {}),
      })),
      deleteIds: parsed.data.delete,
      force: parsed.data.force,
    });
  }

  if (locationLevelMatch) {
    const locationId = z.uuid().safeParse(locationLevelMatch[2]);
    if (!locationId.success) {
      return routeError("INVALID_REQUEST", "Invalid stock location ID", 400);
    }
    if (request.method === "POST") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      const parsed = updateLocationLevelBodySchema.safeParse(
        await parseJsonBody(request),
      );
      if (!parsed.success) return validationError(parsed.error);
      try {
        const updated = await dependencies.updateLocationLevel(
          id.data,
          locationId.data,
          {
            ...(parsed.data.stocked_quantity !== undefined
              ? { stockedQuantity: parsed.data.stocked_quantity }
              : {}),
            ...(parsed.data.incoming_quantity !== undefined
              ? { incomingQuantity: parsed.data.incoming_quantity }
              : {}),
          },
        );
        if (!updated.success) return writeError(updated.reason);
        const item = await dependencies.findItem(id.data);
        return item
          ? privateJson({ inventory_item: itemToApi(item) })
          : writeError("NOT_FOUND");
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory level could not be updated",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      try {
        const itemBeforeDelete = await dependencies.findItem(id.data);
        if (!itemBeforeDelete) return writeError("NOT_FOUND");
        const level = itemBeforeDelete.locationLevels.find(
          (candidate) => candidate.locationId === locationId.data,
        );
        if (!level) return writeError("NOT_FOUND");
        const removed = await dependencies.removeLocationLevels(id.data, [
          locationId.data,
        ]);
        if (!removed.success) return writeError(removed.reason);
        const parent = await dependencies.findItem(id.data);
        return privateJson({
          id: level.id,
          object: "inventory_level",
          deleted: true,
          ...(parent ? { parent: itemToApi(parent) } : {}),
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory level could not be removed",
          500,
        );
      }
    }
    return methodNotAllowed("POST, DELETE");
  }

  if (levelsMatch) {
    if (request.method === "GET") {
      const query = listLocationLevelsQuerySchema.safeParse(
        repeatedQueryParams(new URL(request.url).searchParams),
      );
      if (!query.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid inventory location-level query",
            details: query.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        const item = query.data.withDeleted
          ? await dependencies.findItem(id.data, {
              withDeletedLocationLevels: true,
            })
          : await dependencies.findItem(id.data);
        if (!item) return writeError("NOT_FOUND");
        const levels = item.locationLevels
          .filter(
            (level) =>
              !query.data.locationIds ||
              query.data.locationIds.includes(level.locationId),
          )
          .sort((left, right) => {
            const leftTime = left[query.data.sortBy].getTime();
            const rightTime = right[query.data.sortBy].getTime();
            const timeOrder =
              query.data.sortOrder === "asc"
                ? leftTime - rightTime
                : rightTime - leftTime;
            return timeOrder || left.id.localeCompare(right.id);
          });
        return privateJson({
          inventory_levels: levels
            .slice(query.data.offset, query.data.offset + query.data.limit)
            .map((level) => levelToApi(item.id, level)),
          count: levels.length,
          offset: query.data.offset,
          limit: query.data.limit,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory levels could not be loaded",
          500,
        );
      }
    }
    if (request.method === "POST") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      const body = await parseJsonBody(request);
      if (
        body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        "location_id" in body
      ) {
        const parsed = createLocationLevelBodySchema.safeParse(body);
        if (!parsed.success) return validationError(parsed.error);
        try {
          const created = await dependencies.createLocationLevel({
            inventoryItemId: id.data,
            locationId: parsed.data.location_id,
            stockedQuantity: parsed.data.stocked_quantity,
            incomingQuantity: parsed.data.incoming_quantity,
          });
          if (!created.success) return writeError(created.reason);
          const item = await dependencies.findItem(id.data);
          return item
            ? privateJson({ inventory_item: itemToApi(item) })
            : writeError("NOT_FOUND");
        } catch {
          return routeError(
            "INTERNAL_ERROR",
            "Inventory level could not be created",
            500,
          );
        }
      }
      const parsed = setLocationLevelsBodySchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      try {
        const updated = await dependencies.setLocationLevels(
          id.data,
          parsed.data.location_levels.map((level) => ({
            locationId: level.location_id,
            stockedQuantity: level.stocked_quantity,
            ...(level.incoming_quantity !== undefined
              ? { incomingQuantity: level.incoming_quantity }
              : {}),
          })),
        );
        if (!updated.success) return writeError(updated.reason);
        const item = await dependencies.findItem(id.data);
        return item
          ? privateJson({ inventory_item: itemToApi(item) })
          : writeError("NOT_FOUND");
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory levels could not be updated",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      const forbidden = requireAdmin();
      if (forbidden) return forbidden;
      const parsed = removeLocationLevelsBodySchema.safeParse(
        await parseJsonBody(request),
      );
      if (!parsed.success) return validationError(parsed.error);
      try {
        const removed = await dependencies.removeLocationLevels(
          id.data,
          parsed.data.location_ids,
        );
        if (!removed.success) return writeError(removed.reason);
        const item = await dependencies.findItem(id.data);
        return item
          ? privateJson({ inventory_item: itemToApi(item) })
          : writeError("NOT_FOUND");
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Inventory levels could not be removed",
          500,
        );
      }
    }
    return methodNotAllowed("GET, POST, DELETE");
  }

  if (request.method === "DELETE") {
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    try {
      const archived = await dependencies.archiveItem(id.data);
      if (archived !== "archived") {
        return writeError(archived === "in-use" ? "IN_USE" : "NOT_FOUND");
      }
      return privateJson({
        id: id.data,
        object: "inventory_item",
        deleted: true,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory item could not be deleted",
        500,
      );
    }
  }
  if (request.method === "POST") {
    const forbidden = requireAdmin();
    if (forbidden) return forbidden;
    const parsed = updateItemBodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) return validationError(parsed.error);
    try {
      const updated = await dependencies.updateItem(
        id.data,
        fieldsFromApi(parsed.data),
      );
      if (!updated.success) return writeError(updated.reason);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory item could not be updated",
        500,
      );
    }
  } else if (request.method !== "GET") {
    return methodNotAllowed("GET, POST, DELETE");
  }
  try {
    const item = await dependencies.findItem(id.data);
    return item
      ? privateJson({ inventory_item: itemToApi(item) })
      : routeError("NOT_FOUND", "Inventory item not found", 404);
  } catch {
    return routeError(
      "INTERNAL_ERROR",
      "Inventory item could not be loaded",
      500,
    );
  }
}

const methodNotAllowed = (allow: string) =>
  new Response(
    JSON.stringify({
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed",
    }),
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
