import type {
  StoreAdminDTO,
  StoreAdminUpdateInput,
} from "@/lib/currency/dto/currency.dto";
import { StoreSettingsError } from "@/lib/currency/store-settings-error";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminStoresApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listStores(input: { offset: number; limit: number }): Promise<{
    stores: StoreAdminDTO[];
    count: number;
  }>;
  findStore(id: string): Promise<StoreAdminDTO | null>;
  updateStore(id: string, input: StoreAdminUpdateInput): Promise<StoreAdminDTO>;
};

const querySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const metadataSchema = z.object({}).catchall(z.json()).nullable().optional();
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    supported_currencies: z
      .array(
        z
          .object({
            currency_code: z.string().trim().toLowerCase().length(3),
            is_default: z.boolean(),
            is_tax_inclusive: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .optional(),
    default_sales_channel_id: z.uuid().optional(),
    default_region_id: z.uuid().nullable().optional(),
    default_location_id: z.uuid().nullable().optional(),
    metadata: metadataSchema,
    supported_locales: z
      .array(
        z
          .object({
            locale_code: z.string().trim().min(2).max(35),
            is_default: z.boolean(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const error = (code: string, message: string, status: number) =>
  json({ error: code, message }, status);

const isAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const apiStore = (store: StoreAdminDTO) => ({
  id: store.id,
  name: store.name,
  supported_currencies: store.supportedCurrencies.map((entry) => ({
    id: entry.id,
    currency_code: entry.currencyCode,
    store_id: entry.storeId,
    is_default: entry.isDefault,
    is_tax_inclusive: entry.isTaxInclusive,
    currency: {
      code: entry.currency.code,
      symbol: entry.currency.symbol,
      symbol_native: entry.currency.symbolNative,
      name: entry.currency.name,
      decimal_digits: entry.currency.decimalDigits,
      rounding: entry.currency.rounding,
    },
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  })),
  default_sales_channel_id: store.defaultSalesChannelId,
  default_region_id: store.defaultRegionId,
  default_location_id: store.defaultLocationId,
  metadata: store.metadata,
  created_at: store.createdAt,
  updated_at: store.updatedAt,
  supported_locales: store.supportedLocales.map((entry) => ({
    id: entry.id,
    locale_code: entry.localeCode,
    store_id: entry.storeId,
    is_default: entry.isDefault,
    locale: entry.locale,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  })),
});

const mapUpdate = (
  input: z.infer<typeof bodySchema>,
): StoreAdminUpdateInput => ({
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.default_sales_channel_id !== undefined
    ? { defaultSalesChannelId: input.default_sales_channel_id }
    : {}),
  ...(input.default_region_id !== undefined
    ? { defaultRegionId: input.default_region_id }
    : {}),
  ...(input.default_location_id !== undefined
    ? { defaultLocationId: input.default_location_id }
    : {}),
  ...(input.metadata !== undefined
    ? { metadata: input.metadata as StoreAdminUpdateInput["metadata"] }
    : {}),
  ...(input.supported_currencies !== undefined
    ? {
        supportedCurrencies: input.supported_currencies.map((currency) => ({
          currencyCode: currency.currency_code,
          isDefault: currency.is_default,
          ...(currency.is_tax_inclusive !== undefined
            ? { isTaxInclusive: currency.is_tax_inclusive }
            : {}),
        })),
      }
    : {}),
  ...(input.supported_locales !== undefined
    ? {
        supportedLocales: input.supported_locales.map((locale) => ({
          localeCode: locale.locale_code,
          isDefault: locale.is_default,
        })),
      }
    : {}),
});

const storeFailure = (cause: unknown) => {
  if (cause instanceof StoreSettingsError) {
    const status =
      cause.code === "NOT_FOUND"
        ? 404
        : cause.code === "CURRENCY_IN_USE"
          ? 409
          : 400;
    return error(cause.code, cause.message, status);
  }
  return error("INTERNAL_ERROR", "Store could not be updated", 500);
};

/** Medusa-shaped Admin API for the installation's single store settings. */
export async function handleAdminStoresRequest(
  request: Request,
  path: string,
  dependencies: AdminStoresApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    return error("UNAUTHORIZED", "A signed-in commerce user is required", 401);
  }
  if (!access.allowed)
    return error(access.error, access.message, access.status);
  if (!isAdmin(access))
    return error("FORBIDDEN", "Administrator access is required", 403);

  if (path !== "stores" && !path.startsWith("stores/"))
    return error("NOT_FOUND", "Admin API route not found", 404);
  const id = path === "stores" ? null : path.slice("stores/".length);
  if (id !== null && (!id || id.includes("/")))
    return error("NOT_FOUND", "Admin API route not found", 404);

  if (id === null && request.method === "GET") {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return json(
        {
          error: "INVALID_REQUEST",
          message: "Invalid store query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.listStores(parsed.data);
      return json({
        stores: result.stores.map(apiStore),
        count: result.count,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error("INTERNAL_ERROR", "Stores could not be loaded", 500);
    }
  }

  if (id !== null && request.method === "GET") {
    try {
      const store = await dependencies.findStore(id);
      return store
        ? json({ store: apiStore(store) })
        : error("NOT_FOUND", "Store not found", 404);
    } catch {
      return error("INTERNAL_ERROR", "Store could not be loaded", 500);
    }
  }

  if (id !== null && request.method === "POST") {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error("INVALID_REQUEST", "Invalid JSON body", 400);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success)
      return json(
        {
          error: "INVALID_REQUEST",
          message: "Invalid store fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const store = await dependencies.updateStore(id, mapUpdate(parsed.data));
      return json({ store: apiStore(store) });
    } catch (cause) {
      return storeFailure(cause);
    }
  }

  const allow = id === null ? "GET" : "GET, POST";
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
