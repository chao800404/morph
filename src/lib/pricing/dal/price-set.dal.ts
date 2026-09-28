import { getDb } from "@/db";
import { productVariantPriceSets } from "@/db/link.schema";
import { priceSets } from "@/db/pricing.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

const PRICE_SET_COLUMNS = 4;
const VARIANT_PRICE_SET_COLUMNS = 4;

/** Shared links from variants to Pricing-owned price sets. */
export const priceSetDal = {
  async ensureForVariants(
    variantIds: string[],
    now = new Date().toISOString(),
  ): Promise<Map<string, string>> {
    const ids = [...new Set(variantIds)];
    if (!ids.length) return new Map();

    const db = await getDb();
    const links = await db
      .select({
        variantId: productVariantPriceSets.variantId,
        priceSetId: productVariantPriceSets.priceSetId,
      })
      .from(productVariantPriceSets)
      .innerJoin(
        priceSets,
        and(
          eq(priceSets.id, productVariantPriceSets.priceSetId),
          isNull(priceSets.deletedAt),
        ),
      )
      .where(inArray(productVariantPriceSets.variantId, ids))
      .orderBy(asc(productVariantPriceSets.priceSetId));

    const priceSetByVariant = new Map<string, string>();
    for (const link of links) {
      if (!priceSetByVariant.has(link.variantId))
        priceSetByVariant.set(link.variantId, link.priceSetId);
    }

    const missingIds = ids.filter((id) => !priceSetByVariant.has(id));
    if (!missingIds.length) return priceSetByVariant;

    const priceSetsToCreate = missingIds.map((variantId) => ({
      id: `pset_${variantId}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }));
    const linksToCreate = missingIds.map((variantId) => ({
      variantId,
      priceSetId: `pset_${variantId}`,
      createdAt: now,
      updatedAt: now,
    }));
    const statements: BatchItem<"sqlite">[] = [
      ...chunkForInsert(priceSetsToCreate, PRICE_SET_COLUMNS).map((rows) =>
        db
          .insert(priceSets)
          .values(rows)
          .onConflictDoUpdate({
            target: priceSets.id,
            set: { updatedAt: now, deletedAt: null },
          }),
      ),
      ...chunkForInsert(linksToCreate, VARIANT_PRICE_SET_COLUMNS).map((rows) =>
        db.insert(productVariantPriceSets).values(rows).onConflictDoNothing(),
      ),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    for (const variantId of missingIds)
      priceSetByVariant.set(variantId, `pset_${variantId}`);
    return priceSetByVariant;
  },

  async ensureForVariant(
    variantId: string,
    now = new Date().toISOString(),
  ): Promise<string> {
    const priceSetByVariant = await priceSetDal.ensureForVariants(
      [variantId],
      now,
    );
    return priceSetByVariant.get(variantId)!;
  },
};
