import { getDb } from "@/db";
import type { ProductMetadata } from "@/db/product.schema";
import { firstOrNull, mapFirstOrNull } from "@/lib/db/single-row";
import {
  productCategories,
  productTagLinks,
  productTags,
  products,
  productTypes,
} from "@/db/product.schema";
import { likeContains } from "@/lib/db/like-query";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type {
  CreateProductCategoryDTO,
  ProductCategoryDTO,
  ProductCategoryDetailDTO,
  ProductCategoryListItemDTO,
  ProductTagAdminDTO,
  ProductTagDTO,
  ProductTypeAdminDTO,
  ProductTypeDTO,
  UpdateProductCategoryDTO,
} from "../dto/product-taxonomy.dto";
import { ancestorIdsOf } from "../category-tree";
import { chunk, chunkForInsert } from "./d1-batch";
import { toProductCategoryDTO } from "../mappers/product-taxonomy.mapper";
import { batchGuard } from "@/lib/db/batch-guard";

/**
 * Types, tags and categories.
 *
 * Types and tags are keyed by a unique `value`, so the write path is an upsert
 * by value rather than a create: the Organize step lets an author type a name
 * that may or may not exist yet, and two products created in parallel with the
 * same new tag must end up pointing at one row.
 *
 * Categories are not upserted. They form a tree with a materialised path, so a
 * new one needs a parent and a rank that only a management screen can supply.
 */

const TAG_COLUMNS = 5;
const DETAIL_CHILD_LIMIT = 100;

const toProductTypeAdminDTO = (
  row: typeof productTypes.$inferSelect,
): ProductTypeAdminDTO => ({
  id: row.id,
  value: row.value,
  metadata: row.metadata ?? null,
  externalId: row.externalId ?? null,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

const toProductTagAdminDTO = (
  row: typeof productTags.$inferSelect,
): ProductTagAdminDTO => ({
  id: row.id,
  value: row.value,
  metadata: row.metadata ?? null,
  externalId: row.externalId ?? null,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

/**
 * Half-open range instead of `like(mpath, prefix + "%")`.
 *
 * SQLite caps a LIKE pattern at 50 *bytes*, and `/uuid/uuid/` is already 74.
 * Comparing against the next string in sort order matches the same rows, has no
 * length limit and uses the index. Mirrors `startsWithPrefix` in
 * `asset-folder.dal.ts`.
 */
const startsWithPrefix = (prefix: string) => {
  const lastChar = prefix.charCodeAt(prefix.length - 1);
  const upperBound = prefix.slice(0, -1) + String.fromCharCode(lastChar + 1);
  return and(
    gte(productCategories.mpath, prefix),
    lt(productCategories.mpath, upperBound),
  );
};

export const productTypeDal = {
  async findById(id: string): Promise<ProductTypeAdminDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productTypes)
      .where(and(eq(productTypes.id, id), isNull(productTypes.deletedAt)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? toProductTypeAdminDTO(row) : null;
  },

  async findByValue(value: string): Promise<ProductTypeAdminDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productTypes)
      .where(and(eq(productTypes.value, value), isNull(productTypes.deletedAt)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? toProductTypeAdminDTO(row) : null;
  },

  async listPage(options: {
    query?: string;
    sortBy: "value" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    offset: number;
    limit: number;
  }): Promise<{ types: ProductTypeAdminDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productTypes.deletedAt)];
    if (options.query?.trim())
      conditions.push(likeContains(productTypes.value, options.query.trim()));
    const where = and(...conditions);
    const sortColumn = {
      value: productTypes.value,
      createdAt: productTypes.createdAt,
      updatedAt: productTypes.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(productTypes).where(where),
      db
        .select()
        .from(productTypes)
        .where(where)
        .orderBy(orderBy, asc(productTypes.id))
        .limit(options.limit)
        .offset(options.offset),
    ]);
    return {
      types: rows.map(toProductTypeAdminDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async create(input: {
    id: string;
    value: string;
    metadata?: ProductMetadata;
    externalId?: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    const db = await getDb();
    await db.insert(productTypes).values({
      id: input.id,
      value: input.value,
      metadata: input.metadata,
      externalId: input.externalId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  },

  async update(
    id: string,
    input: {
      value?: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    },
  ): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(productTypes)
      .set({
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...(input.externalId === undefined
          ? {}
          : { externalId: input.externalId }),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(productTypes.id, id), isNull(productTypes.deletedAt)))
      .returning({ id: productTypes.id });
    return rows.length > 0;
  },

  async softDelete(id: string, actorId: string): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM product_types
          WHERE id = ${id} AND deleted_at IS NULL
        )`,
      ),
      db
        .update(products)
        .set({ typeId: null, updatedAt: now, updatedBy: actorId })
        .where(and(eq(products.typeId, id), isNull(products.deletedAt))),
      db
        .update(productTypes)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(productTypes.id, id), isNull(productTypes.deletedAt))),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  async listOptions(options: {
    query?: string;
    page: number;
    limit: number;
    selectedIds?: string[];
  }): Promise<{
    items: ProductTypeDTO[];
    selected: ProductTypeDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productTypes.deletedAt)];
    if (options.query?.trim())
      conditions.push(likeContains(productTypes.value, options.query.trim()));
    const where = and(...conditions);
    const [totals, rows, selectedRows] = await Promise.all([
      db.select({ value: count() }).from(productTypes).where(where),
      db
        .select()
        .from(productTypes)
        .where(where)
        .orderBy(asc(productTypes.value), asc(productTypes.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      options.selectedIds?.length
        ? db
            .select()
            .from(productTypes)
            .where(
              and(
                inArray(productTypes.id, options.selectedIds),
                isNull(productTypes.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    const map = (row: typeof productTypes.$inferSelect): ProductTypeDTO => ({
      id: row.id,
      value: row.value,
      metadata: row.metadata ?? null,
    });
    return {
      items: rows.map(map),
      selected: selectedRows.map(map),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  /**
   * The id for `value`, creating the type if no active row has it.
   *
   * Returns `null` for a blank value so the caller can clear a product's type
   * with the same call it uses to set one.
   */
  async ensure(value: string, now: string): Promise<string | null> {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    const db = await getDb();
    const existing = await db
      .select({ id: productTypes.id })
      .from(productTypes)
      .where(
        and(eq(productTypes.value, trimmed), isNull(productTypes.deletedAt)),
      )
      .limit(1);
    const existingRow = firstOrNull(existing);
    if (existingRow) return existingRow.id;

    const id = crypto.randomUUID();
    await db.insert(productTypes).values({
      id,
      value: trimmed,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
};

export const productTagDal = {
  async findById(id: string): Promise<ProductTagAdminDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productTags)
      .where(and(eq(productTags.id, id), isNull(productTags.deletedAt)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? toProductTagAdminDTO(row) : null;
  },

  async findByValue(value: string): Promise<ProductTagAdminDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productTags)
      .where(and(eq(productTags.value, value), isNull(productTags.deletedAt)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? toProductTagAdminDTO(row) : null;
  },

  async listPage(options: {
    query?: string;
    sortBy: "value" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    offset: number;
    limit: number;
  }): Promise<{ tags: ProductTagAdminDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productTags.deletedAt)];
    if (options.query?.trim())
      conditions.push(likeContains(productTags.value, options.query.trim()));
    const where = and(...conditions);
    const sortColumn = {
      value: productTags.value,
      createdAt: productTags.createdAt,
      updatedAt: productTags.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(productTags).where(where),
      db
        .select()
        .from(productTags)
        .where(where)
        .orderBy(orderBy, asc(productTags.id))
        .limit(options.limit)
        .offset(options.offset),
    ]);
    return {
      tags: rows.map(toProductTagAdminDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async create(input: {
    id: string;
    value: string;
    metadata?: ProductMetadata;
    externalId?: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    const db = await getDb();
    await db.insert(productTags).values({
      id: input.id,
      value: input.value,
      metadata: input.metadata,
      externalId: input.externalId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  },

  async update(
    id: string,
    input: {
      value?: string;
      metadata?: ProductMetadata;
      externalId?: string | null;
    },
  ): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(productTags)
      .set({
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...(input.externalId === undefined
          ? {}
          : { externalId: input.externalId }),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(productTags.id, id), isNull(productTags.deletedAt)))
      .returning({ id: productTags.id });
    return rows.length > 0;
  },

  async softDelete(id: string, actorId: string): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM product_tags
          WHERE id = ${id} AND deleted_at IS NULL
        )`,
      ),
      db
        .update(products)
        .set({ updatedAt: now, updatedBy: actorId })
        .where(
          and(
            sql`${products.id} IN (
              SELECT product_id FROM product_tag_links WHERE tag_id = ${id}
            )`,
            isNull(products.deletedAt),
          ),
        ),
      db.delete(productTagLinks).where(eq(productTagLinks.tagId, id)),
      db
        .update(productTags)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(productTags.id, id), isNull(productTags.deletedAt))),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  async listOptions(options: {
    query?: string;
    page: number;
    limit: number;
    selectedIds?: string[];
  }): Promise<{
    items: ProductTagDTO[];
    selected: ProductTagDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productTags.deletedAt)];
    if (options.query?.trim())
      conditions.push(likeContains(productTags.value, options.query.trim()));
    const where = and(...conditions);
    const [totals, rows, selectedRows] = await Promise.all([
      db.select({ value: count() }).from(productTags).where(where),
      db
        .select()
        .from(productTags)
        .where(where)
        .orderBy(asc(productTags.value), asc(productTags.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      options.selectedIds?.length
        ? db
            .select()
            .from(productTags)
            .where(
              and(
                inArray(productTags.id, options.selectedIds),
                isNull(productTags.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    const map = (row: typeof productTags.$inferSelect): ProductTagDTO => ({
      id: row.id,
      value: row.value,
      metadata: row.metadata ?? null,
    });
    return {
      items: rows.map(map),
      selected: selectedRows.map(map),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  /** Ids for every value, creating the ones that do not exist yet. */
  async ensureMany(values: string[], now: string): Promise<string[]> {
    const wanted = [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    if (wanted.length === 0) return [];

    const db = await getDb();
    const found = new Map<string, string>();
    for (const group of chunk(wanted, 50)) {
      const rows = await db
        .select({ id: productTags.id, value: productTags.value })
        .from(productTags)
        .where(
          and(inArray(productTags.value, group), isNull(productTags.deletedAt)),
        );
      for (const row of rows) found.set(row.value, row.id);
    }

    const created = wanted
      .filter((value) => !found.has(value))
      .map((value) => ({
        id: crypto.randomUUID(),
        value,
        createdAt: now,
        updatedAt: now,
      }));

    for (const group of chunkForInsert(created, TAG_COLUMNS)) {
      await db.insert(productTags).values(group);
    }
    for (const row of created) found.set(row.value, row.id);

    // Caller order is the author's order, which the link rows preserve.
    return wanted
      .map((value) => found.get(value))
      .filter((id): id is string => Boolean(id));
  },
};

export const productCategoryDal = {
  /** Resolve exact category labels without choosing arbitrarily among branches. */
  async findByNames(
    names: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const wanted = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    if (wanted.length === 0) return [];
    const db = await getDb();
    const rows: Array<{ id: string; name: string }> = [];
    for (const group of chunk(wanted, 50)) {
      rows.push(
        ...(await db
          .select({ id: productCategories.id, name: productCategories.name })
          .from(productCategories)
          .where(
            and(
              inArray(productCategories.name, group),
              isNull(productCategories.deletedAt),
            ),
          )),
      );
    }
    return rows;
  },

  /**
   * Every active category in tree order: a parent immediately followed by its
   * children, siblings alphabetical.
   *
   * The ordering is done here rather than in SQL. Sorting by `mpath` groups a
   * subtree correctly but orders siblings by their uuid, which is arbitrary —
   * and no single `ORDER BY` can give "parents first, then siblings by name"
   * from a path built out of ids.
   */
  async listOptions(options: {
    query?: string;
    page: number;
    limit: number;
    selectedIds?: string[];
  }): Promise<{
    items: ProductCategoryDTO[];
    selected: ProductCategoryDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productCategories.deletedAt)];
    if (options.query?.trim())
      conditions.push(
        likeContains(productCategories.name, options.query.trim()),
      );
    const where = and(...conditions);
    const [totals, rows, selectedRows] = await Promise.all([
      db.select({ value: count() }).from(productCategories).where(where),
      db
        .select()
        .from(productCategories)
        .where(where)
        .orderBy(asc(productCategories.name), asc(productCategories.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      options.selectedIds?.length
        ? db
            .select()
            .from(productCategories)
            .where(
              and(
                inArray(productCategories.id, options.selectedIds),
                isNull(productCategories.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    return {
      items: rows.map(toProductCategoryDTO),
      selected: selectedRows.map(toProductCategoryDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async findById(id: string): Promise<ProductCategoryDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCategories)
      .where(
        and(eq(productCategories.id, id), isNull(productCategories.deletedAt)),
      )
      .limit(1);
    return mapFirstOrNull(rows, toProductCategoryDTO);
  },

  async findByHandle(handle: string): Promise<ProductCategoryDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCategories)
      .where(
        and(
          eq(productCategories.handle, handle),
          isNull(productCategories.deletedAt),
        ),
      )
      .limit(1);
    return mapFirstOrNull(rows, toProductCategoryDTO);
  },

  /**
   * A category with its ancestor path and direct children.
   *
   * Both are bounded and describe the record itself, so they travel with it.
   * The category's products are a separate paginated query — that list grows.
   */
  async findDetail(id: string): Promise<ProductCategoryDetailDTO | null> {
    const category = await this.findById(id);
    if (!category) return null;

    const db = await getDb();
    const [withPath, childRows] = await Promise.all([
      this.withAncestorNames([category]),
      db
        .select({ id: productCategories.id, name: productCategories.name })
        .from(productCategories)
        .where(
          and(
            eq(productCategories.parentCategoryId, id),
            isNull(productCategories.deletedAt),
          ),
        )
        .orderBy(asc(productCategories.name))
        .limit(DETAIL_CHILD_LIMIT),
    ]);

    const detail = firstOrNull(withPath);
    if (!detail) return null;
    return { ...detail, children: childRows };
  },

  /**
   * One page of categories, sorted flat.
   *
   * Deliberately not tree-ordered: a subtree can straddle a page boundary, so
   * indentation would be misleading. Sorting by name keeps the order meaningful
   * and each row carries its ancestor path instead, which is how Medusa renders
   * a nested category in its list.
   */
  async listPage(options: {
    query?: string | null;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ categories: ProductCategoryListItemDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productCategories.deletedAt)];

    if (options.query?.trim()) {
      conditions.push(
        likeContains(productCategories.name, options.query.trim()) as SQL,
      );
    }

    const sortColumn = {
      name: productCategories.name,
      createdAt: productCategories.createdAt,
      updatedAt: productCategories.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(productCategories).where(condition),
      db
        .select()
        .from(productCategories)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      categories: await this.withAncestorNames(rows.map(toProductCategoryDTO)),
      total: countRows[0]?.value ?? 0,
    };
  },

  /**
   * Resolve each row's ancestor names from the ids in its `mpath`.
   *
   * One extra query for the whole page: the ancestor set is at most
   * `page size × depth`, and it is chunked because D1 caps a statement at 100
   * bound parameters.
   */
  async withAncestorNames(
    categories: ProductCategoryDTO[],
  ): Promise<ProductCategoryListItemDTO[]> {
    const ancestorIds = new Set<string>();
    for (const category of categories) {
      for (const id of ancestorIdsOf(category.mpath)) ancestorIds.add(id);
    }

    const nameById = new Map<string, string>();
    if (ancestorIds.size > 0) {
      const db = await getDb();
      for (const group of chunk([...ancestorIds], 50)) {
        const rows = await db
          .select({ id: productCategories.id, name: productCategories.name })
          .from(productCategories)
          .where(inArray(productCategories.id, group));
        for (const row of rows) nameById.set(row.id, row.name);
      }
    }

    return categories.map((category) => ({
      ...category,
      ancestorNames: ancestorIdsOf(category.mpath)
        .map((id) => nameById.get(id))
        .filter((name): name is string => name !== undefined),
    }));
  },

  /**
   * Create, deriving `mpath` from the parent.
   *
   * The path is written once here. Re-parenting would have to rewrite every
   * descendant's path, so it is deliberately not supported — matching Medusa,
   * whose edit form also cannot move a category.
   */
  async create(
    data: CreateProductCategoryDTO,
    now: string,
  ): Promise<ProductCategoryDTO> {
    const db = await getDb();
    const id = crypto.randomUUID();

    let mpath = `/${id}`;
    if (data.parentCategoryId) {
      const parent = await this.findById(data.parentCategoryId);
      if (!parent) throw new Error("Parent category not found");
      mpath = `${parent.mpath}/${id}`;
    }

    // Appended within its parent, so creation order is the display order until
    // someone reorders.
    const siblings = await db
      .select({ value: count() })
      .from(productCategories)
      .where(
        and(
          data.parentCategoryId
            ? eq(productCategories.parentCategoryId, data.parentCategoryId)
            : isNull(productCategories.parentCategoryId),
          isNull(productCategories.deletedAt),
        ),
      );

    const row = {
      id,
      name: data.name,
      description: data.description ?? "",
      handle: data.handle,
      mpath,
      parentCategoryId: data.parentCategoryId ?? null,
      isActive: data.isActive ?? false,
      isInternal: data.isInternal ?? false,
      rank: siblings[0]?.value ?? 0,
      metadata: data.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(productCategories).values(row);
    return toProductCategoryDTO(row);
  },

  async update(
    id: string,
    data: UpdateProductCategoryDTO,
    now: string,
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(productCategories)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.handle !== undefined && { handle: data.handle }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isInternal !== undefined && { isInternal: data.isInternal }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
        updatedAt: now,
      })
      .where(eq(productCategories.id, id));
  },

  /** Every descendant of `mpath`, excluding the row itself. */
  async findDescendants(mpath: string): Promise<ProductCategoryDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCategories)
      .where(
        and(startsWithPrefix(`${mpath}/`), isNull(productCategories.deletedAt)),
      );
    return rows.map(toProductCategoryDTO);
  },

  /**
   * Soft-delete a category and everything under it.
   *
   * Leaving descendants behind would strand rows whose parent no longer
   * resolves, and their `mpath` would still point at a deleted ancestor.
   */
  async softDelete(ids: string[], now: string): Promise<number> {
    if (ids.length === 0) return 0;

    const db = await getDb();
    const roots = await db
      .select({ id: productCategories.id, mpath: productCategories.mpath })
      .from(productCategories)
      .where(
        and(
          inArray(productCategories.id, ids),
          isNull(productCategories.deletedAt),
        ),
      );
    if (roots.length === 0) return 0;

    const affected = new Set(roots.map((root) => root.id));
    for (const root of roots) {
      for (const descendant of await this.findDescendants(root.mpath)) {
        affected.add(descendant.id);
      }
    }

    for (const group of chunk([...affected], 50)) {
      await db
        .update(productCategories)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(productCategories.id, group));
    }

    return affected.size;
  },

  /** Narrow a client-supplied list to categories that actually exist. */
  async filterExisting(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const found = new Set<string>();

    for (const group of chunk([...new Set(ids)], 50)) {
      const rows = await db
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(
          and(
            inArray(productCategories.id, group),
            isNull(productCategories.deletedAt),
          ),
        );
      for (const row of rows) found.add(row.id);
    }

    return ids.filter((id) => found.has(id));
  },
};
