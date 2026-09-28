import type { ProductMetadata } from "@/db/product.schema";
import { metadataInputSchema } from "@/lib/validations/product";
import type {
  ProductTagAdminDTO,
  ProductTypeAdminDTO,
} from "@/lib/product/dto/product-taxonomy.dto";
import type { ServerResult } from "@/lib/db/server-result";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

type ListInput = {
  query?: string;
  sortBy: "value" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  offset: number;
  limit: number;
};

type WriteInput = {
  value?: string;
  metadata?: ProductMetadata;
  externalId?: string | null;
};

export type AdminProductDictionariesApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listTypes(input: ListInput): Promise<{
    types: ProductTypeAdminDTO[];
    total: number;
  }>;
  findType(id: string): Promise<ProductTypeAdminDTO | null>;
  createType(
    input: Required<Pick<WriteInput, "value">> & Omit<WriteInput, "value">,
  ): Promise<ServerResult<{ id: string }>>;
  updateType(
    input: WriteInput & { id: string },
  ): Promise<ServerResult<{ id: string }>>;
  deleteType(
    id: string,
    actorId: string,
  ): Promise<ServerResult<{ id: string }>>;
  listTags(input: ListInput): Promise<{
    tags: ProductTagAdminDTO[];
    total: number;
  }>;
  findTag(id: string): Promise<ProductTagAdminDTO | null>;
  createTag(
    input: Required<Pick<WriteInput, "value">> & Omit<WriteInput, "value">,
  ): Promise<ServerResult<{ id: string }>>;
  updateTag(
    input: WriteInput & { id: string },
  ): Promise<ServerResult<{ id: string }>>;
  deleteTag(id: string, actorId: string): Promise<ServerResult<{ id: string }>>;
};

const querySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "value",
        "-value",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .default("value"),
  })
  .strict();

const metadataSchema = metadataInputSchema.optional();
const createSchema = z
  .object({
    value: z.string().trim().min(1).max(200),
    metadata: metadataSchema,
    external_id: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
const updateSchema = z
  .object({
    value: z.string().trim().min(1).max(200).optional(),
    metadata: metadataSchema,
    external_id: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

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

const invalid = (message: string, details?: unknown) =>
  json(
    {
      error: "INVALID_REQUEST",
      message,
      ...(details === undefined ? {} : { details }),
    },
    400,
  );

const isAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const failureResponse = (
  result: Exclude<ServerResult<unknown>, { success: true }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_VALUE"
        ? 409
        : 400;
  return json(
    {
      error: result.error ?? "INVALID_REQUEST",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const apiType = (type: ProductTypeAdminDTO) => ({
  id: type.id,
  value: type.value,
  external_id: type.externalId,
  metadata: type.metadata,
  created_at: type.createdAt.toISOString(),
  updated_at: type.updatedAt.toISOString(),
  deleted_at: null,
});

const apiTag = (tag: ProductTagAdminDTO) => ({
  id: tag.id,
  value: tag.value,
  external_id: tag.externalId,
  metadata: tag.metadata,
  created_at: tag.createdAt.toISOString(),
  updated_at: tag.updatedAt.toISOString(),
  deleted_at: null,
});

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

/** Medusa-shaped Admin REST for product types and tags. */
export async function handleAdminProductDictionariesRequest(
  request: Request,
  path: string,
  dependencies: AdminProductDictionariesApiDependencies,
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

  const segments = path.split("/");
  const type = segments[0] === "product-types";
  const root = type ? "product-types" : "product-tags";
  if (
    segments[0] !== root ||
    segments.length > 2 ||
    segments.some((segment) => !segment)
  )
    return error("NOT_FOUND", "Admin API route not found", 404);
  const id = segments[1] ?? null;

  if (request.method === "GET" && id === null) {
    const query = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success)
      return invalid(
        "Invalid taxonomy query",
        query.error.flatten().fieldErrors,
      );
    const order = query.data.order.replace(/^-/, "");
    const resultInput: ListInput = {
      query: query.data.q || undefined,
      sortBy:
        order === "created_at"
          ? "createdAt"
          : order === "updated_at"
            ? "updatedAt"
            : "value",
      sortOrder: query.data.order.startsWith("-") ? "desc" : "asc",
      offset: query.data.offset,
      limit: query.data.limit,
    };
    try {
      if (type) {
        const result = await dependencies.listTypes(resultInput);
        return json({
          product_types: result.types.map(apiType),
          count: result.total,
          offset: query.data.offset,
          limit: query.data.limit,
        });
      }
      const result = await dependencies.listTags(resultInput);
      return json({
        product_tags: result.tags.map(apiTag),
        count: result.total,
        offset: query.data.offset,
        limit: query.data.limit,
      });
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be loaded",
        500,
      );
    }
  }

  if (request.method === "GET" && id !== null) {
    try {
      if (type) {
        const result = await dependencies.findType(id);
        return result
          ? json({ product_type: apiType(result) })
          : error("NOT_FOUND", "Product type not found", 404);
      }
      const result = await dependencies.findTag(id);
      return result
        ? json({ product_tag: apiTag(result) })
        : error("NOT_FOUND", "Product tag not found", 404);
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be loaded",
        500,
      );
    }
  }

  if (request.method === "POST" && id === null) {
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success)
      return invalid(
        "Invalid product taxonomy fields",
        parsed.error.flatten().fieldErrors,
      );
    const input = {
      value: parsed.data.value,
      metadata: parsed.data.metadata as ProductMetadata | undefined,
      externalId: parsed.data.external_id,
    };
    try {
      const result = type
        ? await dependencies.createType(input)
        : await dependencies.createTag(input);
      if (!result.success) return failureResponse(result);
      const saved = type
        ? await dependencies.findType(result.data.id)
        : await dependencies.findTag(result.data.id);
      return type
        ? json({
            product_type: saved
              ? apiType(saved as ProductTypeAdminDTO)
              : { id: result.data.id, value: parsed.data.value },
          })
        : json({
            product_tag: saved
              ? apiTag(saved as ProductTagAdminDTO)
              : { id: result.data.id, value: parsed.data.value },
          });
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be created",
        500,
      );
    }
  }

  if (request.method === "POST" && id !== null) {
    const parsed = updateSchema.safeParse(await readJson(request));
    if (!parsed.success)
      return invalid(
        "Invalid product taxonomy fields",
        parsed.error.flatten().fieldErrors,
      );
    const input = {
      id,
      value: parsed.data.value,
      metadata: parsed.data.metadata as ProductMetadata | undefined,
      externalId: parsed.data.external_id,
    };
    try {
      const result = type
        ? await dependencies.updateType(input)
        : await dependencies.updateTag(input);
      if (!result.success) return failureResponse(result);
      const saved = type
        ? await dependencies.findType(id)
        : await dependencies.findTag(id);
      if (type)
        return saved
          ? json({ product_type: apiType(saved as ProductTypeAdminDTO) })
          : error("NOT_FOUND", "Product type not found", 404);
      return saved
        ? json({ product_tag: apiTag(saved as ProductTagAdminDTO) })
        : error("NOT_FOUND", "Product tag not found", 404);
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be updated",
        500,
      );
    }
  }

  if (request.method === "DELETE" && id !== null) {
    try {
      const result = type
        ? await dependencies.deleteType(id, access.userId)
        : await dependencies.deleteTag(id, access.userId);
      if (!result.success) return failureResponse(result);
      return json({
        id,
        object: type ? "product-type" : "product-tag",
        deleted: true,
      });
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be deleted",
        500,
      );
    }
  }

  return error("NOT_FOUND", "Admin API route not found", 404);
}
