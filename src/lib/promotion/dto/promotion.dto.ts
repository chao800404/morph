import type { Metadata } from "@/db/json";
import type {
  ApplicationMethodAllocation,
  ApplicationMethodTargetType,
  ApplicationMethodType,
  PromotionStatus as DbPromotionStatus,
  PromotionType,
} from "@/db/schema";

export type PromotionStatus = DbPromotionStatus;

export interface PromotionListDTO {
  id: string;
  code: string;
  type: PromotionType;
  status: PromotionStatus;
  isAutomatic: boolean;
  limit: number | null;
  used: number;
  methodType: ApplicationMethodType | null;
  targetType: ApplicationMethodTargetType | null;
  value: number | null;
  currencyCode: string | null;
  updatedAt: string;
}

export interface PromotionDetailDTO extends PromotionListDTO {
  metadata: Metadata;
  isTaxInclusive: boolean;
  allocation: ApplicationMethodAllocation | null;
  maxQuantity: number | null;
  applyToQuantity: number | null;
  buyRulesMinQuantity: number | null;
  rules: PromotionRuleDTO[];
  targetRules: PromotionRuleDTO[];
  buyRules: PromotionRuleDTO[];
  campaign: {
    id: string;
    name: string;
    description: string | null;
    identifier: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  createdAt: string;
}

export interface PromotionRuleDTO {
  attribute: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "in";
  values: string[];
}

export interface PromotionCampaignDTO {
  id: string;
  name: string;
  identifier: string;
  startsAt: string | null;
  endsAt: string | null;
}
