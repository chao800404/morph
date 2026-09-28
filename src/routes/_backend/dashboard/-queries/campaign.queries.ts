import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  manageCampaignPromotions,
  updateCampaign,
} from "@/server/marketing/campaigns.serverFn";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

const scalar = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

export const normalizeCampaignListParams = (search: DashboardSearch = {}) => ({
  query: search.q,
  status: search.campaignStatus,
  sortBy:
    scalar(search.sortBy) === "name"
      ? ("name" as const)
      : scalar(search.sortBy) === "identifier"
        ? ("identifier" as const)
        : scalar(search.sortBy) === "updatedAt"
          ? ("updatedAt" as const)
          : ("createdAt" as const),
  sortOrder: scalar(search.sortOrder) ?? ("desc" as const),
  page: Number(search.page) || 1,
  limit: Number(search.limit) || 20,
});

export const campaignQueries = {
  all: () => ["campaigns"] as const,
  list: (params: ReturnType<typeof normalizeCampaignListParams>) =>
    queryOptions({
      queryKey: [...campaignQueries.all(), "list", params],
      queryFn: () => listCampaigns({ data: params }),
      placeholderData: keepPreviousData,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...campaignQueries.all(), "detail", id],
      queryFn: () => getCampaign({ data: { id } }),
    }),
  create: createCampaign,
  update: updateCampaign,
  delete: deleteCampaign,
  managePromotions: manageCampaignPromotions,
};
