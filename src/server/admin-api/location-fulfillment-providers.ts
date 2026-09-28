import type { StockLocationDTO } from "@/lib/stock-location/dto/stock-location.dto";
import {
  batchLocationFulfillmentProvidersInputSchema,
  getStockLocationInputSchema,
} from "@/lib/validations/stock-location";
import type { locationFulfillmentProviderService } from "@/lib/fulfillment/service/location-fulfillment-provider.service";
import type { AdminApiAccess } from "./orders";

type BatchResult = Awaited<
  ReturnType<typeof locationFulfillmentProviderService.batch>
>;

export type AdminLocationFulfillmentProvidersDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  findLocation(id: string): Promise<StockLocationDTO | null>;
  batch(input: {
    locationId: string;
    add: string[];
    remove: string[];
  }): Promise<BatchResult>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const errorResponse = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const responseForFailure = (
  result: Extract<BatchResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "INVALID_INPUT"
        ? 400
        : 500;
  return privateJson(
    {
      error: result.error ?? "FULFILLMENT_PROVIDERS_FAILED",
      message: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    },
    status,
  );
};

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
  };
};

/** Medusa-shaped POST /admin/stock-locations/:id/fulfillment-providers. */
export const handleAdminLocationFulfillmentProvidersRequest = async (
  request: Request,
  dependencies: AdminLocationFulfillmentProvidersDependencies,
): Promise<Response> => {
  const access = await dependencies.authorize(request);
  if (!access.allowed) {
    return errorResponse(access.error, access.message, access.status);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const match = /^stock-locations\/([^/]+)\/fulfillment-providers$/.exec(path);
  if (!match) {
    return errorResponse("NOT_FOUND", "Stock location resource not found", 404);
  }
  const locationId = match[1];
  const parsedLocationId = getStockLocationInputSchema.safeParse({
    id: locationId,
  });
  if (!parsedLocationId.success) {
    return errorResponse("INVALID_REQUEST", "Invalid stock location ID", 400);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "A valid JSON body is required",
      400,
    );
  }
  const parsed =
    batchLocationFulfillmentProvidersInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return privateJson(
      {
        error: "INVALID_REQUEST",
        message: "Invalid fulfillment provider changes",
        errors: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const validatedLocationId = parsedLocationId.data.id;
  const location = await dependencies.findLocation(validatedLocationId);
  if (!location) {
    return errorResponse("NOT_FOUND", "Stock location not found", 404);
  }

  const result = await dependencies.batch({
    locationId: validatedLocationId,
    add: parsed.data.add,
    remove: parsed.data.remove,
  });
  if (!result.success) return responseForFailure(result);

  const address = toApiAddress(location);
  return privateJson({
    stock_location: {
      id: location.id,
      name: location.name,
      address_id: address?.id ?? null,
      address,
      metadata: location.metadata,
      created_at: location.createdAt.toISOString(),
      updated_at: location.updatedAt.toISOString(),
      fulfillment_providers: result.data.fulfillmentProviderIds.map((id) => ({
        id,
        is_enabled: true,
      })),
    },
  });
};
