import type {
  PriceListDTO,
  PriceListPriceDTO,
} from "@/lib/pricing/dto/price-list.dto";
import type { AdminApiAccess } from "./orders";
import type {
  CreatePriceListInput,
  PriceListPriceBatchResult,
  PriceListWriteResult,
  UpdatePriceListPatchInput,
} from "@/lib/pricing/service/price-list-write.service";
import {
  batchPriceListPricesInputSchema,
  createPriceListInputSchema,
  updatePriceListPatchInputSchema,
} from "@/lib/validations/price-list";
import type { BatchPriceListPricesInput } from "@/lib/validations/price-list";
import { z } from "zod";

export type AdminPriceListsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listPriceLists(input: {
    query?: string;
    status?: "draft" | "active";
    type?: "sale" | "override";
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }): Promise<{ priceLists: PriceListDTO[]; total: number }>;
  findPriceList(id: string): Promise<PriceListDTO | null>;
  listPriceListPrices(input: {
    priceListId: string;
    query?: string;
    sortBy: "product" | "amount" | "createdAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }): Promise<{ prices: PriceListPriceDTO[]; total: number }>;
  createPriceList(input: CreatePriceListInput): Promise<PriceListWriteResult>;
  updatePriceList(
    input: UpdatePriceListPatchInput,
  ): Promise<PriceListWriteResult>;
  archivePriceList(id: string): Promise<PriceListWriteResult>;
  batchPriceListPrices(
    priceListId: string,
    input: BatchPriceListPricesInput,
  ): Promise<PriceListPriceBatchResult>;
};

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(["draft", "active"]).optional(),
    type: z.enum(["sale", "override"]).optional(),
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
    type: input.type,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("title")
        ? ("title" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const listPricesQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "product",
        "-product",
        "amount",
        "-amount",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("product")
      ? ("product" as const)
      : input.order.includes("amount")
        ? ("amount" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

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

const priceListToApi = (priceList: PriceListDTO) => ({
  id: priceList.id,
  title: priceList.title,
  description: priceList.description,
  rules: {
    ...(priceList.customerGroupIds.length
      ? { customer_group_id: priceList.customerGroupIds }
      : {}),
    ...(priceList.regionIds.length
      ? { region_id: priceList.regionIds }
      : {}),
  },
  starts_at: priceList.startsAt,
  ends_at: priceList.endsAt,
  status: priceList.status,
  type: priceList.type,
  price_count: priceList.priceCount,
  metadata: priceList.metadata,
  created_at: priceList.createdAt,
  updated_at: priceList.updatedAt,
});

const priceToApi = (price: PriceListPriceDTO) => ({
  id: price.id,
  variant_id: price.variantId,
  product_id: price.productId,
  title: price.variantTitle,
  product_title: price.productTitle,
  sku: price.sku,
  currency_code: price.currencyCode,
  amount: price.amount,
  min_quantity: price.minQuantity,
  max_quantity: price.maxQuantity,
  created_at: price.createdAt,
});

const priceListBodyKeys = new Set([
  "title",
  "description",
  "status",
  "type",
  "starts_at",
  "ends_at",
  "rules",
  "customer_group_ids",
  "region_ids",
  "metadata",
]);

const normalizePriceListBody = (
  rawBody: unknown,
):
  | { success: true; data: Record<string, unknown> }
  | { success: false; message: string; details?: unknown } => {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { success: false, message: "Invalid price list body" };
  }
  const raw = rawBody as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !priceListBodyKeys.has(key),
  );
  if (unknownKeys.length) {
    return {
      success: false,
      message: "Invalid price list fields",
      details: { unrecognized_keys: unknownKeys },
    };
  }

  const data: Record<string, unknown> = { ...raw };
  for (const [apiKey, key] of [
    ["starts_at", "startsAt"],
    ["ends_at", "endsAt"],
    ["customer_group_ids", "customerGroupIds"],
    ["region_ids", "regionIds"],
  ] as const) {
    if (data[key] === undefined && raw[apiKey] !== undefined) {
      data[key] = raw[apiKey];
    }
    delete data[apiKey];
  }

  if (raw.rules !== undefined) {
    if (
      !raw.rules ||
      typeof raw.rules !== "object" ||
      Array.isArray(raw.rules)
    ) {
      return {
        success: false,
        message: "Price list rules must be an object",
        details: { rules: ["Expected an object"] },
      };
    }
    const rules = raw.rules as Record<string, unknown>;
    const unsupported = Object.keys(rules).filter(
      (key) => key !== "customer_group_id" && key !== "region_id",
    );
    if (unsupported.length) {
      return {
        success: false,
        message: "This store supports customer group and region price list rules",
        details: { rules: { unsupported } },
      };
    }
    if (
      rules.customer_group_id !== undefined &&
      raw.customer_group_ids !== undefined
    ) {
      return {
        success: false,
        message:
          "Send customer groups through rules or customer_group_ids, not both",
      };
    }
    if (rules.region_id !== undefined && raw.region_ids !== undefined) {
      return {
        success: false,
        message: "Send regions through rules or region_ids, not both",
      };
    }
    data.customerGroupIds = rules.customer_group_id ?? raw.customer_group_ids ?? [];
    data.regionIds = rules.region_id ?? raw.region_ids ?? [];
    delete data.rules;
  }
  return { success: true, data };
};

const normalizePriceBatchBody = (
  rawBody: unknown,
):
  | { success: true; data: unknown }
  | { success: false; message: string; details?: unknown } => {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { success: false, message: "Invalid price batch body" };
  }
  const raw = rawBody as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !["create", "update", "delete"].includes(key),
  );
  if (unknownKeys.length) {
    return {
      success: false,
      message: "Invalid price batch fields",
      details: { unrecognized_keys: unknownKeys },
    };
  }

  const normalizeRows = (key: "create" | "update") => {
    const rows = raw[key];
    if (rows === undefined) return rows;
    if (!Array.isArray(rows)) return rows;
    return rows.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return entry;
      const value = entry as Record<string, unknown>;
      const allowed = new Set([
        "id",
        "variant_id",
        "currency_code",
        "amount",
        "min_quantity",
        "max_quantity",
      ]);
      const extra = Object.keys(value).filter((field) => !allowed.has(field));
      if (extra.length) return value;
      return {
        ...(value.id === undefined ? {} : { id: value.id }),
        ...(value.variant_id === undefined
          ? {}
          : { variantId: value.variant_id }),
        ...(value.currency_code === undefined
          ? {}
          : { currencyCode: value.currency_code }),
        ...(value.amount === undefined ? {} : { amount: value.amount }),
        ...(value.min_quantity === undefined
          ? {}
          : { minQuantity: value.min_quantity }),
        ...(value.max_quantity === undefined
          ? {}
          : { maxQuantity: value.max_quantity }),
      };
    });
  };

  return {
    success: true,
    data: {
      ...(raw.create === undefined ? {} : { create: normalizeRows("create") }),
      ...(raw.update === undefined ? {} : { update: normalizeRows("update") }),
      ...(raw.delete === undefined ? {} : { delete: raw.delete }),
    },
  };
};

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const writeFailure = (
  result: Extract<PriceListWriteResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_PRICE"
        ? 409
        : result.errors || result.error === "INVALID_REQUEST"
          ? 400
          : result.error?.endsWith("_NOT_FOUND")
            ? 404
            : 500;
  return privateJson(
    {
      error: result.error ?? "INTERNAL_ERROR",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const authorizeAdmin = (
  access: AdminApiAccess,
): access is {
  allowed: true;
  userId: string;
  role: "admin";
} => Boolean(access.allowed && access.userId && access.role === "admin");

/** Medusa-shaped price list routes backed by Morph's shared price list flow. */
export async function handleAdminPriceListsRequest(
  request: Request,
  dependencies: AdminPriceListsApiDependencies,
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
  const itemMatch = /^price-lists\/([^/]+)$/.exec(path);
  const priceMatch = /^price-lists\/([^/]+)\/prices$/.exec(path);
  const batchPriceMatch = /^price-lists\/([^/]+)\/prices\/batch$/.exec(path);

  const loadPriceListResponse = async (id: string, status = 200) => {
    const priceList = await dependencies.findPriceList(id);
    if (!priceList) return routeError("NOT_FOUND", "Price list not found", 404);
    const pricePage = await dependencies.listPriceListPrices({
      priceListId: id,
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: 100,
    });
    return privateJson(
      {
        price_list: {
          ...priceListToApi(priceList),
          prices: pricePage.prices.map(priceToApi),
          prices_count: pricePage.total,
        },
      },
      status,
    );
  };

  if (path === "price-lists" && request.method === "GET") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid price list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listPriceLists(parsed.data);
      return privateJson({
        price_lists: result.priceLists.map(priceListToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Price lists could not be loaded",
        500,
      );
    }
  }

  if (priceMatch && request.method === "GET") {
    const parsedId = z.uuid().safeParse(priceMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid price list ID", 400);
    const parsed = listPricesQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid price list prices query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const priceList = await dependencies.findPriceList(parsedId.data);
      if (!priceList)
        return routeError("NOT_FOUND", "Price list not found", 404);
      const result = await dependencies.listPriceListPrices({
        priceListId: parsedId.data,
        ...parsed.data,
      });
      return privateJson({
        prices: result.prices.map(priceToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Price list prices could not be loaded",
        500,
      );
    }
  }

  if (batchPriceMatch && request.method === "POST") {
    const parsedId = z.uuid().safeParse(batchPriceMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid price list ID", 400);
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const normalized = normalizePriceBatchBody(rawBody);
    if (!normalized.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: normalized.message,
          ...(normalized.details ? { details: normalized.details } : {}),
        },
        400,
      );
    const parsed = batchPriceListPricesInputSchema.safeParse(normalized.data);
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid price batch fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const result = await dependencies.batchPriceListPrices(
      parsedId.data,
      parsed.data,
    );
    if (!result.success) return writeFailure(result);
    return privateJson({
      created: result.data.created.map(priceToApi),
      updated: result.data.updated.map(priceToApi),
      deleted: result.data.deleted,
    });
  }

  if (path === "price-lists" && request.method === "POST") {
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const normalized = normalizePriceListBody(rawBody);
    if (!normalized.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: normalized.message,
          ...(normalized.details ? { details: normalized.details } : {}),
        },
        400,
      );
    const parsed = createPriceListInputSchema.safeParse(normalized.data);
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid price list fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const result = await dependencies.createPriceList(parsed.data);
    if (!result.success) return writeFailure(result);
    if (!result.data.id)
      return routeError(
        "INTERNAL_ERROR",
        "Created price list ID is missing",
        500,
      );
    return loadPriceListResponse(result.data.id, 201);
  }

  if (itemMatch) {
    const parsedId = z.uuid().safeParse(itemMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid price list ID", 400);
    if (request.method === "GET") {
      try {
        return await loadPriceListResponse(parsedId.data);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Price list could not be loaded",
          500,
        );
      }
    }

    if (request.method === "POST") {
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const normalized = normalizePriceListBody(rawBody);
      if (!normalized.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: normalized.message,
            ...(normalized.details ? { details: normalized.details } : {}),
          },
          400,
        );
      const parsed = updatePriceListPatchInputSchema.safeParse({
        ...normalized.data,
        id: parsedId.data,
      });
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid price list fields",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      if (!authorizeAdmin(access))
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      const result = await dependencies.updatePriceList(parsed.data);
      if (!result.success) return writeFailure(result);
      return loadPriceListResponse(parsedId.data);
    }

    if (request.method === "DELETE") {
      if (!authorizeAdmin(access))
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      const result = await dependencies.archivePriceList(parsedId.data);
      if (!result.success) return writeFailure(result);
      return privateJson({
        id: parsedId.data,
        object: "price_list",
        deleted: true,
      });
    }
  }

  if (path === "price-lists" || itemMatch || priceMatch || batchPriceMatch) {
    const allow = batchPriceMatch
      ? "POST"
      : priceMatch
        ? "GET"
        : itemMatch
          ? "GET, POST, DELETE"
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
