import { getDb } from "@/db";
import {
  productTagLinks,
  productTags,
  products,
  productTypes,
  refundReasons,
  refunds,
  returnItems,
  returnReasons,
} from "@/db/schema";
import type { Metadata } from "@/db/json";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
} from "drizzle-orm";

export const REFERENCE_DATA_KINDS = [
  "product-types",
  "product-tags",
  "return-reasons",
  "refund-reasons",
] as const;

export type ReferenceDataKind = (typeof REFERENCE_DATA_KINDS)[number];

export interface ReferenceDataItemDTO {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  usageCount: number;
  metadata: Metadata;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceDataListParams {
  kind: ReferenceDataKind;
  query?: string;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

const pageOf = <T>(items: T[], total: number, page: number, limit: number) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  },
});

const orderDirection = (order: "asc" | "desc") =>
  order === "asc" ? asc : desc;

export const referenceDataDal = {
  async list(params: ReferenceDataListParams) {
    const db = await getDb();
    const offset = (params.page - 1) * params.limit;
    const direction = orderDirection(params.sortOrder);
    const term = params.query?.trim();

    if (params.kind === "product-types") {
      const where = and(
        isNull(productTypes.deletedAt),
        term ? like(productTypes.value, `%${term}%`) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(productTypes)
          .where(where)
          .orderBy(
            direction(
              params.sortBy === "createdAt"
                ? productTypes.createdAt
                : params.sortBy === "updatedAt"
                  ? productTypes.updatedAt
                  : productTypes.value,
            ),
          )
          .limit(params.limit)
          .offset(offset),
        db.select({ total: count() }).from(productTypes).where(where),
      ]);
      const usage = rows.length
        ? await db
            .select({ id: products.typeId, total: count() })
            .from(products)
            .where(
              and(
                inArray(
                  products.typeId,
                  rows.map((row) => row.id),
                ),
                isNull(products.deletedAt),
              ),
            )
            .groupBy(products.typeId)
        : [];
      const counts = new Map(usage.map((row) => [row.id, row.total]));
      return pageOf(
        rows.map((row) => ({
          id: row.id,
          name: row.value,
          code: null,
          description: null,
          parentId: null,
          parentName: null,
          usageCount: counts.get(row.id) ?? 0,
          metadata: row.metadata ?? {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        total,
        params.page,
        params.limit,
      );
    }

    if (params.kind === "product-tags") {
      const where = and(
        isNull(productTags.deletedAt),
        term ? like(productTags.value, `%${term}%`) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(productTags)
          .where(where)
          .orderBy(
            direction(
              params.sortBy === "createdAt"
                ? productTags.createdAt
                : params.sortBy === "updatedAt"
                  ? productTags.updatedAt
                  : productTags.value,
            ),
          )
          .limit(params.limit)
          .offset(offset),
        db.select({ total: count() }).from(productTags).where(where),
      ]);
      const usage = rows.length
        ? await db
            .select({ id: productTagLinks.tagId, total: count() })
            .from(productTagLinks)
            .innerJoin(
              products,
              and(
                eq(products.id, productTagLinks.productId),
                isNull(products.deletedAt),
              ),
            )
            .where(
              inArray(
                productTagLinks.tagId,
                rows.map((row) => row.id),
              ),
            )
            .groupBy(productTagLinks.tagId)
        : [];
      const counts = new Map(usage.map((row) => [row.id, row.total]));
      return pageOf(
        rows.map((row) => ({
          id: row.id,
          name: row.value,
          code: null,
          description: null,
          parentId: null,
          parentName: null,
          usageCount: counts.get(row.id) ?? 0,
          metadata: row.metadata ?? {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        total,
        params.page,
        params.limit,
      );
    }

    if (params.kind === "return-reasons") {
      const parent = db
        .$with("parent")
        .as(
          db
            .select({ id: returnReasons.id, name: returnReasons.label })
            .from(returnReasons),
        );
      const where = and(
        isNull(returnReasons.deletedAt),
        term
          ? or(
              like(returnReasons.label, `%${term}%`),
              like(returnReasons.value, `%${term}%`),
            )
          : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        db
          .with(parent)
          .select({ reason: returnReasons, parentName: parent.name })
          .from(returnReasons)
          .leftJoin(parent, eq(parent.id, returnReasons.parentReturnReasonId))
          .where(where)
          .orderBy(
            direction(
              params.sortBy === "createdAt"
                ? returnReasons.createdAt
                : params.sortBy === "updatedAt"
                  ? returnReasons.updatedAt
                  : returnReasons.label,
            ),
          )
          .limit(params.limit)
          .offset(offset),
        db.select({ total: count() }).from(returnReasons).where(where),
      ]);
      const usage = rows.length
        ? await db
            .select({ id: returnItems.reasonId, total: count() })
            .from(returnItems)
            .where(
              and(
                inArray(
                  returnItems.reasonId,
                  rows.map(({ reason }) => reason.id),
                ),
                isNull(returnItems.deletedAt),
              ),
            )
            .groupBy(returnItems.reasonId)
        : [];
      const counts = new Map(usage.map((row) => [row.id, row.total]));
      return pageOf(
        rows.map(({ reason, parentName }) => ({
          id: reason.id,
          name: reason.label,
          code: reason.value,
          description: reason.description,
          parentId: reason.parentReturnReasonId,
          parentName,
          usageCount: counts.get(reason.id) ?? 0,
          metadata: reason.metadata ?? {},
          createdAt: reason.createdAt,
          updatedAt: reason.updatedAt,
        })),
        total,
        params.page,
        params.limit,
      );
    }

    const where = and(
      isNull(refundReasons.deletedAt),
      term
        ? or(
            like(refundReasons.label, `%${term}%`),
            like(refundReasons.code, `%${term}%`),
          )
        : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(refundReasons)
        .where(where)
        .orderBy(
          direction(
            params.sortBy === "createdAt"
              ? refundReasons.createdAt
              : params.sortBy === "updatedAt"
                ? refundReasons.updatedAt
                : refundReasons.label,
          ),
        )
        .limit(params.limit)
        .offset(offset),
      db.select({ total: count() }).from(refundReasons).where(where),
    ]);
    const usage = rows.length
      ? await db
          .select({ id: refunds.refundReasonId, total: count() })
          .from(refunds)
          .where(
            and(
              inArray(
                refunds.refundReasonId,
                rows.map((row) => row.id),
              ),
              isNull(refunds.deletedAt),
            ),
          )
          .groupBy(refunds.refundReasonId)
      : [];
    const counts = new Map(usage.map((row) => [row.id, row.total]));
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        name: row.label,
        code: row.code,
        description: row.description,
        parentId: null,
        parentName: null,
        usageCount: counts.get(row.id) ?? 0,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      params.page,
      params.limit,
    );
  },

  async find(kind: ReferenceDataKind, id: string) {
    const db = await getDb();
    const lookup =
      kind === "product-types"
        ? await db
            .select({ term: productTypes.value })
            .from(productTypes)
            .where(and(eq(productTypes.id, id), isNull(productTypes.deletedAt)))
            .limit(1)
        : kind === "product-tags"
          ? await db
              .select({ term: productTags.value })
              .from(productTags)
              .where(and(eq(productTags.id, id), isNull(productTags.deletedAt)))
              .limit(1)
          : kind === "return-reasons"
            ? await db
                .select({ term: returnReasons.value })
                .from(returnReasons)
                .where(
                  and(
                    eq(returnReasons.id, id),
                    isNull(returnReasons.deletedAt),
                  ),
                )
                .limit(1)
            : await db
                .select({ term: refundReasons.code })
                .from(refundReasons)
                .where(
                  and(
                    eq(refundReasons.id, id),
                    isNull(refundReasons.deletedAt),
                  ),
                )
                .limit(1);
    if (!lookup[0]) return null;
    const result = await this.list({
      kind,
      query: lookup[0].term,
      page: 1,
      limit: 100,
      sortBy: "name",
      sortOrder: "asc",
    });
    return result.items.find((item) => item.id === id) ?? null;
  },

  async create(
    kind: ReferenceDataKind,
    data: {
      name: string;
      code?: string | null;
      description?: string | null;
      parentId?: string | null;
    },
  ) {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    if (kind === "product-types")
      await db
        .insert(productTypes)
        .values({ id, value: data.name, createdAt: now, updatedAt: now });
    else if (kind === "product-tags")
      await db
        .insert(productTags)
        .values({ id, value: data.name, createdAt: now, updatedAt: now });
    else if (kind === "return-reasons")
      await db.insert(returnReasons).values({
        id,
        label: data.name,
        value: data.code ?? "",
        description: data.description,
        parentReturnReasonId: data.parentId,
        createdAt: now,
        updatedAt: now,
      });
    else
      await db.insert(refundReasons).values({
        id,
        label: data.name,
        code: data.code ?? "",
        description: data.description,
        createdAt: now,
        updatedAt: now,
      });
    return id;
  },

  async update(
    kind: ReferenceDataKind,
    id: string,
    data: {
      name?: string;
      code?: string | null;
      description?: string | null;
      parentId?: string | null;
      metadata?: Metadata;
    },
  ) {
    const db = await getDb();
    const updatedAt = new Date().toISOString();
    if (kind === "product-types")
      await db
        .update(productTypes)
        .set({ value: data.name, metadata: data.metadata, updatedAt })
        .where(and(eq(productTypes.id, id), isNull(productTypes.deletedAt)));
    else if (kind === "product-tags")
      await db
        .update(productTags)
        .set({ value: data.name, metadata: data.metadata, updatedAt })
        .where(and(eq(productTags.id, id), isNull(productTags.deletedAt)));
    else if (kind === "return-reasons")
      await db
        .update(returnReasons)
        .set({
          label: data.name,
          value: data.code ?? undefined,
          description: data.description,
          parentReturnReasonId: data.parentId,
          metadata: data.metadata,
          updatedAt,
        })
        .where(and(eq(returnReasons.id, id), isNull(returnReasons.deletedAt)));
    else
      await db
        .update(refundReasons)
        .set({
          label: data.name,
          code: data.code ?? undefined,
          description: data.description,
          metadata: data.metadata,
          updatedAt,
        })
        .where(and(eq(refundReasons.id, id), isNull(refundReasons.deletedAt)));
  },

  async softDelete(kind: ReferenceDataKind, ids: string[]) {
    const db = await getDb();
    const deletedAt = new Date().toISOString();
    if (kind === "product-types")
      await db
        .update(productTypes)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(productTypes.id, ids));
    else if (kind === "product-tags")
      await db
        .update(productTags)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(productTags.id, ids));
    else if (kind === "return-reasons")
      await db
        .update(returnReasons)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(returnReasons.id, ids));
    else
      await db
        .update(refundReasons)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(refundReasons.id, ids));
  },
};
