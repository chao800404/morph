import type { CampaignBudgetType } from "@/db/promotion.schema";

export interface CampaignBudgetDTO {
  id: string;
  type: CampaignBudgetType;
  currencyCode: string | null;
  limit: number | null;
  used: number;
  attribute: string | null;
}

export interface CampaignDTO {
  id: string;
  name: string;
  description: string | null;
  identifier: string;
  startsAt: string | null;
  endsAt: string | null;
  budget: CampaignBudgetDTO | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
