import { campaignDal } from "@/lib/promotion/dal/campaign.dal";
import { campaignWriteService } from "@/lib/promotion/service/campaign-write.service";
import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import {
  campaignIdInputSchema,
  createCampaignInputSchema,
  listCampaignsInputSchema,
  manageCampaignPromotionsInputSchema,
  updateCampaignInputSchema,
} from "@/lib/validations/campaign";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listCampaigns = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listCampaignsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await campaignDal.listPage({
        ...input.data,
        offset: (input.data.page - 1) * input.data.limit,
      });
      return ok("Campaigns fetched successfully", {
        campaigns: result.campaigns,
        pagination: paginationOf(
          result.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List campaigns error",
        error,
        "LIST_FAILED",
        "Failed to fetch campaigns",
      );
    }
  });

export const getCampaign = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(campaignIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const campaign = await campaignDal.findById(input.data.id);
      return campaign
        ? ok("Campaign fetched successfully", campaign)
        : fail("Campaign not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get campaign error",
        error,
        "GET_FAILED",
        "Failed to fetch campaign",
      );
    }
  });

export const createCampaign = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createCampaignInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { startsAt, endsAt, budget, ...campaign } = input.data;
      const result = await campaignWriteService.create({
        ...campaign,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        ...(budget ? { budget } : {}),
      });
      return result.success
        ? ok("Campaign created successfully", { id: result.id })
        : fail(result.message, { error: result.error });
    } catch (error) {
      return failure(
        "Create campaign error",
        error,
        "CREATE_FAILED",
        "Failed to create campaign",
      );
    }
  });

export const updateCampaign = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateCampaignInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { id, startsAt, endsAt, ...campaign } = input.data;
      const result = await campaignWriteService.update(id, {
        ...campaign,
        ...(startsAt === undefined ? {} : { startsAt: startsAt || null }),
        ...(endsAt === undefined ? {} : { endsAt: endsAt || null }),
      });
      return result.success
        ? ok("Campaign updated successfully", { id: result.id })
        : fail(result.message, { error: result.error });
    } catch (error) {
      return failure(
        "Update campaign error",
        error,
        "UPDATE_FAILED",
        "Failed to update campaign",
      );
    }
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(campaignIdInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await campaignWriteService.delete(input.data.id);
      return result.success
        ? ok("Campaign deleted successfully", { id: result.id })
        : fail(result.message, { error: result.error });
    } catch (error) {
      return failure(
        "Delete campaign error",
        error,
        "DELETE_FAILED",
        "Failed to delete campaign",
      );
    }
  });

export const manageCampaignPromotions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(manageCampaignPromotionsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { id, ...changes } = input.data;
      const result = await campaignWriteService.managePromotions(id, changes);
      return result.success
        ? ok("Campaign promotions updated successfully", { id: result.id })
        : fail(result.message, { error: result.error });
    } catch (error) {
      return failure(
        "Manage campaign promotions error",
        error,
        "UPDATE_FAILED",
        "Failed to update campaign promotions",
      );
    }
  });
