import {
  referenceDataDal,
  type ReferenceDataKind,
  type ReferenceDataItemDTO,
} from "@/lib/commerce/reference-data";
import type { Metadata } from "@/db/json";
import { DB_FANOUT_CONCURRENCY } from "@/lib/db/concurrency";
import { fail, ok, type ServerResult } from "@/lib/db/server-result";
import pLimit from "p-limit";

export type ReferenceDataWriteInput = {
  kind: ReferenceDataKind;
  name: string;
  code?: string | null;
  description?: string | null;
  parentId?: string | null;
  metadata?: Metadata;
  externalId?: string | null;
};

export type ReferenceDataWriteDal = Pick<
  typeof referenceDataDal,
  | "list"
  | "find"
  | "duplicateExists"
  | "create"
  | "update"
  | "softDelete"
  | "hasChildren"
>;

const keyFor = (
  input: Pick<ReferenceDataWriteInput, "kind" | "code"> & { name?: string },
) =>
  input.kind === "product-types" || input.kind === "product-tags"
    ? input.name
    : input.code;

const uniqueField = (kind: ReferenceDataKind) =>
  kind === "product-types" || kind === "product-tags" ? "name" : "code";

const duplicateFailure = (kind: ReferenceDataKind) => {
  const field = uniqueField(kind);
  return fail("A record with this value already exists", {
    error: "DUPLICATE_VALUE",
    errors: { [field]: ["This value is already in use"] },
  });
};

/** Shared validation and guarded writes for Dashboard and Admin REST routes. */
export const createReferenceDataWriteService = (
  overrides: Partial<{ dal: ReferenceDataWriteDal }> = {},
) => {
  const dal = overrides.dal ?? referenceDataDal;

  return {
    async create(
      input: ReferenceDataWriteInput,
    ): Promise<ServerResult<{ id: string }>> {
      if (
        (input.kind === "return-reasons" || input.kind === "refund-reasons") &&
        !input.code
      )
        return fail("Code is required", {
          error: "INVALID_INPUT",
          errors: { code: ["Code is required"] },
        });
      if (input.kind === "return-reasons" && input.parentId) {
        const parent = await dal.find(input.kind, input.parentId);
        if (!parent || parent.parentId)
          return fail("Return reasons support one child level only", {
            error: "INVALID_PARENT",
            errors: { parentId: ["Choose a top-level return reason"] },
          });
      }

      const uniqueValue = keyFor(input);
      if (uniqueValue && (await dal.duplicateExists(input.kind, uniqueValue)))
        return duplicateFailure(input.kind);

      try {
        const id = await dal.create(input.kind, input);
        return ok(`${input.name} created`, { id });
      } catch (error) {
        if (uniqueValue && (await dal.duplicateExists(input.kind, uniqueValue)))
          return duplicateFailure(input.kind);
        throw error;
      }
    },

    async update(
      input: Omit<ReferenceDataWriteInput, "name"> & {
        id: string;
        name?: string;
      },
    ): Promise<ServerResult<{ id: string }>> {
      const existing = await dal.find(input.kind, input.id);
      if (!existing) return fail("Record not found", { error: "NOT_FOUND" });
      if (input.kind === "return-reasons" && input.parentId === input.id)
        return fail("A return reason cannot be its own parent", {
          error: "INVALID_PARENT",
          errors: { parentId: ["Choose a different parent"] },
        });
      if (input.kind === "return-reasons" && input.parentId) {
        const parent = await dal.find(input.kind, input.parentId);
        if (!parent || parent.parentId)
          return fail("Return reasons support one child level only", {
            error: "INVALID_PARENT",
            errors: { parentId: ["Choose a top-level return reason"] },
          });
      }
      if (
        (input.kind === "return-reasons" || input.kind === "refund-reasons") &&
        input.code === null
      )
        return fail("Code is required", {
          error: "INVALID_INPUT",
          errors: { code: ["Code is required"] },
        });

      const uniqueValue = keyFor(input);
      if (
        uniqueValue &&
        (await dal.duplicateExists(input.kind, uniqueValue, input.id))
      )
        return duplicateFailure(input.kind);
      try {
        await dal.update(input.kind, input.id, input);
      } catch (error) {
        if (
          uniqueValue &&
          (await dal.duplicateExists(input.kind, uniqueValue, input.id))
        )
          return duplicateFailure(input.kind);
        throw error;
      }
      return ok("Record updated", { id: input.id });
    },

    async deleteMany(input: {
      kind: ReferenceDataKind;
      ids: string[];
    }): Promise<ServerResult<{ deleted: number }>> {
      const lookup = pLimit(DB_FANOUT_CONCURRENCY);
      const records = await Promise.all(
        input.ids.map((id) =>
          lookup(
            () =>
              dal.find(input.kind, id) as Promise<ReferenceDataItemDTO | null>,
          ),
        ),
      );
      const existing: ReferenceDataItemDTO[] = records.filter(
        (record): record is ReferenceDataItemDTO => record !== null,
      );
      if (!existing.length)
        return fail("No matching records were found", { error: "NOT_FOUND" });
      const inUse = existing.find((record) => record.usageCount > 0);
      if (inUse)
        return fail(`“${inUse.name}” is still in use and cannot be deleted`, {
          error: "IN_USE",
        });
      if (
        input.kind === "return-reasons" &&
        (await dal.hasChildren(existing.map((record) => record.id)))
      )
        return fail("A return reason with child reasons cannot be deleted", {
          error: "HAS_CHILDREN",
        });

      await dal.softDelete(
        input.kind,
        existing.map((record) => record.id),
      );
      return ok(
        `${existing.length} record${existing.length === 1 ? "" : "s"} deleted`,
        { deleted: existing.length },
      );
    },
  };
};

export const referenceDataWriteService = createReferenceDataWriteService();
