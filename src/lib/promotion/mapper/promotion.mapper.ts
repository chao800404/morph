import {
  promotionApplicationMethods,
  promotionCampaigns,
  promotionRules,
  promotions,
} from "@/db/promotion.schema";
import type {
  PromotionCampaignDTO,
  PromotionDetailDTO,
  PromotionListDTO,
  PromotionRuleDTO,
} from "../dto/promotion.dto";

export const toPromotionListDTO = (row: {
  promotion: typeof promotions.$inferSelect;
  method: typeof promotionApplicationMethods.$inferSelect | null;
}): PromotionListDTO => ({
  id: row.promotion.id,
  code: row.promotion.code,
  type: row.promotion.type,
  status: row.promotion.status,
  isAutomatic: row.promotion.isAutomatic,
  limit: row.promotion.limit,
  used: row.promotion.used,
  methodType: row.method?.type ?? null,
  targetType: row.method?.targetType ?? null,
  value: row.method?.value ?? null,
  currencyCode: row.method?.currencyCode ?? null,
  updatedAt: row.promotion.updatedAt,
});

export const toPromotionRuleDTOs = (
  rows: Array<{
    rule: typeof promotionRules.$inferSelect;
    value: string | null;
  }>,
): PromotionRuleDTO[] => {
  const grouped = new Map<string, PromotionRuleDTO>();
  for (const { rule, value } of rows) {
    const current = grouped.get(rule.id) ?? {
      attribute: rule.attribute,
      operator: rule.operator,
      values: [],
    };
    if (value !== null) current.values.push(value);
    grouped.set(rule.id, current);
  }
  return [...grouped.values()];
};

export const toPromotionCampaignDTO = (
  campaign: typeof promotionCampaigns.$inferSelect,
): PromotionCampaignDTO => ({
  id: campaign.id,
  name: campaign.name,
  identifier: campaign.campaignIdentifier,
  startsAt: campaign.startsAt,
  endsAt: campaign.endsAt,
});

export const toPromotionDetailDTO = ({
  row,
  rules,
  targetRules,
  buyRules,
}: {
  row: {
    promotion: typeof promotions.$inferSelect;
    method: typeof promotionApplicationMethods.$inferSelect | null;
    campaign: typeof promotionCampaigns.$inferSelect | null;
  };
  rules: PromotionRuleDTO[];
  targetRules: PromotionRuleDTO[];
  buyRules: PromotionRuleDTO[];
}): PromotionDetailDTO => ({
  ...toPromotionListDTO(row),
  metadata: row.promotion.metadata ?? {},
  isTaxInclusive: row.promotion.isTaxInclusive,
  allocation: row.method?.allocation ?? null,
  maxQuantity: row.method?.maxQuantity ?? null,
  applyToQuantity: row.method?.applyToQuantity ?? null,
  buyRulesMinQuantity: row.method?.buyRulesMinQuantity ?? null,
  rules,
  targetRules,
  buyRules,
  campaign: row.campaign
    ? {
        ...toPromotionCampaignDTO(row.campaign),
        description: row.campaign.description,
      }
    : null,
  createdAt: row.promotion.createdAt,
});
