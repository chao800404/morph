import type {
  CreateLocationShippingRateInput,
  DeleteLocationShippingRateInput,
  UpdateLocationShippingRateInput,
} from "@/lib/shipping/service/location-shipping-options.service";
import { locationShippingOptionsService } from "@/lib/shipping/service/location-shipping-options.service";
import {
  createLocationShippingRateInputSchema,
  deleteLocationShippingRateInputSchema,
  updateLocationShippingRateInputSchema,
} from "@/lib/validations/shipping-admin";
import type { AdminApiAccess } from "./orders";

type LocationShippingOptionsActions = Pick<
  typeof locationShippingOptionsService,
  "list" | "create" | "update" | "delete"
>;

export type AdminLocationShippingOptionsApiDependencies =
  LocationShippingOptionsActions & {
    authorize(request: Request): Promise<AdminApiAccess>;
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

const serviceFailure = (result: { error?: string; message: string }) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "CONFLICT" || result.error === "IN_USE"
        ? 409
        : result.error === "INVALID_INPUT"
          ? 400
          : 500;
  return errorResponse(
    result.error ?? "SHIPPING_OPTIONS_FAILED",
    result.message,
    status,
  );
};

const toCamelKey = (key: string) =>
  key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());

const normalizeJsonKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJsonKeys);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, child]) => [
    toCamelKey(key),
    normalizeJsonKeys(child),
  ]);
  return Object.fromEntries(entries);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseRates = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const rate = asRecord(normalizeJsonKeys(entry));
    if (!rate) return entry;
    return {
      currencyCode: rate.currencyCode,
      amount: rate.amount,
    };
  });
};

const asUuid = (value: string | undefined) =>
  value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

const toApiGeoZone = (zone: {
  id: string;
  type: string;
  countryCode: string;
  provinceCode: string | null;
  city: string | null;
  postalExpression: unknown;
}) => ({
  id: zone.id,
  type: zone.type,
  country_code: zone.countryCode,
  province_code: zone.provinceCode,
  city: zone.city,
  postal_expression: zone.postalExpression,
});

const toApiOption = (
  option: {
    id: string;
    name: string;
    updatedAt: string;
    providerId: string | null;
    priceType: "flat" | "calculated";
    providerData: unknown;
    shippingProfileId: string | null;
    shippingProfileName: string | null;
    shippingOptionTypeId: string | null;
    shippingOptionTypeLabel: string | null;
    shippingOptionTypeCode: string | null;
    rules: Array<{ attribute: string; operator: string; value: unknown }>;
    prices: Array<{ currencyCode: string; amount: number }>;
  },
  serviceZoneId: string,
) => ({
  id: option.id,
  name: option.name,
  service_zone_id: serviceZoneId,
  shipping_profile_id: option.shippingProfileId,
  shipping_profile: option.shippingProfileId
    ? { id: option.shippingProfileId, name: option.shippingProfileName }
    : null,
  shipping_option_type_id: option.shippingOptionTypeId,
  shipping_option_type: option.shippingOptionTypeId
    ? {
        id: option.shippingOptionTypeId,
        label: option.shippingOptionTypeLabel,
        code: option.shippingOptionTypeCode,
      }
    : null,
  provider_id: option.providerId,
  price_type: option.priceType,
  provider_data: option.providerData,
  rules: option.rules.map((rule) => ({
    attribute: rule.attribute,
    operator: rule.operator,
    value: rule.value,
  })),
  prices: option.prices.map((price) => ({
    currency_code: price.currencyCode,
    amount: price.amount,
  })),
  updated_at: option.updatedAt,
});

const toApiZone = (zone: {
  id: string;
  name: string;
  updatedAt: string;
  countries: string[];
  geoZones: Array<{
    id: string;
    type: string;
    countryCode: string;
    provinceCode: string | null;
    city: string | null;
    postalExpression: unknown;
  }>;
  options: Parameters<typeof toApiOption>[0][];
}) => ({
  id: zone.id,
  name: zone.name,
  countries: zone.countries,
  geo_zones: zone.geoZones.map(toApiGeoZone),
  shipping_options: zone.options.map((option) => toApiOption(option, zone.id)),
  updated_at: zone.updatedAt,
});

const responseForFailure = (result: {
  success: false;
  message: string;
  error?: string;
  errors?: Record<string, string[]>;
}) => {
  const response = serviceFailure(result);
  if (!result.errors) return response;
  return privateJson(
    {
      error: result.error ?? "SHIPPING_OPTIONS_FAILED",
      message: result.message,
      errors: result.errors,
    },
    response.status,
  );
};

export const handleAdminLocationShippingOptionsRequest = async (
  request: Request,
  dependencies: AdminLocationShippingOptionsApiDependencies,
): Promise<Response> => {
  const access = await dependencies.authorize(request);
  if (!access.allowed) {
    return errorResponse(access.error, access.message, access.status);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const match = /^locations\/([^/]+)\/shipping-options(?:\/([^/]+))?$/.exec(
    path,
  );
  if (!match)
    return errorResponse("NOT_FOUND", "Shipping resource not found", 404);
  const locationId = match[1];
  const optionId = match[2];
  if (!locationId || !asUuid(locationId)) {
    return errorResponse("INVALID_REQUEST", "Invalid stock location ID", 400);
  }
  if (optionId && !asUuid(optionId)) {
    return errorResponse("INVALID_REQUEST", "Invalid shipping option ID", 400);
  }

  if (!optionId && request.method === "GET") {
    const result = await dependencies.list(locationId);
    if (!result.success) return responseForFailure(result);
    const zones = result.data.zones.map(toApiZone);
    const options = zones.flatMap((zone) => zone.shipping_options);
    return privateJson({
      shipping_options: options,
      service_zones: zones.map(
        ({ shipping_options: _options, ...zone }) => zone,
      ),
      fulfillment_providers: result.data.fulfillmentProviders,
      shipping_rate_providers: result.data.shippingRateProviders,
      shipping_option_types: result.data.shippingOptionTypes.map((type) => ({
        id: type.id,
        label: type.label,
        code: type.code,
        description: type.description,
      })),
      currencies: result.data.currencies.map((currency) => ({
        code: currency.code,
        symbol: currency.symbol,
        decimal_digits: currency.decimalDigits,
      })),
      count: options.length,
      offset: 0,
      limit: options.length,
    });
  }

  if (!optionId && request.method === "POST") {
    const rawBody = await readJson(request);
    const body = asRecord(normalizeJsonKeys(rawBody));
    if (!body)
      return errorResponse(
        "INVALID_REQUEST",
        "A valid JSON body is required",
        400,
      );
    const prices = body.rates ?? body.prices;
    const serviceZone = asRecord(body.serviceZone);
    const normalized: Record<string, unknown> = {
      ...body,
      locationId,
      serviceZoneId: body.serviceZoneId ?? serviceZone?.id,
      optionName: body.optionName ?? body.name,
      zoneName: body.zoneName ?? body.serviceZoneName ?? serviceZone?.name,
      geoZones: body.geoZones ?? serviceZone?.geoZones,
      rates: parseRates(prices),
    };
    delete normalized.prices;
    const parsed = createLocationShippingRateInputSchema.safeParse(normalized);
    if (!parsed.success) {
      return errorResponse("INVALID_REQUEST", "Invalid shipping option", 400);
    }
    const result = await dependencies.create(
      parsed.data as CreateLocationShippingRateInput,
    );
    if (!result.success) return responseForFailure(result);
    return privateJson(
      {
        shipping_option: {
          id: result.data.optionId,
          name: parsed.data.optionName,
          service_zone_id: result.data.serviceZoneId,
          shipping_profile_id: parsed.data.shippingProfileId,
          shipping_option_type_id: parsed.data.shippingOptionTypeId ?? null,
          provider_id: parsed.data.providerId,
          price_type: parsed.data.priceType,
          provider_data: parsed.data.providerData,
          rules: parsed.data.rules,
          updated_at: result.data.updatedAt,
        },
      },
      201,
    );
  }

  if (!optionId)
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  if (request.method === "GET") {
    const result = await dependencies.list(locationId);
    if (!result.success) return responseForFailure(result);
    for (const zone of result.data.zones) {
      const option = zone.options.find(
        (candidate) => candidate.id === optionId,
      );
      if (option)
        return privateJson({ shipping_option: toApiOption(option, zone.id) });
    }
    return errorResponse(
      "NOT_FOUND",
      "Shipping option not found for this location",
      404,
    );
  }

  if (request.method === "POST" || request.method === "PATCH") {
    const rawBody = await readJson(request);
    const body = asRecord(normalizeJsonKeys(rawBody));
    if (!body)
      return errorResponse(
        "INVALID_REQUEST",
        "A valid JSON body is required",
        400,
      );
    const prices = body.rates ?? body.prices;
    const serviceZone = asRecord(body.serviceZone);
    const normalized: Record<string, unknown> = {
      ...body,
      locationId,
      optionId,
      optionName: body.optionName ?? body.name,
      zoneName: body.zoneName ?? body.serviceZoneName ?? serviceZone?.name,
      geoZones: body.geoZones ?? serviceZone?.geoZones,
      expectedOptionUpdatedAt: body.expectedOptionUpdatedAt ?? body.updatedAt,
      expectedZoneUpdatedAt:
        body.expectedZoneUpdatedAt ??
        serviceZone?.updatedAt ??
        body.serviceZoneUpdatedAt ??
        body.zoneUpdatedAt,
      rates: parseRates(prices),
    };
    delete normalized.prices;
    const parsed = updateLocationShippingRateInputSchema.safeParse(normalized);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "Invalid shipping option update",
        400,
      );
    }
    const result = await dependencies.update(
      parsed.data as UpdateLocationShippingRateInput,
    );
    if (!result.success) return responseForFailure(result);
    return privateJson({
      shipping_option: {
        id: optionId,
        updated_at: result.data.updatedAt,
      },
    });
  }

  if (request.method === "DELETE") {
    const rawBody = await readJson(request);
    const body = asRecord(normalizeJsonKeys(rawBody)) ?? {};
    const updatedAt =
      body.expectedOptionUpdatedAt ??
      body.updatedAt ??
      url.searchParams.get("updated_at") ??
      undefined;
    const parsed = deleteLocationShippingRateInputSchema.safeParse({
      locationId,
      optionId,
      expectedOptionUpdatedAt: updatedAt,
    });
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The current updated_at value is required to deactivate this option",
        400,
      );
    }
    const result = await dependencies.delete(
      parsed.data as DeleteLocationShippingRateInput,
    );
    if (!result.success) return responseForFailure(result);
    return privateJson({
      id: optionId,
      object: "shipping_option",
      deleted: true,
    });
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
};
