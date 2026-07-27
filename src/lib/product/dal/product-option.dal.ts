import { getDb } from "@/db";
import { productOptionValues, productOptions } from "@/db/product.schema";
import {
  getProductOptionCreatedWithinDays,
  type ProductOptionCreatedWithin,
} from "@/lib/product/config/product-option-list";
import { containsPattern } from "@/lib/db/like-pattern";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  SQL,
} from "drizzle-orm";
import type {
  ProductOptionDTO,
  ProductOptionInsertDTO,
  UpdateProductOptionDTO,
} from "../dto/product-option.dto";
import {
  toProductOptionDTO,
  type ProductOptionRow,
  type ProductOptionValueRow,
} from "../mappers/product-option.mapper";
import { chunk, chunkForInsert } from "./d1-batch";

// Column counts drive the insert batch size; see d1-batch.ts.
const OPTION_VALUE_COLUMNS = 8;

/** Load the values for a set of options, then assemble the DTOs. */
const hydrate = async (
  optionRows: ProductOptionRow[],
): Promise<ProductOptionDTO[]> => {
  if (optionRows.length === 0) return [];
  const db = await getDb();
  const valueRows: ProductOptionValueRow[] = [];

  for (const ids of chunk(
    optionRows.map((row) => row.id),
    50,
  )) {
    valueRows.push(
      ...(await db
        .select()
        .from(productOptionValues)
        .where(
          and(
            inArray(productOptionValues.optionId, ids),
            isNull(productOptionValues.deletedAt),
          ),
        )),
    );
  }

  return optionRows.map((row) => toProductOptionDTO(row, valueRows));
};

/**
 * Replace an option's value list.
 *
 * Values are soft-deleted rather than removed: variants reference them through
 * `product_variant_option_values`, so a hard delete would cascade away the link
 * rows and silently detach existing variants from the option they were built
 * with. Values whose text is unchanged keep their id for the same reason.
 */
const replaceValues = async (
  optionId: string,
  values: string[],
): Promise<void> => {
  const db = await getDb();
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(productOptionValues)
    .where(
      and(
        eq(productOptionValues.optionId, optionId),
        isNull(productOptionValues.deletedAt),
      ),
    );
  const existingByValue = new Map(existing.map((row) => [row.value, row]));
  const wanted = new Set(values);

  const toInsert: (typeof productOptionValues.$inferInsert)[] = [];
  const toReorder: { id: string; rank: number }[] = [];

  values.forEach((value, rank) => {
    const match = existingByValue.get(value);
    if (!match) {
      toInsert.push({
        id: crypto.randomUUID(),
        optionId,
        value,
        rank,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    if (match.rank !== rank) toReorder.push({ id: match.id, rank });
  });

  const toRemove = existing
    .filter((row) => !wanted.has(row.value))
    .map((row) => row.id);

  for (const group of chunk(toRemove, 50)) {
    await db
      .update(productOptionValues)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(productOptionValues.id, group));
  }

  for (const group of chunkForInsert(toInsert, OPTION_VALUE_COLUMNS)) {
    await db.insert(productOptionValues).values(group);
  }

  // Ranks differ per row, so they cannot be collapsed into one statement. The
  // list is bounded by the option's value count, which the input schema caps.
  for (const { id, rank } of toReorder) {
    await db
      .update(productOptionValues)
      .set({ rank, updatedAt: now })
      .where(eq(productOptionValues.id, id));
  }
};

export const productOptionDal = {
  async findById(id: string): Promise<ProductOptionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productOptions)
      .where(and(eq(productOptions.id, id), isNull(productOptions.deletedAt)))
      .limit(1);
    const hydrated = await hydrate(rows);
    return hydrated[0] ?? null;
  },

  /** Only global options have unique titles, so exclusive ones are excluded. */
  async findGlobalByTitle(title: string): Promise<ProductOptionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productOptions)
      .where(
        and(
          eq(productOptions.title, title),
          eq(productOptions.isExclusive, false),
          isNull(productOptions.deletedAt),
        ),
      )
      .limit(1);
    const hydrated = await hydrate(rows);
    return hydrated[0] ?? null;
  },

  async findByIds(ids: string[]): Promise<ProductOptionDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows: ProductOptionRow[] = [];
    for (const group of chunk(ids, 50)) {
      rows.push(
        ...(await db
          .select()
          .from(productOptions)
          .where(
            and(
              inArray(productOptions.id, group),
              isNull(productOptions.deletedAt),
            ),
          )),
      );
    }
    return hydrate(rows);
  },

  /** The shared library: global options only. */
  async listPage(options: {
    query?: string | null;
    createdWithin?: ProductOptionCreatedWithin | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ options: ProductOptionDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [
      isNull(productOptions.deletedAt),
      eq(productOptions.isExclusive, false),
    ];

    if (options.query?.trim()) {
      conditions.push(
        like(productOptions.title, containsPattern(options.query.trim())) as SQL,
      );
    }

    if (options.createdWithin) {
      const days = getProductOptionCreatedWithinDays(options.createdWithin);
      const threshold = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      conditions.push(gte(productOptions.createdAt, threshold));
    }

    const sortColumn = {
      title: productOptions.title,
      createdAt: productOptions.createdAt,
      updatedAt: productOptions.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(productOptions).where(condition),
      db
        .select()
        .from(productOptions)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      options: await hydrate(rows),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async create(data: ProductOptionInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();

    await db.insert(productOptions).values({
      id: data.id,
      title: data.title,
      isExclusive: data.isExclusive ?? false,
      rank: data.rank ?? 0,
      metadata: data.metadata ?? null,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      createdAt: data.createdAt?.toISOString() ?? now,
      updatedAt: data.updatedAt?.toISOString() ?? now,
    });

    await replaceValues(data.id, data.values);
  },

  async update(id: string, data: UpdateProductOptionDTO): Promise<void> {
    const db = await getDb();

    await db
      .update(productOptions)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.rank !== undefined ? { rank: data.rank } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedBy: data.updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(productOptions.id, id), isNull(productOptions.deletedAt)));

    if (data.values) {
      await replaceValues(id, data.values);
    }
  },

  async softDelete(ids: string[], updatedBy: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();

    for (const group of chunk(ids, 50)) {
      await db
        .update(productOptions)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(
          and(
            inArray(productOptions.id, group),
            isNull(productOptions.deletedAt),
          ),
        );
    }
  },
};
