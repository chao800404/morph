import type {
  ReferenceDataItemDTO,
  ReferenceDataKind,
  ReferenceDataListParams,
} from "@/lib/commerce/reference-data";
import type { ReferenceDataWriteInput } from "@/lib/commerce/reference-data-write.service";
import type { ServerResult } from "@/lib/db/server-result";
import type { Metadata } from "@/db/json";
import { z } from "zod";
import type { AdminApiAccess } from "./orders";

const routeKinds = [
  "product-types",
  "product-tags",
  "return-reasons",
  "refund-reasons",
] as const satisfies readonly ReferenceDataKind[];

type CreateInput = ReferenceDataWriteInput;
type UpdateInput = Omit<ReferenceDataWriteInput, "name"> & {
  id: string;
  name?: string;
};

export type AdminReferenceDataApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  list(input: ReferenceDataListParams): Promise<{
    items: ReferenceDataItemDTO[];
    pagination: { total: number };
  }>;
  find(
    kind: ReferenceDataKind,
    id: string,
  ): Promise<ReferenceDataItemDTO | null>;
  create(input: CreateInput): Promise<ServerResult<{ id: string }>>;
  update(input: UpdateInput): Promise<ServerResult<{ id: string }>>;
  deleteMany(input: {
    kind: ReferenceDataKind;
    ids: string[];
  }): Promise<ServerResult<{ deleted: number }>>;
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
        "value",
        "-value",
        "label",
        "-label",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .default("-created_at"),
  })
  .strict();

const metadataSchema = z.record(z.string(), z.string()).optional();
const typeBodySchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    external_id: z.string().trim().max(200).nullable().optional(),
    metadata: metadataSchema,
  })
  .strict();
const returnReasonBodySchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    parent_return_reason_id: z.uuid().nullable().optional(),
    metadata: metadataSchema,
  })
  .strict();
const refundReasonBodySchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    metadata: metadataSchema,
  })
  .strict();

const updateTypeBodySchema = z
  .object({
    value: z.string().trim().min(1).max(120).optional(),
    external_id: z.string().trim().max(200).nullable().optional(),
    metadata: metadataSchema,
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined));
const updateReturnReasonBodySchema = z
  .object({
    value: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    parent_return_reason_id: z.uuid().nullable().optional(),
    metadata: metadataSchema,
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined));
const updateRefundReasonBodySchema = z
  .object({
    code: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    metadata: metadataSchema,
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

const validationError = (message: string, details: unknown) =>
  json({ error: "INVALID_REQUEST", message, details }, 400);

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

const apiRecord = (kind: ReferenceDataKind, item: ReferenceDataItemDTO) => {
  const timestamps = {
    id: item.id,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: null,
    metadata: item.metadata,
  };
  if (kind === "product-types" || kind === "product-tags")
    return {
      ...timestamps,
      value: item.name,
      external_id: item.externalId ?? null,
    };
  if (kind === "return-reasons")
    return {
      ...timestamps,
      value: item.code,
      label: item.name,
      description: item.description,
      parent_return_reason_id: item.parentId,
    };
  return {
    ...timestamps,
    code: item.code,
    label: item.name,
    description: item.description,
  };
};

const listField = (kind: ReferenceDataKind) =>
  kind === "product-types"
    ? "product_types"
    : kind === "product-tags"
      ? "product_tags"
      : kind === "return-reasons"
        ? "return_reasons"
        : "refund_reasons";

const detailField = (kind: ReferenceDataKind) =>
  kind === "product-types"
    ? "product_type"
    : kind === "product-tags"
      ? "product_tag"
      : kind === "return-reasons"
        ? "return_reason"
        : "refund_reason";

const objectType = (kind: ReferenceDataKind) =>
  kind === "product-types"
    ? "product_type"
    : kind === "product-tags"
      ? "product_tag"
      : kind === "return-reasons"
        ? "return_reason"
        : "refund_reason";

const parseCreateBody = (kind: ReferenceDataKind, raw: unknown) => {
  if (kind === "product-types" || kind === "product-tags") {
    const parsed = typeBodySchema.safeParse(raw);
    return parsed.success
      ? {
          success: true as const,
          data: {
            kind,
            name: parsed.data.value,
            externalId: parsed.data.external_id,
            metadata: parsed.data.metadata as Metadata | undefined,
          },
        }
      : { success: false as const, error: parsed.error.flatten().fieldErrors };
  }
  if (kind === "return-reasons") {
    const parsed = returnReasonBodySchema.safeParse(raw);
    return parsed.success
      ? {
          success: true as const,
          data: {
            kind,
            name: parsed.data.label,
            code: parsed.data.value,
            description: parsed.data.description,
            parentId: parsed.data.parent_return_reason_id,
            metadata: parsed.data.metadata as Metadata | undefined,
          },
        }
      : { success: false as const, error: parsed.error.flatten().fieldErrors };
  }
  const parsed = refundReasonBodySchema.safeParse(raw);
  return parsed.success
    ? {
        success: true as const,
        data: {
          kind,
          name: parsed.data.label,
          code: parsed.data.code,
          description: parsed.data.description,
          metadata: parsed.data.metadata as Metadata | undefined,
        },
      }
    : { success: false as const, error: parsed.error.flatten().fieldErrors };
};

const parseUpdateBody = (kind: ReferenceDataKind, id: string, raw: unknown) => {
  if (kind === "product-types" || kind === "product-tags") {
    const parsed = updateTypeBodySchema.safeParse(raw);
    return parsed.success
      ? {
          success: true as const,
          data: {
            kind,
            id,
            ...(parsed.data.value !== undefined
              ? { name: parsed.data.value }
              : {}),
            ...(parsed.data.external_id !== undefined
              ? { externalId: parsed.data.external_id }
              : {}),
            ...(parsed.data.metadata !== undefined
              ? { metadata: parsed.data.metadata as Metadata }
              : {}),
          },
        }
      : { success: false as const, error: parsed.error.flatten().fieldErrors };
  }
  if (kind === "return-reasons") {
    const parsed = updateReturnReasonBodySchema.safeParse(raw);
    return parsed.success
      ? {
          success: true as const,
          data: {
            kind,
            id,
            ...(parsed.data.label !== undefined
              ? { name: parsed.data.label }
              : {}),
            ...(parsed.data.value !== undefined
              ? { code: parsed.data.value }
              : {}),
            ...(parsed.data.description !== undefined
              ? { description: parsed.data.description }
              : {}),
            ...(parsed.data.parent_return_reason_id !== undefined
              ? { parentId: parsed.data.parent_return_reason_id }
              : {}),
            ...(parsed.data.metadata !== undefined
              ? { metadata: parsed.data.metadata as Metadata }
              : {}),
          },
        }
      : { success: false as const, error: parsed.error.flatten().fieldErrors };
  }
  const parsed = updateRefundReasonBodySchema.safeParse(raw);
  return parsed.success
    ? {
        success: true as const,
        data: {
          kind,
          id,
          ...(parsed.data.label !== undefined
            ? { name: parsed.data.label }
            : {}),
          ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
          ...(parsed.data.metadata !== undefined
            ? { metadata: parsed.data.metadata as Metadata }
            : {}),
        },
      }
    : { success: false as const, error: parsed.error.flatten().fieldErrors };
};

const writeFailure = (result: {
  error?: string;
  message: string;
  errors?: unknown;
}) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "INVALID_INPUT" || result.error === "INVALID_PARENT"
        ? 400
        : result.error === "DUPLICATE_VALUE" ||
            result.error === "IN_USE" ||
            result.error === "HAS_CHILDREN"
          ? 409
          : 500;
  return json(
    {
      error: result.error ?? "INTERNAL_ERROR",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const readItem = async (
  kind: ReferenceDataKind,
  id: string,
  dependencies: AdminReferenceDataApiDependencies,
) => {
  const item = await dependencies.find(kind, id);
  return item
    ? json({ [detailField(kind)]: apiRecord(kind, item) })
    : error("NOT_FOUND", "Record not found", 404);
};

/** Medusa-shaped Admin REST APIs for product types, tags and reason lists. */
export async function handleAdminReferenceDataRequest(
  request: Request,
  path: string,
  dependencies: AdminReferenceDataApiDependencies,
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

  const [kindPath, idPath, ...extraPath] = path.split("/");
  if (
    !routeKinds.includes(kindPath as ReferenceDataKind) ||
    extraPath.length > 0
  )
    return error("NOT_FOUND", "Admin API route not found", 404);
  const kind = kindPath as ReferenceDataKind;
  const isCollection = idPath === undefined || idPath === "";
  const parsedId = isCollection ? null : z.uuid().safeParse(idPath);
  if (!isCollection && !parsedId?.success)
    return error("INVALID_REQUEST", "Invalid record ID", 400);
  const id = parsedId?.success ? parsedId.data : "";

  if (isCollection && request.method === "GET") {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return validationError(
        "Invalid reference data query",
        parsed.error.flatten().fieldErrors,
      );
    const order = parsed.data.order;
    try {
      const result = await dependencies.list({
        kind,
        query: parsed.data.q || undefined,
        sortBy: order.includes("created_at")
          ? "createdAt"
          : order.includes("updated_at")
            ? "updatedAt"
            : "name",
        sortOrder: order.startsWith("-") ? "desc" : "asc",
        offset: parsed.data.offset,
        page: Math.floor(parsed.data.offset / parsed.data.limit) + 1,
        limit: parsed.data.limit,
      });
      return json({
        [listField(kind)]: result.items.map((item) => apiRecord(kind, item)),
        count: result.pagination.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return error("INTERNAL_ERROR", "Reference data could not be loaded", 500);
    }
  }

  if (isCollection && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null) return error("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = parseCreateBody(kind, raw);
    if (!parsed.success)
      return validationError("Invalid reference data fields", parsed.error);
    try {
      const result = await dependencies.create(parsed.data);
      if (!result.success) return writeFailure(result);
      const item = await dependencies.find(kind, result.data.id);
      return item
        ? json({ [detailField(kind)]: apiRecord(kind, item) }, 201)
        : error("INTERNAL_ERROR", "Created record could not be loaded", 500);
    } catch {
      return error("INTERNAL_ERROR", "Record could not be created", 500);
    }
  }

  if (!isCollection && request.method === "GET") {
    try {
      return await readItem(kind, id, dependencies);
    } catch {
      return error("INTERNAL_ERROR", "Record could not be loaded", 500);
    }
  }

  if (!isCollection && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null) return error("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = parseUpdateBody(kind, id, raw);
    if (!parsed.success)
      return validationError("Invalid reference data fields", parsed.error);
    try {
      const result = await dependencies.update(parsed.data);
      if (!result.success) return writeFailure(result);
      return await readItem(kind, id, dependencies);
    } catch {
      return error("INTERNAL_ERROR", "Record could not be updated", 500);
    }
  }

  if (!isCollection && request.method === "DELETE") {
    try {
      const result = await dependencies.deleteMany({ kind, ids: [id] });
      if (!result.success) return writeFailure(result);
      return json({ id, object: objectType(kind), deleted: true });
    } catch {
      return error("INTERNAL_ERROR", "Record could not be deleted", 500);
    }
  }

  if (isCollection || parsedId) {
    const allow = isCollection ? "GET, POST" : "GET, POST, DELETE";
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

  return error("NOT_FOUND", "Admin API route not found", 404);
}
