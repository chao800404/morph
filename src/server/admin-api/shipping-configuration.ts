import type { ShippingOptionTypeDTO } from "@/lib/shipping/dto/shipping-option-type.dto";
import type { ShippingProfileDTO } from "@/lib/shipping/dto/shipping-profile.dto";
import type {
  CreateShippingOptionTypeInput,
  DeleteShippingOptionTypeInput,
  ShippingOptionTypeWriteResult,
  UpdateShippingOptionTypeInput,
} from "@/lib/shipping/service/shipping-option-type-write.service";
import type {
  CreateShippingProfileInput,
  ShippingProfileWriteResult,
  UpdateShippingProfileInput,
} from "@/lib/shipping/service/shipping-profile-write.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

type ListQuery = {
  query?: string | undefined;
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
};

export type AdminShippingConfigurationApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listProfiles(
    input: ListQuery & { sortBy: "name" | "createdAt" | "updatedAt" },
  ): Promise<{
    profiles: ShippingProfileDTO[];
    total: number;
  }>;
  findProfile(id: string): Promise<ShippingProfileDTO | null>;
  createProfile(
    input: CreateShippingProfileInput,
  ): Promise<ShippingProfileWriteResult>;
  updateProfile(
    input: UpdateShippingProfileInput,
  ): Promise<ShippingProfileWriteResult>;
  deleteProfile(id: string): Promise<ShippingProfileWriteResult>;
  listTypes(
    input: ListQuery & {
      sortBy: "label" | "code" | "createdAt" | "updatedAt";
    },
  ): Promise<{
    types: ShippingOptionTypeDTO[];
    total: number;
  }>;
  findType(id: string): Promise<ShippingOptionTypeDTO | null>;
  createType(
    input: CreateShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult>;
  updateType(
    input: UpdateShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult>;
  deleteType(
    input: DeleteShippingOptionTypeInput,
  ): Promise<ShippingOptionTypeWriteResult>;
};

const idSchema = z.uuid();
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
        "label",
        "-label",
        "code",
        "-code",
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
        : input.order.includes("label")
          ? ("label" as const)
          : input.order.includes("code")
            ? ("code" as const)
            : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const profileCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(["gift_card", "custom"]).default("custom"),
  })
  .strict();

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    type: z.enum(["default", "gift_card", "custom"]).optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.type !== undefined,
    "Provide at least one field to update",
  );

const optionTypeCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

const optionTypeUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    ({ label, code, description }) =>
      label !== undefined || code !== undefined || description !== undefined,
    "Provide at least one field to update",
  );

const optionTypeDeleteSchema = z
  .object({
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

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

const invalid = (message: string) =>
  errorResponse("INVALID_REQUEST", message, 400);

const profileToApi = (profile: ShippingProfileDTO) => ({
  id: profile.id,
  name: profile.name,
  type: profile.type,
  products_count: profile.productCount,
  shipping_options_count: profile.shippingOptionCount,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt,
});

const optionTypeToApi = (type: ShippingOptionTypeDTO) => ({
  id: type.id,
  label: type.label,
  code: type.code,
  description: type.description,
  shipping_options_count: type.shippingOptionCount,
  created_at: type.createdAt,
  updated_at: type.updatedAt,
});

const writeError = (
  result: Extract<
    ShippingProfileWriteResult | ShippingOptionTypeWriteResult,
    { success: false }
  >,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_NAME" ||
          result.error === "DUPLICATE_CODE" ||
          result.error === "CONFLICT" ||
          result.error === "DEFAULT_PROFILE" ||
          result.error === "PROFILE_IN_USE" ||
          result.error === "INVALID_DEFAULT_TYPE"
        ? 409
        : 500;
  return privateJson(
    {
      error: result.error,
      message: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    },
    status,
  );
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

export const handleAdminShippingConfigurationRequest = async (
  request: Request,
  dependencies: AdminShippingConfigurationApiDependencies,
): Promise<Response> => {
  const access = await dependencies.authorize(request);
  if (!access.allowed) {
    return errorResponse(access.error, access.message, access.status);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const profilePath = /^shipping-profiles(?:\/([^/]+))?$/.exec(path);
  const optionTypePath = /^shipping-option-types(?:\/([^/]+))?$/.exec(path);
  if (!profilePath && !optionTypePath) {
    return errorResponse("NOT_FOUND", "Shipping resource not found", 404);
  }

  const resourcePath = profilePath ?? optionTypePath!;
  const resourceId = resourcePath[1];
  if (resourceId !== undefined && !idSchema.safeParse(resourceId).success) {
    return invalid("Invalid resource ID");
  }

  const isProfile = profilePath !== null;
  const resourceName = isProfile
    ? "shipping_profiles"
    : "shipping_option_types";
  if (!resourceId) {
    if (request.method === "GET") {
      const query = listQuerySchema.safeParse(
        Object.fromEntries(url.searchParams.entries()),
      );
      if (!query.success) return invalid("Invalid list query");
      try {
        const { offset, ...pageQuery } = query.data;
        if (isProfile) {
          const sortBy = pageQuery.sortBy;
          if (
            sortBy !== "name" &&
            sortBy !== "createdAt" &&
            sortBy !== "updatedAt"
          ) {
            return invalid("Invalid shipping profile sort order");
          }
          const page = await dependencies.listProfiles({
            ...pageQuery,
            sortBy,
          });
          return privateJson({
            [resourceName]: page.profiles.map(profileToApi),
            count: page.total,
            offset,
            limit: query.data.limit,
          });
        }
        const sortBy = pageQuery.sortBy;
        if (
          sortBy !== "label" &&
          sortBy !== "code" &&
          sortBy !== "createdAt" &&
          sortBy !== "updatedAt"
        ) {
          return invalid("Invalid shipping option type sort order");
        }
        const page = await dependencies.listTypes({ ...pageQuery, sortBy });
        return privateJson({
          [resourceName]: page.types.map(optionTypeToApi),
          count: page.total,
          offset,
          limit: query.data.limit,
        });
      } catch {
        return errorResponse(
          "LIST_FAILED",
          "Failed to fetch shipping resources",
          500,
        );
      }
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      if (body === undefined) return invalid("A valid JSON body is required");
      if (isProfile) {
        const parsed = profileCreateSchema.safeParse(body);
        if (!parsed.success) return invalid("Invalid shipping profile");
        const result = await dependencies.createProfile(parsed.data);
        return result.success
          ? privateJson({ shipping_profile: { id: result.data.id } }, 201)
          : writeError(result);
      }
      const parsed = optionTypeCreateSchema.safeParse(body);
      if (!parsed.success) return invalid("Invalid shipping option type");
      const result = await dependencies.createType(parsed.data);
      return result.success
        ? privateJson({ shipping_option_type: { id: result.data.id } }, 201)
        : writeError(result);
    }
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  if (request.method === "GET") {
    const item = isProfile
      ? await dependencies.findProfile(resourceId)
      : await dependencies.findType(resourceId);
    if (!item)
      return errorResponse("NOT_FOUND", "Shipping resource not found", 404);
    return privateJson(
      isProfile
        ? { shipping_profile: profileToApi(item as ShippingProfileDTO) }
        : {
            shipping_option_type: optionTypeToApi(
              item as ShippingOptionTypeDTO,
            ),
          },
    );
  }

  if (request.method === "POST" || request.method === "PATCH") {
    const body = await readJson(request);
    if (body === undefined) return invalid("A valid JSON body is required");
    if (isProfile) {
      const parsed = profileUpdateSchema.safeParse(body);
      if (!parsed.success) return invalid("Invalid shipping profile update");
      const result = await dependencies.updateProfile({
        id: resourceId,
        ...parsed.data,
      });
      return result.success
        ? privateJson({ shipping_profile: { id: result.data.id } })
        : writeError(result);
    }
    const parsed = optionTypeUpdateSchema.safeParse(body);
    if (!parsed.success) return invalid("Invalid shipping option type update");
    const result = await dependencies.updateType({
      id: resourceId,
      expectedUpdatedAt: parsed.data.updated_at,
      label: parsed.data.label,
      code: parsed.data.code,
      description: parsed.data.description,
    });
    return result.success
      ? privateJson({ shipping_option_type: { id: result.data.id } })
      : writeError(result);
  }

  if (request.method === "DELETE") {
    if (isProfile) {
      const result = await dependencies.deleteProfile(resourceId);
      return result.success
        ? privateJson({
            id: resourceId,
            object: "shipping_profile",
            deleted: true,
          })
        : writeError(result);
    }
    const body = await readJson(request);
    const queryUpdatedAt = url.searchParams.get("updated_at");
    const parsed = optionTypeDeleteSchema.safeParse(
      body ?? (queryUpdatedAt ? { updated_at: queryUpdatedAt } : undefined),
    );
    if (!parsed.success) {
      return invalid(
        "The current updated_at value is required to deactivate this type",
      );
    }
    const result = await dependencies.deleteType({
      id: resourceId,
      expectedUpdatedAt: parsed.data.updated_at,
    });
    return result.success
      ? privateJson({
          id: resourceId,
          object: "shipping_option_type",
          deleted: true,
        })
      : writeError(result);
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405);
};
