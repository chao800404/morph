import { parseInput } from "@/lib/db/server-result";
import {
  referenceDataDal,
  REFERENCE_DATA_KINDS,
} from "@/lib/commerce/reference-data";
import { referenceDataWriteService } from "@/lib/commerce/reference-data-write.service";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

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
  externalId: z.string().trim().max(200).nullable().optional(),
});
const deleteSchema = z.object({
  kind: kindSchema,
  ids: z.array(z.uuid()).min(1).max(100),
});

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
  .validator((data: unknown) =>
    parseInput(
      writeSchema.extend({ name: z.string().trim().min(1).max(120) }),
      data,
    ),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return await referenceDataWriteService.create(data);
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
  .validator((data: unknown) =>
    parseInput(writeSchema.extend({ id: z.uuid() }), data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return await referenceDataWriteService.update(data);
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
      return await referenceDataWriteService.deleteMany(data);
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
