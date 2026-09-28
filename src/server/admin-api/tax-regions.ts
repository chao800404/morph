import type {
  TaxRateDTO,
  TaxRegionDTO,
  TaxRegionSummaryDTO,
} from "@/lib/tax/dto/tax.dto";
import type {
  CreateTaxProvinceInput,
  CreateTaxRateInput,
  CreateTaxRegionInput,
  TaxWriteResult,
  UpdateTaxRateInput,
  UpdateTaxRegionInput,
} from "@/lib/tax/service/tax-write.service";
import {
  createTaxProvinceInputSchema,
  createTaxRateInputSchema,
  createTaxRegionInputSchema,
  updateTaxRateInputSchema,
  updateTaxRegionInputSchema,
  taxRateRuleReferenceSchema,
} from "@/lib/validations/tax";
import { countryCodeSchema } from "@/lib/validations/commerce";
import { metadataInputSchema } from "@/lib/validations/product";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminTaxRegionsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listProviders(): Promise<Array<{ id: string }>>;
  listRegions(input: {
    countryCode?: string;
    provinceCode?: string;
    parentId?: string;
    providerId?: string;
    query?: string;
    sortBy: "countryCode" | "provinceCode" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ taxRegions: TaxRegionSummaryDTO[]; total: number }>;
  findRegion(id: string): Promise<TaxRegionDTO | null>;
  listRatesForRegionIds(regionIds: string[]): Promise<TaxRateDTO[]>;
  listRates(input: {
    taxRegionId?: string;
    isDefault?: boolean;
    query?: string;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ taxRates: TaxRateDTO[]; total: number }>;
  findRate(id: string): Promise<TaxRateDTO | null>;
  createRegion(
    input: CreateTaxRegionInput,
    actorId: string,
  ): Promise<TaxWriteResult<{ id: string }>>;
  createProvince(
    input: CreateTaxProvinceInput,
    actorId: string,
  ): Promise<TaxWriteResult<{ id: string }>>;
  updateRegion(
    input: UpdateTaxRegionInput,
  ): Promise<TaxWriteResult<{ id: string }>>;
  deleteRegions(ids: string[]): Promise<TaxWriteResult<{ deleted: number }>>;
  createRate(
    input: CreateTaxRateInput,
    actorId: string,
  ): Promise<TaxWriteResult<{ id: string }>>;
  updateRate(
    input: UpdateTaxRateInput,
  ): Promise<TaxWriteResult<{ id: string }>>;
  deleteRates(ids: string[]): Promise<TaxWriteResult<{ deleted: number }>>;
};

const querySchema = z
  .object({
    country_code: countryCodeSchema.optional(),
    province_code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .transform((value) => value.toUpperCase())
      .optional(),
    parent_id: z.uuid().optional(),
    provider_id: z.string().trim().min(1).max(128).optional(),
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "country_code",
        "-country_code",
        "province_code",
        "-province_code",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .default("country_code"),
  })
  .strict()
  .transform((input) => ({
    countryCode: input.country_code,
    provinceCode: input.province_code,
    parentId: input.parent_id,
    providerId: input.provider_id,
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("created_at")
        ? ("createdAt" as const)
        : input.order.includes("province_code")
          ? ("provinceCode" as const)
          : ("countryCode" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const providerListQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const apiDefaultRateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(100),
    rate: z.number().finite().min(0).max(100).nullable(),
    is_combinable: z.boolean().default(false),
  })
  .strict()
  .transform((input) => ({
    name: input.name,
    code: input.code,
    rate: input.rate,
    isCombinable: input.is_combinable,
  }));

const createRegionBodySchema = z
  .object({
    country_code: countryCodeSchema.optional(),
    province_code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .transform((value) => value.toUpperCase())
      .optional(),
    parent_id: z.uuid().optional(),
    provider_id: z.string().trim().min(1).max(128).nullable().optional(),
    default_tax_rate: apiDefaultRateSchema.optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.parent_id
        ? Boolean(input.province_code) && input.provider_id == null
        : Boolean(input.country_code) && !input.province_code,
    {
      message:
        "Provide a country code for a country region or parent and province codes for a sub-region",
    },
  );

const updateRegionBodySchema = z
  .object({
    provider_id: z.string().trim().min(1).max(128).nullable().optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);

const apiRulesSchema = z
  .array(
    z
      .object({
        reference: taxRateRuleReferenceSchema,
        reference_id: z.uuid(),
      })
      .strict()
      .transform((rule) => ({
        reference: rule.reference,
        referenceId: rule.reference_id,
      })),
  )
  .max(500);

const createRateBodySchema = z
  .object({
    tax_region_id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(100),
    rate: z.number().finite().min(0).max(100).nullable(),
    is_default: z.boolean().default(false),
    is_combinable: z.boolean().default(false),
    rules: apiRulesSchema.default([]),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .transform((input) => ({
    taxRegionId: input.tax_region_id,
    name: input.name,
    code: input.code,
    rate: input.rate,
    isDefault: input.is_default,
    isCombinable: input.is_combinable,
    rules: input.rules,
    metadata: input.metadata,
  }));

const updateRateBodySchema = z
  .object({
    tax_region_id: z.uuid().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(1).max(100).optional(),
    rate: z.number().finite().min(0).max(100).nullable().optional(),
    is_default: z.boolean().optional(),
    is_combinable: z.boolean().optional(),
    rules: apiRulesSchema.optional(),
    metadata: metadataInputSchema.optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined))
  .transform((input) => ({
    ...(input.tax_region_id !== undefined
      ? { taxRegionId: input.tax_region_id }
      : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
    ...(input.is_default !== undefined ? { isDefault: input.is_default } : {}),
    ...(input.is_combinable !== undefined
      ? { isCombinable: input.is_combinable }
      : {}),
    ...(input.rules !== undefined ? { rules: input.rules } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }));

const rateListQuerySchema = z
  .object({
    tax_region_id: z.uuid().optional(),
    is_default: z.coerce.boolean().optional(),
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
    taxRegionId: input.tax_region_id,
    isDefault: input.is_default,
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("created_at")
        ? ("createdAt" as const)
        : ("name" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

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

const authorizeAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const readBody = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const validationError = (message: string, details: unknown) =>
  json({ error: "INVALID_REQUEST", message, details }, 400);

const writeError = (
  result: Extract<TaxWriteResult<never>, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "COUNTRY_UNAVAILABLE" ||
          result.error === "DUPLICATE_PROVINCE" ||
          result.error === "INVALID_REGION_LEVEL"
        ? 409
        : result.error === "PROVIDER_UNAVAILABLE" ||
            result.error === "INVALID_RULE_TARGETS" ||
            result.error === "INVALID_RULES"
          ? 422
          : 500;
  return json(
    {
      error: result.error,
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const ruleApi = (rule: TaxRateDTO["rules"][number]) => ({
  id: rule.id,
  tax_rate_id: rule.taxRateId,
  reference: rule.reference,
  reference_id: rule.referenceId,
});

const rateApi = (rate: TaxRateDTO) => ({
  id: rate.id,
  tax_region_id: rate.taxRegionId,
  rate: rate.rate,
  code: rate.code,
  name: rate.name,
  is_default: rate.isDefault,
  is_combinable: rate.isCombinable,
  metadata: rate.metadata,
  rules: rate.rules.map(ruleApi),
  created_at: rate.createdAt,
  updated_at: rate.updatedAt,
});

const taxRegionApi = (
  region: TaxRegionDTO | TaxRegionSummaryDTO,
  rates?: TaxRateDTO[],
) => ({
  id: region.id,
  country_code: region.countryCode,
  province_code: region.provinceCode,
  parent_id: region.parentId,
  provider_id: region.providerId,
  metadata: region.metadata,
  ...(rates ? { tax_rates: rates.map(rateApi) } : {}),
  created_at: region.createdAt,
  updated_at: region.updatedAt,
});

const loadRegion = async (
  id: string,
  dependencies: AdminTaxRegionsApiDependencies,
) => {
  const region = await dependencies.findRegion(id);
  if (!region) return error("NOT_FOUND", "Tax region not found", 404);
  const rates = await dependencies.listRatesForRegionIds([region.id]);
  return json({ tax_region: taxRegionApi(region, rates) });
};

const loadRate = async (
  id: string,
  dependencies: AdminTaxRegionsApiDependencies,
) => {
  const rate = await dependencies.findRate(id);
  return rate
    ? json({ tax_rate: rateApi(rate) })
    : error("NOT_FOUND", "Tax rate not found", 404);
};

/** Medusa-shaped Admin REST routes for tax regions, sub-regions, rates and rules. */
export async function handleAdminTaxRegionsRequest(
  request: Request,
  path: string,
  dependencies: AdminTaxRegionsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    return error("UNAUTHORIZED", "A signed-in commerce user is required", 401);
  }
  if (!access.allowed)
    return error(access.error, access.message, access.status);
  if (!authorizeAdmin(access))
    return error("FORBIDDEN", "Administrator access is required", 403);

  const regionCollection = path === "tax-regions";
  const regionItem = /^tax-regions\/([^/]+)$/.exec(path);
  const rateCollection = path === "tax-rates";
  const rateItem = /^tax-rates\/([^/]+)$/.exec(path);

  if (path === "tax-providers" && request.method === "GET") {
    const parsed = providerListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return validationError(
        "Invalid tax provider query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const providers = await dependencies.listProviders();
      return json({
        tax_providers: providers
          .slice(parsed.data.offset, parsed.data.offset + parsed.data.limit)
          .map((provider) => ({ id: provider.id, is_enabled: true })),
        count: providers.length,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error("INTERNAL_ERROR", "Tax providers could not be loaded", 500);
    }
  }

  if (regionCollection && request.method === "GET") {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return validationError(
        "Invalid tax region query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.listRegions(parsed.data);
      return json({
        tax_regions: result.taxRegions.map((region) => taxRegionApi(region)),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error("INTERNAL_ERROR", "Tax regions could not be loaded", 500);
    }
  }

  if (regionCollection && request.method === "POST") {
    const raw = await readBody(request);
    if (raw === null) return error("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = createRegionBodySchema.safeParse(raw);
    if (!parsed.success)
      return validationError(
        "Invalid tax region fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      let result: TaxWriteResult<{ id: string }>;
      if (parsed.data.parent_id) {
        const parent = await dependencies.findRegion(parsed.data.parent_id);
        if (!parent || parent.parentId)
          return error("NOT_FOUND", "Parent tax region not found", 404);
        if (
          parsed.data.country_code &&
          parsed.data.country_code !== parent.countryCode
        )
          return error(
            "INVALID_REQUEST",
            "Sub-region country must match its parent",
            400,
          );
        const input = createTaxProvinceInputSchema.safeParse({
          parentId: parsed.data.parent_id,
          provinceCode: parsed.data.province_code,
          defaultTaxRate: parsed.data.default_tax_rate,
          metadata: parsed.data.metadata,
        });
        if (!input.success)
          return validationError(
            "Invalid sub-region fields",
            input.error.flatten().fieldErrors,
          );
        result = await dependencies.createProvince(input.data, access.userId);
      } else {
        const input = createTaxRegionInputSchema.safeParse({
          countryCode: parsed.data.country_code,
          providerId: parsed.data.provider_id ?? undefined,
          defaultTaxRate: parsed.data.default_tax_rate,
          metadata: parsed.data.metadata,
        });
        if (!input.success)
          return validationError(
            "Invalid tax region fields",
            input.error.flatten().fieldErrors,
          );
        result = await dependencies.createRegion(input.data, access.userId);
      }
      if (!result.success) return writeError(result);
      const loaded = await loadRegion(result.data.id, dependencies);
      if (loaded.status !== 200) return loaded;
      return new Response(loaded.body, {
        status: 201,
        headers: loaded.headers,
      });
    } catch {
      return error("INTERNAL_ERROR", "Tax region could not be created", 500);
    }
  }

  if (regionItem) {
    const id = z.uuid().safeParse(regionItem[1] ?? "");
    if (!id.success)
      return error("INVALID_REQUEST", "Invalid tax region ID", 400);
    if (request.method === "GET") {
      try {
        return await loadRegion(id.data, dependencies);
      } catch {
        return error("INTERNAL_ERROR", "Tax region could not be loaded", 500);
      }
    }
    if (request.method === "POST") {
      const raw = await readBody(request);
      if (raw === null)
        return error("INVALID_REQUEST", "Invalid JSON body", 400);
      const body = updateRegionBodySchema.safeParse(raw);
      if (!body.success)
        return validationError(
          "Invalid tax region fields",
          body.error.flatten().fieldErrors,
        );
      const parsed = updateTaxRegionInputSchema.safeParse({
        id: id.data,
        providerId: body.data.provider_id,
        metadata: body.data.metadata,
      });
      if (!parsed.success)
        return validationError(
          "Invalid tax region fields",
          parsed.error.flatten().fieldErrors,
        );
      try {
        const result = await dependencies.updateRegion(parsed.data);
        if (!result.success) return writeError(result);
        return await loadRegion(id.data, dependencies);
      } catch {
        return error("INTERNAL_ERROR", "Tax region could not be updated", 500);
      }
    }
    if (request.method === "DELETE") {
      try {
        const result = await dependencies.deleteRegions([id.data]);
        if (!result.success) return writeError(result);
        return json({ id: id.data, object: "tax_region", deleted: true });
      } catch {
        return error("INTERNAL_ERROR", "Tax region could not be deleted", 500);
      }
    }
  }

  if (rateCollection && request.method === "GET") {
    const parsed = rateListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return validationError(
        "Invalid tax rate query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.listRates(parsed.data);
      return json({
        tax_rates: result.taxRates.map(rateApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error("INTERNAL_ERROR", "Tax rates could not be loaded", 500);
    }
  }

  if (rateCollection && request.method === "POST") {
    const raw = await readBody(request);
    if (raw === null) return error("INVALID_REQUEST", "Invalid JSON body", 400);
    const body = createRateBodySchema.safeParse(raw);
    if (!body.success)
      return validationError(
        "Invalid tax rate fields",
        body.error.flatten().fieldErrors,
      );
    const parsed = createTaxRateInputSchema.safeParse(body.data);
    if (!parsed.success)
      return validationError(
        "Invalid tax rate fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.createRate(parsed.data, access.userId);
      if (!result.success) return writeError(result);
      const loaded = await loadRate(result.data.id, dependencies);
      if (loaded.status !== 200) return loaded;
      return new Response(loaded.body, {
        status: 201,
        headers: loaded.headers,
      });
    } catch {
      return error("INTERNAL_ERROR", "Tax rate could not be created", 500);
    }
  }

  if (rateItem) {
    const id = z.uuid().safeParse(rateItem[1] ?? "");
    if (!id.success)
      return error("INVALID_REQUEST", "Invalid tax rate ID", 400);
    if (request.method === "GET") {
      try {
        return await loadRate(id.data, dependencies);
      } catch {
        return error("INTERNAL_ERROR", "Tax rate could not be loaded", 500);
      }
    }
    if (request.method === "POST") {
      const raw = await readBody(request);
      if (raw === null)
        return error("INVALID_REQUEST", "Invalid JSON body", 400);
      const body = updateRateBodySchema.safeParse(raw);
      if (!body.success)
        return validationError(
          "Invalid tax rate fields",
          body.error.flatten().fieldErrors,
        );
      try {
        const existing = await dependencies.findRate(id.data);
        if (!existing) return error("NOT_FOUND", "Tax rate not found", 404);
        if (
          body.data.taxRegionId &&
          body.data.taxRegionId !== existing.taxRegionId
        )
          return error(
            "INVALID_REQUEST",
            "A tax rate cannot be moved to another tax region",
            400,
          );
        const parsed = updateTaxRateInputSchema.safeParse({
          id: id.data,
          taxRegionId: existing.taxRegionId,
          ...body.data,
        });
        if (!parsed.success)
          return validationError(
            "Invalid tax rate fields",
            parsed.error.flatten().fieldErrors,
          );
        const result = await dependencies.updateRate(parsed.data);
        if (!result.success) return writeError(result);
        return await loadRate(id.data, dependencies);
      } catch {
        return error("INTERNAL_ERROR", "Tax rate could not be updated", 500);
      }
    }
    if (request.method === "DELETE") {
      try {
        const result = await dependencies.deleteRates([id.data]);
        if (!result.success) return writeError(result);
        return json({ id: id.data, object: "tax_rate", deleted: true });
      } catch {
        return error("INTERNAL_ERROR", "Tax rate could not be deleted", 500);
      }
    }
  }

  return error("NOT_FOUND", "Tax route not found", 404);
}
