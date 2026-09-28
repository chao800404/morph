import type {
  ProductCategoryDetailDTO,
  ProductCategoryListItemDTO,
} from "@/lib/product/dto/product-taxonomy.dto";
import type { ProductCollectionDTO } from "@/lib/product/dto/product-collection.dto";
import type { ServerResult } from "@/lib/db/server-result";
import type { ProductMetadata } from "@/db/product.schema";
import type { AdminApiAccess } from "./orders";
import { metadataInputSchema } from "@/lib/validations/product";
import { z } from "zod";

type ListInput = {
  query?: string;
  sortBy: "name" | "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  offset: number;
};

export type AdminProductTaxonomyApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listCategories(input: ListInput): Promise<{
    categories: ProductCategoryListItemDTO[];
    total: number;
  }>;
  findCategory(id: string): Promise<ProductCategoryDetailDTO | null>;
  createCategory(input: {
    name: string;
    handle?: string;
    description?: string;
    parentCategoryId?: string | null;
    isActive?: boolean;
    isInternal?: boolean;
    metadata?: ProductMetadata;
  }): Promise<ServerResult<{ id: string; handle: string }>>;
  updateCategory(input: {
    id: string;
    name?: string;
    handle?: string;
    description?: string;
    isActive?: boolean;
    isInternal?: boolean;
    metadata?: ProductMetadata;
  }): Promise<ServerResult<{ id: string }>>;
  deleteCategories(ids: string[]): Promise<ServerResult<{ deleted: number }>>;
  manageCategoryProducts(input: {
    categoryId: string;
    add: string[];
    remove: string[];
    actorId: string;
  }): Promise<ServerResult<{ id: string }>>;
  listCollections(input: ListInput): Promise<{
    collections: ProductCollectionDTO[];
    total: number;
  }>;
  findCollection(id: string): Promise<ProductCollectionDTO | null>;
  createCollection(input: {
    title: string;
    handle?: string;
    description?: string | null;
    metadata?: ProductMetadata;
    actorId: string;
  }): Promise<ServerResult<{ id: string; handle: string }>>;
  updateCollection(input: {
    id: string;
    title?: string;
    handle?: string;
    description?: string | null;
    metadata?: ProductMetadata;
    actorId: string;
  }): Promise<ServerResult<{ id: string }>>;
  deleteCollections(
    ids: string[],
    actorId: string,
  ): Promise<ServerResult<{ deleted: number }>>;
  manageCollectionProducts(input: {
    collectionId: string;
    add: string[];
    remove: string[];
    actorId: string;
  }): Promise<ServerResult<{ id: string }>>;
};

const querySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "name",
        "-name",
        "title",
        "-title",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .optional(),
  })
  .strict();

const metadataSchema = metadataInputSchema.optional();
const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    handle: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    parent_category_id: z.uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    is_internal: z.boolean().optional(),
    metadata: metadataSchema,
  })
  .strict();
const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    handle: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    is_active: z.boolean().optional(),
    is_internal: z.boolean().optional(),
    metadata: metadataSchema,
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
const collectionCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    handle: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema,
  })
  .strict();
const collectionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    handle: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema,
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
const productMembershipSchema = z
  .object({
    add: z.array(z.uuid()).max(100).optional().default([]),
    remove: z.array(z.uuid()).max(100).optional().default([]),
  })
  .strict()
  .refine((value) => value.add.length + value.remove.length > 0);

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

const apiCategory = (
  category: ProductCategoryListItemDTO | ProductCategoryDetailDTO,
) => ({
  id: category.id,
  name: category.name,
  description: category.description,
  handle: category.handle,
  rank: category.rank,
  parent_category_id: category.parentCategoryId,
  parent_category:
    category.parentCategoryId && category.ancestorNames.length > 0
      ? {
          id: category.parentCategoryId,
          name: category.ancestorNames[category.ancestorNames.length - 1],
        }
      : null,
  category_children:
    "children" in category
      ? category.children.map((child) => ({
          id: child.id,
          name: child.name,
        }))
      : [],
  ancestor_names: category.ancestorNames,
  is_active: category.isActive,
  is_internal: category.isInternal,
  metadata: category.metadata,
  created_at: category.createdAt.toISOString(),
  updated_at: category.updatedAt.toISOString(),
  deleted_at: null,
});

const apiCollection = (collection: ProductCollectionDTO) => ({
  id: collection.id,
  title: collection.title,
  handle: collection.handle,
  description: collection.description,
  external_id: collection.externalId,
  metadata: collection.metadata,
  created_at: collection.createdAt.toISOString(),
  updated_at: collection.updatedAt.toISOString(),
  deleted_at: null,
});

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

const invalid = (message: string, details?: unknown) =>
  json(
    {
      error: "INVALID_REQUEST",
      message,
      ...(details === undefined ? {} : { details }),
    },
    400,
  );

const queryInput = (request: Request, category: boolean) => {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) return parsed;
  const rawOrder = parsed.data.order;
  const order = rawOrder?.replace(/^-/, "");
  const defaultOrder = category ? "name" : "createdAt";
  const defaultDirection = category ? "asc" : "desc";
  const sortBy = category
    ? order === "name"
      ? "name"
      : order === "updated_at"
        ? "updatedAt"
        : order === "created_at"
          ? "createdAt"
          : defaultOrder
    : order === "title"
      ? "title"
      : order === "updated_at"
        ? "updatedAt"
        : order === "created_at"
          ? "createdAt"
          : defaultOrder;
  return {
    success: true as const,
    data: {
      ...(parsed.data.q ? { query: parsed.data.q } : {}),
      sortBy: sortBy as ListInput["sortBy"],
      sortOrder: (rawOrder
        ? rawOrder.startsWith("-")
          ? "desc"
          : "asc"
        : defaultDirection) as ListInput["sortOrder"],
      page: Math.floor(parsed.data.offset / parsed.data.limit) + 1,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    },
  };
};

const failureResponse = (
  result: Exclude<ServerResult<unknown>, { success: true }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_HANDLE"
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

/** Medusa-shaped Admin REST for product categories and collections. */
export async function handleAdminProductTaxonomyRequest(
  request: Request,
  path: string,
  dependencies: AdminProductTaxonomyApiDependencies,
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
  const collection = segments[0] === "collections";
  const root = collection ? "collections" : "product-categories";
  if (
    segments[0] !== root ||
    segments.length > 3 ||
    segments.some((segment) => !segment)
  )
    return error("NOT_FOUND", "Admin API route not found", 404);
  const id = segments[1] ?? null;
  const subresource = segments[2] ?? null;
  if (
    subresource !== null &&
    (id === null || subresource !== "products" || request.method !== "POST")
  )
    return error("NOT_FOUND", "Admin API route not found", 404);

  if (id === null && request.method === "GET") {
    const parsed = queryInput(request, !collection);
    if (!parsed.success)
      return invalid(
        "Invalid taxonomy query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      if (collection) {
        const result = await dependencies.listCollections(parsed.data);
        return json({
          collections: result.collections.map(apiCollection),
          count: result.total,
          offset: parsed.data.offset,
          limit: parsed.data.limit,
        });
      }
      const result = await dependencies.listCategories(parsed.data);
      return json({
        product_categories: result.categories.map(apiCategory),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be loaded",
        500,
      );
    }
  }

  if (id !== null && request.method === "GET") {
    try {
      if (collection) {
        const result = await dependencies.findCollection(id);
        return result
          ? json({ collection: apiCollection(result) })
          : error("NOT_FOUND", "Collection not found", 404);
      }
      const result = await dependencies.findCategory(id);
      return result
        ? json({ product_category: apiCategory(result) })
        : error("NOT_FOUND", "Product category not found", 404);
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product taxonomy could not be loaded",
        500,
      );
    }
  }

  if (id !== null && subresource === "products" && request.method === "POST") {
    const parsed = productMembershipSchema.safeParse(await readJson(request));
    if (!parsed.success)
      return invalid(
        "Invalid product membership fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = collection
        ? await dependencies.manageCollectionProducts({
            collectionId: id,
            add: parsed.data.add,
            remove: parsed.data.remove,
            actorId: access.userId,
          })
        : await dependencies.manageCategoryProducts({
            categoryId: id,
            add: parsed.data.add,
            remove: parsed.data.remove,
            actorId: access.userId,
          });
      if (!result.success) return failureResponse(result);
      if (collection) {
        const saved = await dependencies.findCollection(id);
        return saved
          ? json({ collection: apiCollection(saved) })
          : error("NOT_FOUND", "Collection not found", 404);
      }
      const saved = await dependencies.findCategory(id);
      return saved
        ? json({ product_category: apiCategory(saved) })
        : error("NOT_FOUND", "Product category not found", 404);
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product memberships could not be updated",
        500,
      );
    }
  }

  if (id === null && request.method === "POST") {
    const raw = await readJson(request);
    if (collection) {
      const parsed = collectionCreateSchema.safeParse(raw);
      if (!parsed.success)
        return invalid(
          "Invalid collection fields",
          parsed.error.flatten().fieldErrors,
        );
      try {
        const result = await dependencies.createCollection({
          ...parsed.data,
          metadata: parsed.data.metadata as ProductMetadata | undefined,
          actorId: access.userId,
        });
        if (!result.success) return failureResponse(result);
        const saved = await dependencies.findCollection(result.data.id);
        return json(
          {
            collection: saved
              ? apiCollection(saved)
              : { id: result.data.id, handle: result.data.handle },
          },
          201,
        );
      } catch {
        return error("INTERNAL_ERROR", "Collection could not be created", 500);
      }
    }

    const parsed = categoryCreateSchema.safeParse(raw);
    if (!parsed.success)
      return invalid(
        "Invalid product category fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.createCategory({
        name: parsed.data.name,
        handle: parsed.data.handle,
        description: parsed.data.description,
        parentCategoryId: parsed.data.parent_category_id,
        isActive: parsed.data.is_active,
        isInternal: parsed.data.is_internal,
        metadata: parsed.data.metadata as ProductMetadata | undefined,
      });
      if (!result.success) return failureResponse(result);
      const saved = await dependencies.findCategory(result.data.id);
      return json(
        {
          product_category: saved
            ? apiCategory(saved)
            : { id: result.data.id, handle: result.data.handle },
        },
        201,
      );
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product category could not be created",
        500,
      );
    }
  }

  if (id !== null && request.method === "POST") {
    const raw = await readJson(request);
    if (collection) {
      const parsed = collectionUpdateSchema.safeParse(raw);
      if (!parsed.success)
        return invalid(
          "Invalid collection fields",
          parsed.error.flatten().fieldErrors,
        );
      try {
        const result = await dependencies.updateCollection({
          ...parsed.data,
          id,
          metadata: parsed.data.metadata as ProductMetadata | undefined,
          actorId: access.userId,
        });
        if (!result.success) return failureResponse(result);
        const saved = await dependencies.findCollection(result.data.id);
        return json({
          collection: saved ? apiCollection(saved) : { id: result.data.id },
        });
      } catch {
        return error("INTERNAL_ERROR", "Collection could not be updated", 500);
      }
    }

    const parsed = categoryUpdateSchema.safeParse(raw);
    if (!parsed.success)
      return invalid(
        "Invalid product category fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.updateCategory({
        id,
        name: parsed.data.name,
        handle: parsed.data.handle,
        description: parsed.data.description,
        isActive: parsed.data.is_active,
        isInternal: parsed.data.is_internal,
        metadata: parsed.data.metadata as ProductMetadata | undefined,
      });
      if (!result.success) return failureResponse(result);
      const saved = await dependencies.findCategory(result.data.id);
      return json({
        product_category: saved ? apiCategory(saved) : { id: result.data.id },
      });
    } catch {
      return error(
        "INTERNAL_ERROR",
        "Product category could not be updated",
        500,
      );
    }
  }

  if (id !== null && request.method === "DELETE") {
    try {
      const result = collection
        ? await dependencies.deleteCollections([id], access.userId)
        : await dependencies.deleteCategories([id]);
      if (!result.success) return failureResponse(result);
      return json({
        id,
        object: collection ? "product-collection" : "product-category",
        deleted: true,
      });
    } catch {
      return error(
        "INTERNAL_ERROR",
        collection
          ? "Collection could not be deleted"
          : "Product category could not be deleted",
        500,
      );
    }
  }

  return error("NOT_FOUND", "Admin API route not found", 404);
}
