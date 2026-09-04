import { parseInput } from "@/lib/db/server-result";
import {
  referenceDataDal,
  REFERENCE_DATA_KINDS,
} from "@/lib/commerce/reference-data";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import pLimit from "p-limit";

const kindSchema = z.enum(REFERENCE_DATA_KINDS);
const listSchema = z.object({
  kind: kindSchema,
  query: z.string().trim().max(100).optional(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]),
  sortOrder: z.enum(["asc", "desc"]),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});
const idSchema = z.object({ kind: kindSchema, id: z.uuid() });
const writeSchema = z.object({
  kind: kindSchema,
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  parentId: z.uuid().optional().nullable(),
  metadata: z.record(z.string(), z.string()).optional(),
});
const deleteSchema = z.object({
  kind: kindSchema,
  ids: z.array(z.uuid()).min(1).max(100),
});

const findDuplicate = async (data: {
  kind: z.infer<typeof kindSchema>;
  id?: string;
  name?: string;
  code?: string | null;
}) => {
  const key =
    data.kind === "product-types" || data.kind === "product-tags"
      ? data.name
      : data.code;
  if (!key) return null;
  const result = await referenceDataDal.list({
    kind: data.kind,
    query: key,
    sortBy: "name",
    sortOrder: "asc",
    page: 1,
    limit: 100,
  });
  return (
    result.items.find(
      (item) =>
        item.id !== data.id &&
        (data.kind === "product-types" || data.kind === "product-tags"
          ? item.name === key
          : item.code === key),
    ) ?? null
  );
};

export const listReferenceData = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return {
        success: true as const,
        message: "Reference data fetched",
        data: await referenceDataDal.list(data),
      };
    } catch (error) {
      console.error("List reference data error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch reference data",
        data: null,
        error: "LIST_FAILED",
      };
    }
  });

export const getReferenceData = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(idSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const item = await referenceDataDal.find(data.kind, data.id);
      return item
        ? {
            success: true as const,
            message: "Reference data fetched",
            data: item,
          }
        : {
            success: false as const,
            message: "Record not found",
            data: null,
            error: "NOT_FOUND",
          };
    } catch (error) {
      console.error("Get reference data error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch reference data",
        data: null,
        error: "GET_FAILED",
      };
    }
  });

export const createReferenceData = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(writeSchema.extend({ name: z.string().trim().min(1).max(120) }), data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      if (
        (data.kind === "return-reasons" || data.kind === "refund-reasons") &&
        !data.code
      )
        return {
          success: false as const,
          message: "Code is required",
          data: null,
          errors: { code: ["Code is required"] },
        };
      if (data.kind === "return-reasons" && data.parentId) {
        const parent = await referenceDataDal.find(data.kind, data.parentId);
        if (!parent || parent.parentId) {
          return {
            success: false as const,
            message: "Return reasons support one child level only",
            data: null,
            errors: { parentId: ["Choose a top-level return reason"] },
          };
        }
      }
      if (await findDuplicate(data)) {
        const field =
          data.kind === "product-types" || data.kind === "product-tags"
            ? "name"
            : "code";
        return {
          success: false as const,
          message: "A record with this value already exists",
          data: null,
          errors: { [field]: ["This value is already in use"] },
        };
      }
      const id = await referenceDataDal.create(data.kind, data);
      return {
        success: true as const,
        message: `${data.name} created`,
        data: { id },
      };
    } catch (error) {
      console.error("Create reference data error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to create record",
        data: null,
        error: "CREATE_FAILED",
      };
    }
  });

export const updateReferenceData = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(writeSchema.extend({ id: z.uuid() }), data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const existing = await referenceDataDal.find(data.kind, data.id);
      if (!existing)
        return {
          success: false as const,
          message: "Record not found",
          data: null,
          error: "NOT_FOUND",
        };
      if (data.parentId === data.id)
        return {
          success: false as const,
          message: "A return reason cannot be its own parent",
          data: null,
          errors: { parentId: ["Choose a different parent"] },
        };
      if (data.kind === "return-reasons" && data.parentId) {
        const parent = await referenceDataDal.find(data.kind, data.parentId);
        if (!parent || parent.parentId) {
          return {
            success: false as const,
            message: "Return reasons support one child level only",
            data: null,
            errors: { parentId: ["Choose a top-level return reason"] },
          };
        }
      }
      if (await findDuplicate(data)) {
        const field =
          data.kind === "product-types" || data.kind === "product-tags"
            ? "name"
            : "code";
        return {
          success: false as const,
          message: "A record with this value already exists",
          data: null,
          errors: { [field]: ["This value is already in use"] },
        };
      }
      await referenceDataDal.update(data.kind, data.id, data);
      return {
        success: true as const,
        message: "Record updated",
        data: { id: data.id },
      };
    } catch (error) {
      console.error("Update reference data error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to update record",
        data: null,
        error: "UPDATE_FAILED",
      };
    }
  });

export const deleteReferenceData = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const lookup = pLimit(DB_FANOUT_CONCURRENCY);
      const records = await Promise.all(
        data.ids.map((id) =>
          lookup(() => referenceDataDal.find(data.kind, id)),
        ),
      );
      const existing = records.filter((item) => item !== null);
      if (!existing.length)
        return {
          success: false as const,
          message: "No matching records were found",
          data: null,
          error: "NOT_FOUND",
        };
      const used = existing.find((item) => item.usageCount > 0);
      if (used)
        return {
          success: false as const,
          message: `“${used.name}” is still in use and cannot be deleted`,
          data: null,
          error: "IN_USE",
        };
      if (data.kind === "return-reasons") {
        const all = await referenceDataDal.list({
          kind: data.kind,
          page: 1,
          limit: 100,
          sortBy: "name",
          sortOrder: "asc",
        });
        if (
          all.items.some(
            (item) => item.parentId && data.ids.includes(item.parentId),
          )
        )
          return {
            success: false as const,
            message: "A return reason with child reasons cannot be deleted",
            data: null,
            error: "HAS_CHILDREN",
          };
      }
      await referenceDataDal.softDelete(
        data.kind,
        existing.map((item) => item.id),
      );
      return {
        success: true as const,
        message: `${existing.length} record${existing.length === 1 ? "" : "s"} deleted`,
        data: { deleted: existing.length },
      };
    } catch (error) {
      console.error("Delete reference data error:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to delete records",
        data: null,
        error: "DELETE_FAILED",
      };
    }
  });
