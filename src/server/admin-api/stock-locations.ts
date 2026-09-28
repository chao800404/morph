import type {
  StockLocationDTO,
  StockLocationFulfillmentSetDTO,
} from "@/lib/stock-location/dto/stock-location.dto";
import type { SalesChannelDTO } from "@/lib/sales-channel/dto/sales-channel.dto";
import type { AdminApiAccess } from "./orders";
import type {
  CreateStockLocationInput,
  CreateStockLocationFulfillmentSetInput,
  UpdateStockLocationInput,
} from "@/lib/validations/stock-location";
import {
  batchStockLocationSalesChannelsInputSchema,
  createStockLocationFulfillmentSetInputSchema,
  createStockLocationInputSchema,
  updateStockLocationInputSchema,
} from "@/lib/validations/stock-location";
import type { StockLocationWriteResult } from "@/lib/stock-location/service/stock-location-write.service";
import { countryCodeSchema } from "@/lib/validations/commerce";
import { metadataInputSchema } from "@/lib/validations/product";
import { z } from "zod";

export type AdminStockLocationsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listLocations(input: {
    query?: string;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ locations: StockLocationDTO[]; total: number }>;
  findLocation(id: string): Promise<StockLocationDTO | null>;
  listChannelIds(locationId: string): Promise<string[]>;
  findSalesChannels(ids: string[]): Promise<SalesChannelDTO[]>;
  listFulfillmentProviderIds(locationId: string): Promise<string[]>;
  listFulfillmentSets(
    locationId: string,
  ): Promise<StockLocationFulfillmentSetDTO[]>;
  createLocation(
    input: CreateStockLocationInput,
  ): Promise<StockLocationWriteResult>;
  updateLocation(
    input: UpdateStockLocationInput,
  ): Promise<StockLocationWriteResult>;
  deleteLocations(ids: string[]): Promise<StockLocationWriteResult>;
  batchSalesChannels(input: {
    locationId: string;
    add: string[];
    remove: string[];
  }): Promise<StockLocationWriteResult>;
  createFulfillmentSet(
    locationId: string,
    input: CreateStockLocationFulfillmentSetInput,
  ): Promise<StockLocationWriteResult>;
};

const apiAddressSchema = z
  .object({
    address_1: z.string().trim().min(1).max(300),
    address_2: z.string().trim().max(300).nullish(),
    company: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(120).nullish(),
    country_code: countryCodeSchema,
    province: z.string().trim().max(120).nullish(),
    postal_code: z.string().trim().max(40).nullish(),
    phone: z.string().trim().max(40).nullish(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .transform((address) => ({
    address1: address.address_1,
    address2: address.address_2 ?? null,
    company: address.company ?? null,
    city: address.city ?? null,
    countryCode: address.country_code,
    province: address.province ?? null,
    postalCode: address.postal_code ?? null,
    phone: address.phone ?? null,
    metadata: address.metadata ?? {},
  }));

const apiAddressPatchSchema = z
  .object({
    address_1: z.string().trim().min(1).max(300).optional(),
    address_2: z.string().trim().max(300).nullish(),
    company: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(120).nullish(),
    country_code: countryCodeSchema.optional(),
    province: z.string().trim().max(120).nullish(),
    postal_code: z.string().trim().max(40).nullish(),
    phone: z.string().trim().max(40).nullish(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .transform((address) => ({
    ...(address.address_1 !== undefined ? { address1: address.address_1 } : {}),
    ...(address.address_2 !== undefined ? { address2: address.address_2 } : {}),
    ...(address.company !== undefined ? { company: address.company } : {}),
    ...(address.city !== undefined ? { city: address.city } : {}),
    ...(address.country_code !== undefined
      ? { countryCode: address.country_code }
      : {}),
    ...(address.province !== undefined ? { province: address.province } : {}),
    ...(address.postal_code !== undefined
      ? { postalCode: address.postal_code }
      : {}),
    ...(address.phone !== undefined ? { phone: address.phone } : {}),
    ...(address.metadata !== undefined ? { metadata: address.metadata } : {}),
  }));

const createLocationBodySchema = z
  .object({
    name: z.string(),
    address: apiAddressSchema.nullish(),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

const updateLocationBodySchema = z
  .object({
    name: z.string().optional(),
    address: apiAddressPatchSchema.nullish().optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "name",
        "-name",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("name")
        ? ("name" as const)
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

const writeFailureResponse = (
  result: Extract<StockLocationWriteResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "CONFLICT" || result.error === "DUPLICATE_NAME"
        ? 409
        : result.error === "INVALID_INPUT"
          ? 400
          : 500;
  return privateJson(
    {
      error: result.error ?? "STOCK_LOCATION_WRITE_FAILED",
      message: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    },
    status,
  );
};

const readJson = async (
  request: Request,
): Promise<{ success: true; data: unknown } | { success: false }> => {
  try {
    return { success: true, data: await request.json() };
  } catch {
    return { success: false };
  }
};

const invalidBody = (message: string) =>
  routeError("INVALID_REQUEST", message, 400);

const toApiAddress = (location: StockLocationDTO) => {
  const address = location.address;
  if (!address) return null;
  return {
    id: address.id,
    address_1: address.address1,
    address_2: address.address2,
    company: address.company,
    country_code: address.countryCode,
    city: address.city,
    phone: address.phone,
    postal_code: address.postalCode,
    province: address.province,
    metadata: address.metadata,
  };
};

const toApiLocation = (location: StockLocationDTO) => {
  const address = toApiAddress(location);
  return {
    id: location.id,
    name: location.name,
    address_id: address?.id ?? null,
    address,
    metadata: location.metadata,
    created_at: location.createdAt.toISOString(),
    updated_at: location.updatedAt.toISOString(),
  };
};

/** Medusa-shaped GET /admin/stock-locations list and detail endpoints. */
export const handleAdminStockLocationsRequest = async (
  request: Request,
  dependencies: AdminStockLocationsApiDependencies,
): Promise<Response> => {
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
  const detailMatch = /^stock-locations\/([^/]+)$/.exec(path);
  const salesChannelsMatch = /^stock-locations\/([^/]+)\/sales-channels$/.exec(
    path,
  );
  const fulfillmentSetsMatch =
    /^stock-locations\/([^/]+)\/fulfillment-sets$/.exec(path);
  if (
    path !== "stock-locations" &&
    !detailMatch &&
    !salesChannelsMatch &&
    !fulfillmentSetsMatch
  ) {
    return routeError("NOT_FOUND", "Stock location resource not found", 404);
  }
  const isListPath = path === "stock-locations";
  const methodAllowed =
    salesChannelsMatch || fulfillmentSetsMatch
      ? request.method === "POST"
      : isListPath
        ? ["GET", "POST"].includes(request.method)
        : ["GET", "POST", "DELETE"].includes(request.method);
  if (!methodAllowed) {
    const allow =
      salesChannelsMatch || fulfillmentSetsMatch
        ? "POST"
        : isListPath
          ? "GET, POST"
          : "GET, POST, DELETE";
    return new Response(
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
  }

  const requireAdministrator = () =>
    !access.userId || access.role !== "admin"
      ? routeError("FORBIDDEN", "Administrator access is required", 403)
      : null;

  const loadLocation = async (id: string): Promise<Response> => {
    try {
      const location = await dependencies.findLocation(id);
      if (!location)
        return routeError("NOT_FOUND", "Stock location not found", 404);
      const channelIds = await dependencies.listChannelIds(location.id);
      const [channels, providerIds, fulfillmentSets] = await Promise.all([
        dependencies.findSalesChannels(channelIds),
        dependencies.listFulfillmentProviderIds(location.id),
        dependencies.listFulfillmentSets(location.id),
      ]);
      return privateJson({
        stock_location: {
          ...toApiLocation(location),
          sales_channels: channels.map(({ id: channelId, name }) => ({
            id: channelId,
            name,
          })),
          fulfillment_providers: providerIds.map((providerId) => ({
            id: providerId,
            is_enabled: true,
          })),
          fulfillment_sets: fulfillmentSets.map((set) => ({
            id: set.id,
            name: set.name,
            type: set.type,
            metadata: set.metadata,
            created_at: set.createdAt.toISOString(),
            updated_at: set.updatedAt.toISOString(),
          })),
        },
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location could not be loaded",
        500,
      );
    }
  };

  if (fulfillmentSetsMatch) {
    const forbidden = requireAdministrator();
    if (forbidden) return forbidden;
    const parsedId = z.uuid().safeParse(fulfillmentSetsMatch[1]);
    if (!parsedId.success) {
      return routeError("INVALID_REQUEST", "Invalid stock location ID", 400);
    }
    const body = await readJson(request);
    if (!body.success) return invalidBody("A valid JSON body is required");
    const parsed = createStockLocationFulfillmentSetInputSchema.safeParse(
      body.data,
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid fulfillment set fields",
          errors: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.createFulfillmentSet(
        parsedId.data,
        parsed.data,
      );
      if (!result.success) return writeFailureResponse(result);
      return await loadLocation(parsedId.data);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location fulfillment set could not be created",
        500,
      );
    }
  }

  if (salesChannelsMatch) {
    const forbidden = requireAdministrator();
    if (forbidden) return forbidden;
    const parsedId = z.uuid().safeParse(salesChannelsMatch[1]);
    if (!parsedId.success) {
      return routeError("INVALID_REQUEST", "Invalid stock location ID", 400);
    }
    const body = await readJson(request);
    if (!body.success) return invalidBody("A valid JSON body is required");
    const parsed = batchStockLocationSalesChannelsInputSchema.safeParse(
      body.data,
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid sales channel changes",
          errors: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.batchSalesChannels({
        locationId: parsedId.data,
        add: parsed.data.add,
        remove: parsed.data.remove,
      });
      if (!result.success) return writeFailureResponse(result);
      return await loadLocation(parsedId.data);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location sales channels could not be updated",
        500,
      );
    }
  }

  if (path === "stock-locations" && request.method === "POST") {
    const forbidden = requireAdministrator();
    if (forbidden) return forbidden;
    const body = await readJson(request);
    if (!body.success) return invalidBody("A valid JSON body is required");
    const parsedBody = createLocationBodySchema.safeParse(body.data);
    if (!parsedBody.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid stock location fields",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const parsedInput = createStockLocationInputSchema.safeParse(
      parsedBody.data,
    );
    if (!parsedInput.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid stock location fields",
          details: parsedInput.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.createLocation(parsedInput.data);
      if (!result.success) return writeFailureResponse(result);
      if (!result.data.id)
        return routeError(
          "INTERNAL_ERROR",
          "Stock location was not created",
          500,
        );
      return await loadLocation(result.data.id);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location could not be created",
        500,
      );
    }
  }

  if (request.method === "GET" && path === "stock-locations") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid stock location list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listLocations(parsed.data);
      return privateJson({
        stock_locations: result.locations.map(toApiLocation),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock locations could not be loaded",
        500,
      );
    }
  }

  const parsedId = z.uuid().safeParse(detailMatch?.[1] ?? "");
  if (!parsedId.success)
    return routeError("INVALID_REQUEST", "Invalid stock location ID", 400);

  if (request.method === "GET") return loadLocation(parsedId.data);

  if (request.method === "POST") {
    const forbidden = requireAdministrator();
    if (forbidden) return forbidden;
    const body = await readJson(request);
    if (!body.success) return invalidBody("A valid JSON body is required");
    const parsedBody = updateLocationBodySchema.safeParse(body.data);
    if (!parsedBody.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid stock location fields",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const parsedInput = updateStockLocationInputSchema.safeParse({
      id: parsedId.data,
      ...parsedBody.data,
    });
    if (!parsedInput.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid stock location fields",
          details: parsedInput.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.updateLocation(parsedInput.data);
      if (!result.success) return writeFailureResponse(result);
      return await loadLocation(parsedId.data);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location could not be updated",
        500,
      );
    }
  }

  if (request.method === "DELETE") {
    const forbidden = requireAdministrator();
    if (forbidden) return forbidden;
    try {
      const result = await dependencies.deleteLocations([parsedId.data]);
      if (!result.success) return writeFailureResponse(result);
      return privateJson({
        id: parsedId.data,
        object: "stock_location",
        deleted: true,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Stock location could not be deleted",
        500,
      );
    }
  }

  return routeError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
};
