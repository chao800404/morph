import { getDb } from "@/db";
import { shippingOptionTypes, shippingOptions } from "@/db/fulfillment.schema";
import { likeContains } from "@/lib/db/like-query";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ShippingOptionTypeDTO } from "../dto/shipping-option-type.dto";
import type { ShippingOptionTypeListParams } from "@/lib/validations/shipping-option-type";
import { batchGuard } from "@/lib/db/batch-guard";

const toDto = (
  row: typeof shippingOptionTypes.$inferSelect,
  shippingOptionCount: number,
): ShippingOptionTypeDTO => ({
  id: row.id,
  label: row.label,
  code: row.code,
  description: row.description,
  shippingOptionCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const shippingOptionTypeDal = {
  async listPage(params: ShippingOptionTypeListParams): Promise<{
    types: ShippingOptionTypeDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(shippingOptionTypes.deletedAt)];
    if (params.query?.trim()) {
      const query = params.query.trim();
      conditions.push(
        or(
          likeContains(shippingOptionTypes.label, query),
          likeContains(shippingOptionTypes.code, query),
        )!,
      );
    }
    const where = and(...conditions);
    const sortColumn = {
      label: shippingOptionTypes.label,
      code: shippingOptionTypes.code,
      createdAt: shippingOptionTypes.createdAt,
      updatedAt: shippingOptionTypes.updatedAt,
    }[params.sortBy];
    const direction = params.sortOrder === "asc" ? asc : desc;
    const [totalRows, rows] = await Promise.all([
      db.select({ total: count() }).from(shippingOptionTypes).where(where),
      db
        .select()
        .from(shippingOptionTypes)
        .where(where)
        .orderBy(direction(sortColumn), asc(shippingOptionTypes.id))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
    ]);
    const ids = rows.map((row) => row.id);
    const optionCounts = ids.length
      ? await db
          .select({
            typeId: shippingOptions.shippingOptionTypeId,
            total: count(),
          })
          .from(shippingOptions)
          .where(
            and(
              inArray(shippingOptions.shippingOptionTypeId, ids),
              isNull(shippingOptions.deletedAt),
            ),
          )
          .groupBy(shippingOptions.shippingOptionTypeId)
      : [];
    const counts = new Map(
      optionCounts.map((row) => [row.typeId, Number(row.total)]),
    );
    return {
      types: rows.map((row) => toDto(row, counts.get(row.id) ?? 0)),
      total: Number(totalRows[0]?.total ?? 0),
    };
  },

  async listActiveChoices(): Promise<
    Array<Pick<ShippingOptionTypeDTO, "id" | "label" | "code" | "description">>
  > {
    const db = await getDb();
    return db
      .select({
        id: shippingOptionTypes.id,
        label: shippingOptionTypes.label,
        code: shippingOptionTypes.code,
        description: shippingOptionTypes.description,
      })
      .from(shippingOptionTypes)
      .where(isNull(shippingOptionTypes.deletedAt))
      .orderBy(asc(shippingOptionTypes.label), asc(shippingOptionTypes.id));
  },

  async findById(id: string): Promise<ShippingOptionTypeDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(shippingOptionTypes)
      .where(
        and(
          eq(shippingOptionTypes.id, id),
          isNull(shippingOptionTypes.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const [countRow] = await db
      .select({ total: count() })
      .from(shippingOptions)
      .where(
        and(
          eq(shippingOptions.shippingOptionTypeId, id),
          isNull(shippingOptions.deletedAt),
        ),
      );
    return toDto(row, Number(countRow?.total ?? 0));
  },

  async findByCode(code: string): Promise<{ id: string } | null> {
    const db = await getDb();
    const [row] = await db
      .select({ id: shippingOptionTypes.id })
      .from(shippingOptionTypes)
      .where(
        and(
          eq(shippingOptionTypes.code, code),
          isNull(shippingOptionTypes.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async create(input: {
    id: string;
    label: string;
    code: string;
    description?: string | null;
    now: string;
  }): Promise<void> {
    const db = await getDb();
    await db.insert(shippingOptionTypes).values({
      id: input.id,
      label: input.label,
      code: input.code,
      description: input.description ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  },

  async update(input: {
    id: string;
    expectedUpdatedAt: string;
    label?: string;
    code?: string;
    description?: string | null;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const updated = await db
      .update(shippingOptionTypes)
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(shippingOptionTypes.id, input.id),
          eq(shippingOptionTypes.updatedAt, input.expectedUpdatedAt),
          isNull(shippingOptionTypes.deletedAt),
        ),
      )
      .returning({ id: shippingOptionTypes.id });
    return updated.length > 0;
  },

  async softDelete(input: {
    id: string;
    expectedUpdatedAt: string;
    now: string;
  }): Promise<"deleted" | "not-found" | "conflict"> {
    const db = await getDb();
    const [current] = await db
      .select({ updatedAt: shippingOptionTypes.updatedAt })
      .from(shippingOptionTypes)
      .where(
        and(
          eq(shippingOptionTypes.id, input.id),
          isNull(shippingOptionTypes.deletedAt),
        ),
      )
      .limit(1);
    if (!current) return "not-found";
    if (current.updatedAt !== input.expectedUpdatedAt) return "conflict";

    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM shipping_option_types
          WHERE id = ${input.id}
            AND updated_at = ${input.expectedUpdatedAt}
            AND deleted_at IS NULL
        )`,
      ),
      db
        .update(shippingOptions)
        .set({ shippingOptionTypeId: null, updatedAt: input.now })
        .where(
          and(
            eq(shippingOptions.shippingOptionTypeId, input.id),
            isNull(shippingOptions.deletedAt),
          ),
        ),
      db
        .update(shippingOptionTypes)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(shippingOptionTypes.id, input.id),
            eq(shippingOptionTypes.updatedAt, input.expectedUpdatedAt),
            isNull(shippingOptionTypes.deletedAt),
          ),
        ),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return "deleted";
  },
};
