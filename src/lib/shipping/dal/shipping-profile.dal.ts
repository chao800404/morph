import { getDb } from "@/db";
import { productShippingProfiles } from "@/db/link.schema";
import { products } from "@/db/product.schema";
import { shippingOptions, shippingProfiles } from "@/db/fulfillment.schema";
import { firstOrNull } from "@/lib/db/single-row";
import { likeContains } from "@/lib/db/like-query";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  type SQL,
} from "drizzle-orm";
import type {
  ShippingProfileDTO,
  ShippingProfileType,
} from "../dto/shipping-profile.dto";
import { DEFAULT_SHIPPING_PROFILE_ID } from "../constants";

export interface ShippingProfileListParams {
  query?: string | null;
  sortBy: "name" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

const toProfileDTO = (
  row: typeof shippingProfiles.$inferSelect,
  productCount: number,
  shippingOptionCount: number,
): ShippingProfileDTO => ({
  id: row.id,
  name: row.name,
  type: row.type as ShippingProfileType,
  productCount,
  shippingOptionCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const shippingProfileDal = {
  async listPage(params: ShippingProfileListParams): Promise<{
    profiles: ShippingProfileDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(shippingProfiles.deletedAt)];
    if (params.query?.trim()) {
      conditions.push(likeContains(shippingProfiles.name, params.query.trim()));
    }
    const where = and(...conditions);
    const sortColumn = {
      name: shippingProfiles.name,
      createdAt: shippingProfiles.createdAt,
      updatedAt: shippingProfiles.updatedAt,
    }[params.sortBy];
    const direction = params.sortOrder === "asc" ? asc : desc;
    const [totalRows, rows] = await Promise.all([
      db.select({ total: count() }).from(shippingProfiles).where(where),
      db
        .select()
        .from(shippingProfiles)
        .where(where)
        .orderBy(direction(sortColumn), asc(shippingProfiles.id))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
    ]);
    const ids = rows.map((row) => row.id);
    const [productsByProfile, optionsByProfile] = ids.length
      ? await Promise.all([
          db
            .select({
              profileId: productShippingProfiles.shippingProfileId,
              total: countDistinct(products.id),
            })
            .from(productShippingProfiles)
            .innerJoin(
              products,
              and(
                eq(products.id, productShippingProfiles.productId),
                isNull(products.deletedAt),
              ),
            )
            .where(inArray(productShippingProfiles.shippingProfileId, ids))
            .groupBy(productShippingProfiles.shippingProfileId),
          db
            .select({
              profileId: shippingOptions.shippingProfileId,
              total: count(),
            })
            .from(shippingOptions)
            .where(
              and(
                inArray(shippingOptions.shippingProfileId, ids),
                isNull(shippingOptions.deletedAt),
              ),
            )
            .groupBy(shippingOptions.shippingProfileId),
        ])
      : [[], []];
    const productCounts = new Map(
      productsByProfile.map((row) => [row.profileId, Number(row.total)]),
    );
    const optionCounts = new Map(
      optionsByProfile.map((row) => [row.profileId, Number(row.total)]),
    );
    return {
      profiles: rows.map((row) =>
        toProfileDTO(
          row,
          productCounts.get(row.id) ?? 0,
          optionCounts.get(row.id) ?? 0,
        ),
      ),
      total: Number(totalRows[0]?.total ?? 0),
    };
  },

  async findById(id: string): Promise<ShippingProfileDTO | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select()
        .from(shippingProfiles)
        .where(
          and(eq(shippingProfiles.id, id), isNull(shippingProfiles.deletedAt)),
        )
        .limit(1),
    );
    if (!row) return null;
    const [productRows, optionRows] = await Promise.all([
      db
        .select({ total: countDistinct(products.id) })
        .from(productShippingProfiles)
        .innerJoin(
          products,
          and(
            eq(products.id, productShippingProfiles.productId),
            isNull(products.deletedAt),
          ),
        )
        .where(eq(productShippingProfiles.shippingProfileId, id)),
      db
        .select({ total: count() })
        .from(shippingOptions)
        .where(
          and(
            eq(shippingOptions.shippingProfileId, id),
            isNull(shippingOptions.deletedAt),
          ),
        ),
    ]);
    return toProfileDTO(
      row,
      Number(productRows[0]?.total ?? 0),
      Number(optionRows[0]?.total ?? 0),
    );
  },

  async findByName(name: string): Promise<ShippingProfileDTO | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select()
        .from(shippingProfiles)
        .where(
          and(
            eq(shippingProfiles.name, name),
            isNull(shippingProfiles.deletedAt),
          ),
        )
        .limit(1),
    );
    return row ? toProfileDTO(row, 0, 0) : null;
  },

  async create(input: {
    id: string;
    name: string;
    type: Exclude<ShippingProfileType, "default">;
    now: string;
  }): Promise<void> {
    const db = await getDb();
    await db.insert(shippingProfiles).values({
      id: input.id,
      name: input.name,
      type: input.type,
      metadata: {},
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    });
  },

  async update(input: {
    id: string;
    name?: string;
    type?: Exclude<ShippingProfileType, "default">;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(shippingProfiles)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined && input.id !== DEFAULT_SHIPPING_PROFILE_ID
          ? { type: input.type }
          : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(shippingProfiles.id, input.id),
          isNull(shippingProfiles.deletedAt),
        ),
      )
      .run();
    return result.meta.changes > 0;
  },

  async softDelete(
    id: string,
    now: string,
  ): Promise<"deleted" | "missing" | "default" | "in-use"> {
    if (id === DEFAULT_SHIPPING_PROFILE_ID) return "default";
    const db = await getDb();
    const productLinks = db
      .select({ id: productShippingProfiles.productId })
      .from(productShippingProfiles)
      .innerJoin(
        products,
        and(
          eq(products.id, productShippingProfiles.productId),
          isNull(products.deletedAt),
        ),
      )
      .where(eq(productShippingProfiles.shippingProfileId, id));
    const optionLinks = db
      .select({ id: shippingOptions.id })
      .from(shippingOptions)
      .where(
        and(
          eq(shippingOptions.shippingProfileId, id),
          isNull(shippingOptions.deletedAt),
        ),
      );
    const result = await db
      .update(shippingProfiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(shippingProfiles.id, id),
          isNull(shippingProfiles.deletedAt),
          notExists(productLinks),
          notExists(optionLinks),
        ),
      )
      .run();
    if (result.meta.changes > 0) {
      await db
        .delete(productShippingProfiles)
        .where(eq(productShippingProfiles.shippingProfileId, id));
      return "deleted";
    }
    const profile = await this.findById(id);
    if (!profile) return "missing";
    return profile.productCount > 0 || profile.shippingOptionCount > 0
      ? "in-use"
      : "missing";
  },
};
