import { promotionDal } from "@/lib/commerce/marketing.dal";
import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { createPromotionInputSchema, getMarketingRecordInputSchema, listPromotionsInputSchema, updateMarketingMetadataInputSchema, updatePromotionInputSchema } from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware, commerceReadMiddleware } from "../middleware/auth.middleware";

export const listPromotionCampaigns = createServerFn({ method: "GET" })
  .middleware([commerceReadMiddleware])
  .handler(async () => {
    try { return ok("Campaigns fetched successfully", { campaigns: await promotionDal.listCampaigns() }); }
    catch (error) { return failure("List promotion campaigns error", error, "LIST_FAILED", "Failed to fetch campaigns"); }
  });

export const listPromotions = createServerFn({ method: "POST" })
  .validator((data: unknown) => listPromotionsInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await promotionDal.listPage(data);
      return ok("Promotions fetched successfully", { promotions: page.promotions, pagination: paginationOf(page.total, data.page, data.limit) });
    } catch (error) { return failure("List promotions error", error, "LIST_FAILED", "Failed to fetch promotions"); }
  });

export const getPromotion = createServerFn({ method: "POST" })
  .validator((data: unknown) => getMarketingRecordInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const promotion = await promotionDal.findById(data.id);
      return promotion ? ok("Promotion fetched successfully", promotion) : fail("Promotion not found", { error: "NOT_FOUND" });
    } catch (error) { return failure("Get promotion error", error, "GET_FAILED", "Failed to fetch promotion"); }
  });

export const createPromotion = createServerFn({ method: "POST" })
  .validator((data: unknown) => createPromotionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      if (await promotionDal.findByCode(data.code)) return fail("A promotion with this code already exists", { errors: { code: ["This code is already in use"] } });
      const id = crypto.randomUUID();
      await promotionDal.create({ id, ...data });
      return ok(`Promotion ${data.code} created`, { id });
    } catch (error) { return failure("Create promotion error", error, "CREATE_FAILED", "Failed to create promotion"); }
  });

export const updatePromotion = createServerFn({ method: "POST" })
  .validator((data: unknown) => updatePromotionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const clash = await promotionDal.findByCode(data.code);
      if (clash && clash.id !== data.id) return fail("A promotion with this code already exists", { errors: { code: ["This code is already in use"] } });
      const { id, ...values } = data;
      await promotionDal.update(id, values);
      return ok("Promotion updated successfully", { id });
    } catch (error) { return failure("Update promotion error", error, "UPDATE_FAILED", "Failed to update promotion"); }
  });

export const updatePromotionMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateMarketingMetadataInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await promotionDal.updateMetadata(data.id, data.metadata);
      return ok("Promotion metadata updated successfully", { id: data.id });
    } catch (error) { return failure("Update promotion metadata error", error, "UPDATE_FAILED", "Failed to update promotion metadata"); }
  });

export const deletePromotion = createServerFn({ method: "POST" })
  .validator((data: unknown) => getMarketingRecordInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try { await promotionDal.softDelete(data.id); return ok("Promotion deleted", { id: data.id }); }
    catch (error) { return failure("Delete promotion error", error, "DELETE_FAILED", "Failed to delete promotion"); }
  });
