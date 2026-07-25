import { getDb } from "@/db";
import { productCollections } from "@/db/product.schema";
import { and, asc, count, desc, eq, inArray, isNull, like, or, SQL } from "drizzle-orm";
import type {
  ProductCollectionDTO,
  ProductCollectionInsertDTO,
  UpdateProductCollectionDTO,
} from "../dto/product-collection.dto";
import { containsPattern } from "@/lib/db/like-pattern";
import {
  toProductCollectionDTO,
  type ProductCollectionRow,
} from "../mappers/product-collection.mapper";

const mapFirst = (rows: ProductCollectionRow[]): ProductCollectionDTO | null =>
  rows.length > 0 ? toProductCollectionDTO(rows[0]) : null;

export const productCollectionDal = {
  async findById(id: string): Promise<ProductCollectionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCollections)
      .where(
        and(
          eq(productCollections.id, id),
          isNull(productCollections.deletedAt),
        ),
      )
      .limit(1);
    return mapFirst(rows);
  },

  async findByHandle(handle: string): Promise<ProductCollectionDTO | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCollections)
      .where(
        and(
          eq(productCollections.handle, handle),
          isNull(productCollections.deletedAt),
        ),
      )
      .limit(1);
    return mapFirst(rows);
  },

  async findByIds(ids: string[]): Promise<ProductCollectionDTO[]> {
    if (ids.length === 0) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(productCollections)
      .where(
        and(
          inArray(productCollections.id, ids),
          isNull(productCollections.deletedAt),
        ),
      );
    return rows.map(toProductCollectionDTO);
  },

  async listPage(options: {
    query?: string | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }): Promise<{ collections: ProductCollectionDTO[]; total: number }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(productCollections.deletedAt)];

    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(productCollections.title, pattern),
          like(productCollections.handle, pattern),
        ) as SQL,
      );
    }

    const sortColumn = {
      title: productCollections.title,
      createdAt: productCollections.createdAt,
      updatedAt: productCollections.updatedAt,
    }[options.sortBy];
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const condition = and(...conditions);

    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(productCollections).where(condition),
      db
        .select()
        .from(productCollections)
        .where(condition)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);

    return {
      collections: rows.map(toProductCollectionDTO),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async create(data: ProductCollectionInsertDTO): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(productCollections).values({
      id: data.id,
      title: data.title,
      handle: data.handle,
      description: data.description ?? null,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      createdAt: data.createdAt?.toISOString() ?? now,
      updatedAt: data.updatedAt?.toISOString() ?? now,
    });
  },

  async update(id: string, data: UpdateProductCollectionDTO): Promise<void> {
    const db = await getDb();
    await db
      .update(productCollections)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.handle !== undefined ? { handle: data.handle } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        updatedBy: data.updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(productCollections.id, id),
          isNull(productCollections.deletedAt),
        ),
      );
  },

  async softDelete(ids: string[], updatedBy: string): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();
    const batchSize = 50;

    for (let index = 0; index < ids.length; index += batchSize) {
      const chunk = ids.slice(index, index + batchSize);
      await db
        .update(productCollections)
        .set({ deletedAt: now, updatedAt: now, updatedBy })
        .where(
          and(
            inArray(productCollections.id, chunk),
            isNull(productCollections.deletedAt),
          ),
        );
    }
  },
};
