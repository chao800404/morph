import { getDb } from "@/db";
import { productVariantPriceSets } from "@/db/link.schema";
import {
  priceListRules,
  priceLists,
  priceRules,
  prices,
} from "@/db/pricing.schema";
import { productVariantPrices } from "@/db/product.schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type {
  PriceCandidate,
  PriceListRuleCandidate,
  PricingContext,
} from "../resolve-price";
import { resolvePrice } from "../resolve-price";

const stringValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined) return [];
  return [String(value)];
};

const resolvePriceSets = async (input: {
  priceSetIds: string[];
  baseAmount: number | null;
  context: PricingContext;
}) => {
  if (!input.priceSetIds.length)
    return resolvePrice({
      baseAmount: input.baseAmount,
      candidates: [],
      context: input.context,
    });
  const db = await getDb();
  const rows = await db
    .select({
      price: prices,
      declaredPriceListId: prices.priceListId,
      priceList: priceLists,
    })
    .from(prices)
    .leftJoin(
      priceLists,
      and(eq(priceLists.id, prices.priceListId), isNull(priceLists.deletedAt)),
    )
    .where(
      and(
        inArray(prices.priceSetId, input.priceSetIds),
        eq(prices.currencyCode, input.context.currencyCode),
        isNull(prices.deletedAt),
      ),
    );
  const validRows = rows.filter(
    (row) => row.declaredPriceListId === null || row.priceList !== null,
  );
  const priceIds = validRows.map((row) => row.price.id);
  const listIds = [
    ...new Set(
      validRows.flatMap((row) => (row.priceList?.id ? [row.priceList.id] : [])),
    ),
  ];
  const [rules, listRules] = await Promise.all([
    priceIds.length
      ? db
          .select()
          .from(priceRules)
          .where(
            and(
              inArray(priceRules.priceId, priceIds),
              isNull(priceRules.deletedAt),
            ),
          )
      : [],
    listIds.length
      ? db
          .select()
          .from(priceListRules)
          .where(
            and(
              inArray(priceListRules.priceListId, listIds),
              isNull(priceListRules.deletedAt),
            ),
          )
      : [],
  ]);
  const rulesByList = new Map<string, PriceListRuleCandidate[]>();
  for (const rule of listRules) {
    const current = rulesByList.get(rule.priceListId) ?? [];
    current.push({
      attribute: rule.attribute,
      values: stringValues(rule.value),
    });
    rulesByList.set(rule.priceListId, current);
  }
  const candidates: PriceCandidate[] = validRows.map((row) => ({
    id: row.price.id,
    amount: row.price.amount,
    currencyCode: row.price.currencyCode,
    minQuantity: row.price.minQuantity,
    maxQuantity: row.price.maxQuantity,
    rules: rules
      .filter((rule) => rule.priceId === row.price.id)
      .map((rule) => ({
        attribute: rule.attribute,
        value: rule.value,
        operator: rule.operator,
        priority: rule.priority,
      })),
    priceList: row.priceList
      ? {
          id: row.priceList.id,
          status: row.priceList.status,
          type: row.priceList.type,
          startsAt: row.priceList.startsAt,
          endsAt: row.priceList.endsAt,
          rules: rulesByList.get(row.priceList.id) ?? [],
        }
      : null,
  }));
  return resolvePrice({
    baseAmount: input.baseAmount,
    candidates,
    context: input.context,
  });
};

export const pricingDal = {
  resolvePriceSets,

  async resolveVariantPrice(variantId: string, context: PricingContext) {
    const db = await getDb();
    const [base, links] = await Promise.all([
      db
        .select({ amount: productVariantPrices.amount })
        .from(productVariantPrices)
        .where(
          and(
            eq(productVariantPrices.variantId, variantId),
            eq(productVariantPrices.currencyCode, context.currencyCode),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ priceSetId: productVariantPriceSets.priceSetId })
        .from(productVariantPriceSets)
        .where(eq(productVariantPriceSets.variantId, variantId)),
    ]);
    return resolvePriceSets({
      priceSetIds: links.map((link) => link.priceSetId),
      baseAmount: base?.amount ?? null,
      context,
    });
  },
};
