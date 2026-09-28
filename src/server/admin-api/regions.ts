import type {
  RegionCountryDTO,
  RegionDetailDTO,
  RegionSummaryDTO,
} from "@/lib/region/dto/region.dto";
import type {
  CreateRegionInput,
  RegionWriteResult,
  UpdateRegionInput,
} from "@/lib/region/service/region-write.service";
import {
  createRegionInputSchema,
  updateRegionInputSchema,
} from "@/lib/validations/region";
import { countryCodeSchema } from "@/lib/validations/commerce";
import {
  currencyCodeSchema,
  metadataInputSchema,
} from "@/lib/validations/product";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminRegionsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listRegions(input: {
    query?: string;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ regions: RegionSummaryDTO[]; total: number }>;
  findRegion(id: string): Promise<RegionDetailDTO | null>;
  findRegions(ids: string[]): Promise<RegionDetailDTO[]>;
  createRegion(
    input: CreateRegionInput,
  ): Promise<RegionWriteResult<{ id: string }>>;
  updateRegion(
    input: UpdateRegionInput,
  ): Promise<RegionWriteResult<{ id: string }>>;
  deleteRegions(ids: string[]): Promise<RegionWriteResult<{ deleted: number }>>;
};

const listQuerySchema = z
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
        "name",
        "-name",
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

const apiCountrySchema = z.union([
  countryCodeSchema,
  z
    .object({ iso_2: countryCodeSchema })
    .strict()
    .transform((item) => item.iso_2),
]);

const apiPaymentProviderSchema = z.union([
  z.string().trim().min(1).max(200),
  z
    .object({ id: z.string().trim().min(1).max(200) })
    .strict()
    .transform((item) => item.id),
]);

const createBodySchema = z
  .object({
    name: z.string(),
    currency_code: currencyCodeSchema,
    countries: z.array(apiCountrySchema).max(250).default([]),
    payment_providers: z.array(apiPaymentProviderSchema).min(1).max(50),
    automatic_taxes: z.boolean().optional(),
    is_tax_inclusive: z.boolean().optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .transform((input) => ({
    name: input.name,
    currencyCode: input.currency_code,
    countries: input.countries,
    paymentProviderIds: input.payment_providers,
    automaticTaxes: input.automatic_taxes,
    isTaxInclusive: input.is_tax_inclusive,
    metadata: input.metadata,
  }));

const updateBodySchema = z
  .object({
    name: z.string().optional(),
    currency_code: currencyCodeSchema.optional(),
    countries: z.array(apiCountrySchema).max(250).optional(),
    payment_providers: z
      .array(apiPaymentProviderSchema)
      .min(1)
      .max(50)
      .optional(),
    automatic_taxes: z.boolean().optional(),
    is_tax_inclusive: z.boolean().optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0)
  .transform((input) => ({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.currency_code !== undefined
      ? { currencyCode: input.currency_code }
      : {}),
    ...(input.countries !== undefined ? { countries: input.countries } : {}),
    ...(input.payment_providers !== undefined
      ? { paymentProviderIds: input.payment_providers }
      : {}),
    ...(input.automatic_taxes !== undefined
      ? { automaticTaxes: input.automatic_taxes }
      : {}),
    ...(input.is_tax_inclusive !== undefined
      ? { isTaxInclusive: input.is_tax_inclusive }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
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

const authorizeAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const regionApi = (region: RegionSummaryDTO | RegionDetailDTO) => ({
  id: region.id,
  name: region.name,
  currency_code: region.currencyCode,
  automatic_taxes: region.automaticTaxes,
  is_tax_inclusive: region.isTaxInclusive,
  metadata: region.metadata,
  created_at: region.createdAt,
  updated_at: region.updatedAt,
  ...(isRegionDetail(region)
    ? {
        countries: region.countries.map((country: RegionCountryDTO) => ({
          iso_2: country.iso2,
          iso_3: country.iso3,
          num_code: country.numCode,
          name: country.name,
          display_name: country.displayName,
          region_id: country.regionId,
        })),
        payment_providers: region.paymentProviderIds.map((id) => ({ id })),
      }
    : {}),
});

const isRegionDetail = (
  region: RegionSummaryDTO | RegionDetailDTO,
): region is RegionDetailDTO => "countries" in region;

const writeFailure = (
  result: Extract<RegionWriteResult<never>, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "COUNTRY_TAKEN"
        ? 409
        : result.error === "PROVIDER_UNAVAILABLE"
          ? 422
          : 500;
  return privateJson(
    {
      error: result.error,
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const loadRegion = async (
  id: string,
  dependencies: AdminRegionsApiDependencies,
) => {
  const region = await dependencies.findRegion(id);
  return region
    ? privateJson({ region: regionApi(region) })
    : routeError("NOT_FOUND", "Region not found", 404);
};

/** Medusa-shaped Region REST routes backed by Morph's region DAL and write service. */
export async function handleAdminRegionsRequest(
  request: Request,
  path: string,
  dependencies: AdminRegionsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    return routeError(
      "UNAUTHORIZED",
      "A signed-in commerce user is required",
      401,
    );
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);
  if (!authorizeAdmin(access))
    return routeError("FORBIDDEN", "Administrator access is required", 403);

  const collectionMatch = path === "regions";
  const itemMatch = /^regions\/([^/]+)$/.exec(path);

  if (collectionMatch && request.method === "GET") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid regions query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listRegions(parsed.data);
      const details = await dependencies.findRegions(
        result.regions.map((region) => region.id),
      );
      const detailsById = new Map(details.map((region) => [region.id, region]));
      return privateJson({
        regions: result.regions.map((region) => {
          const detail = detailsById.get(region.id);
          return detail ? regionApi(detail) : regionApi(region);
        }),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Regions could not be loaded", 500);
    }
  }

  if (collectionMatch && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsedBody = createBodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid region fields",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const parsed = createRegionInputSchema.safeParse(parsedBody.data);
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid region fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.createRegion(parsed.data);
      if (!result.success) return writeFailure(result);
      const response = await loadRegion(result.data.id, dependencies);
      if (response.status !== 200) return response;
      return new Response(response.body, {
        status: 201,
        headers: response.headers,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Region could not be created", 500);
    }
  }

  if (itemMatch) {
    const id = z.uuid().safeParse(itemMatch[1] ?? "");
    if (!id.success)
      return routeError("INVALID_REQUEST", "Invalid region ID", 400);
    if (request.method === "GET") {
      try {
        return await loadRegion(id.data, dependencies);
      } catch {
        return routeError("INTERNAL_ERROR", "Region could not be loaded", 500);
      }
    }
    if (request.method === "POST") {
      const raw = await readJson(request);
      if (raw === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const parsedBody = updateBodySchema.safeParse(raw);
      if (!parsedBody.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid region fields",
            details: parsedBody.error.flatten().fieldErrors,
          },
          400,
        );
      }
      const parsed = updateRegionInputSchema.safeParse({
        id: id.data,
        ...parsedBody.data,
      });
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid region fields",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        const result = await dependencies.updateRegion(parsed.data);
        if (!result.success) return writeFailure(result);
        return await loadRegion(id.data, dependencies);
      } catch {
        return routeError("INTERNAL_ERROR", "Region could not be updated", 500);
      }
    }
    if (request.method === "DELETE") {
      try {
        const result = await dependencies.deleteRegions([id.data]);
        if (!result.success) return writeFailure(result);
        return privateJson({
          id: id.data,
          object: "region",
          deleted: true,
        });
      } catch {
        return routeError("INTERNAL_ERROR", "Region could not be deleted", 500);
      }
    }
  }

  return routeError("NOT_FOUND", "Region route not found", 404);
}
