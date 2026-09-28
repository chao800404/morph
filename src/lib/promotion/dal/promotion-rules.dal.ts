import { getDb } from "@/db";
import {
  promotionApplicationMethodBuyRules,
  promotionApplicationMethodTargetRules,
  promotionPromotionRules,
  promotionRules,
  promotionRuleValues,
} from "@/db/promotion.schema";
import { and, inArray, isNull } from "drizzle-orm";
import type { PromotionRuleInput } from "../promotion-engine";

/** Load the shared condition, target, and buy-rule groups for promotions. */
export const loadPromotionRules = async (
  promotionIds: string[],
  methodIds: string[],
) => {
  const db = await getDb();
  const [promotionLinks, targetLinks, buyLinks] = await Promise.all([
    promotionIds.length
      ? db
          .select()
          .from(promotionPromotionRules)
          .where(inArray(promotionPromotionRules.promotionId, promotionIds))
      : [],
    methodIds.length
      ? db
          .select()
          .from(promotionApplicationMethodTargetRules)
          .where(
            inArray(
              promotionApplicationMethodTargetRules.applicationMethodId,
              methodIds,
            ),
          )
      : [],
    methodIds.length
      ? db
          .select()
          .from(promotionApplicationMethodBuyRules)
          .where(
            inArray(
              promotionApplicationMethodBuyRules.applicationMethodId,
              methodIds,
            ),
          )
      : [],
  ]);
  const ruleIds = [
    ...new Set([
      ...promotionLinks.map((link) => link.promotionRuleId),
      ...targetLinks.map((link) => link.promotionRuleId),
      ...buyLinks.map((link) => link.promotionRuleId),
    ]),
  ];
  const [ruleRows, valueRows] = await Promise.all([
    ruleIds.length
      ? db
          .select()
          .from(promotionRules)
          .where(
            and(
              inArray(promotionRules.id, ruleIds),
              isNull(promotionRules.deletedAt),
            ),
          )
      : [],
    ruleIds.length
      ? db
          .select()
          .from(promotionRuleValues)
          .where(
            and(
              inArray(promotionRuleValues.promotionRuleId, ruleIds),
              isNull(promotionRuleValues.deletedAt),
            ),
          )
      : [],
  ]);
  const byId = new Map<string, PromotionRuleInput>(
    ruleRows.map((rule) => [
      rule.id,
      {
        attribute: rule.attribute,
        operator: rule.operator,
        values: valueRows
          .filter((value) => value.promotionRuleId === rule.id)
          .map((value) => value.value),
      },
    ]),
  );
  const collect = (ids: string[]) =>
    ids.flatMap((id) => {
      const rule = byId.get(id);
      return rule ? [rule] : [];
    });
  return {
    promotion: new Map(
      promotionIds.map((id) => [
        id,
        collect(
          promotionLinks
            .filter((link) => link.promotionId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
    target: new Map(
      methodIds.map((id) => [
        id,
        collect(
          targetLinks
            .filter((link) => link.applicationMethodId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
    buy: new Map(
      methodIds.map((id) => [
        id,
        collect(
          buyLinks
            .filter((link) => link.applicationMethodId === id)
            .map((link) => link.promotionRuleId),
        ),
      ]),
    ),
  };
};
