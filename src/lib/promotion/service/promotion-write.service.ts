import type { Metadata } from "@/db/json";
import { promotionDal } from "@/lib/promotion/dal/promotion.dal";
import { SHIPPING_OPTION_TYPE_TARGET_RULE_ATTRIBUTE } from "@/lib/promotion/promotion-engine";
import { shippingOptionTypeDal } from "@/lib/shipping/dal/shipping-option-type.dal";
import type { createPromotionInputSchema } from "@/lib/validations/marketing";
import type { z } from "zod";

export type PromotionWriteInput = z.infer<typeof createPromotionInputSchema>;

export type PromotionWriteFailure = {
  success: false;
  error:
    | "DUPLICATE_CODE"
    | "INVALID_TARGET_RULES"
    | "INACTIVE_SHIPPING_OPTION_TYPE"
    | "INVALID_CAMPAIGN"
    | "DUPLICATE_CAMPAIGN_IDENTIFIER"
    | "NOT_FOUND";
  message: string;
  field?: "code" | "targetRules" | "campaign";
};

const validateShippingRules = async (
  data: PromotionWriteInput,
): Promise<PromotionWriteFailure | null> => {
  const hasShippingOptionTypeRule = data.targetRules.some(
    (rule) => rule.attribute === SHIPPING_OPTION_TYPE_TARGET_RULE_ATTRIBUTE,
  );
  if (data.targetType === "shipping_methods" && data.targetRules.length > 0) {
    if (
      data.targetRules.some(
        (rule) =>
          rule.attribute !== SHIPPING_OPTION_TYPE_TARGET_RULE_ATTRIBUTE ||
          (rule.operator !== "in" && rule.operator !== "ne"),
      )
    ) {
      return {
        success: false,
        error: "INVALID_TARGET_RULES",
        field: "targetRules",
        message:
          "Shipping method targets support Shipping Option Type with In or Not in.",
      };
    }
    const activeTypeIds = new Set(
      (await shippingOptionTypeDal.listActiveChoices()).map((type) => type.id),
    );
    if (
      data.targetRules.some((rule) =>
        rule.values.some((value) => !activeTypeIds.has(value)),
      )
    ) {
      return {
        success: false,
        error: "INACTIVE_SHIPPING_OPTION_TYPE",
        field: "targetRules",
        message: "Choose active shipping option types and retry.",
      };
    }
  } else if (hasShippingOptionTypeRule) {
    return {
      success: false,
      error: "INVALID_TARGET_RULES",
      field: "targetRules",
      message:
        "Choose Shipping methods as the promotion target for this condition.",
    };
  }
  return null;
};

export const promotionWriteService = {
  async create(
    data: PromotionWriteInput,
    metadata?: Metadata,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure> {
    if (
      data.campaignId &&
      !(await promotionDal.findActiveCampaignById(data.campaignId))
    )
      return {
        success: false,
        error: "INVALID_CAMPAIGN",
        field: "campaign",
        message: "The selected campaign is unavailable",
      };
    if (
      data.campaign &&
      (await promotionDal.findActiveCampaignByIdentifier(
        data.campaign.identifier,
      ))
    )
      return {
        success: false,
        error: "DUPLICATE_CAMPAIGN_IDENTIFIER",
        field: "campaign",
        message: "A campaign with this identifier already exists",
      };
    if (await promotionDal.findByCode(data.code))
      return {
        success: false,
        error: "DUPLICATE_CODE",
        field: "code",
        message: "A promotion with this code already exists",
      };
    const invalidRules = await validateShippingRules(data);
    if (invalidRules) return invalidRules;
    const id = crypto.randomUUID();
    await promotionDal.create({
      id,
      ...data,
      ...(metadata ? { metadata } : {}),
    });
    return { success: true, id };
  },

  async update(
    id: string,
    data: PromotionWriteInput,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure> {
    const current = await promotionDal.findById(id);
    if (!current)
      return {
        success: false,
        error: "NOT_FOUND",
        message: "Promotion not found",
      };
    if (
      data.campaignId &&
      !(await promotionDal.findActiveCampaignById(data.campaignId))
    )
      return {
        success: false,
        error: "INVALID_CAMPAIGN",
        field: "campaign",
        message: "The selected campaign is unavailable",
      };
    if (
      data.campaign &&
      (await promotionDal.findActiveCampaignByIdentifier(
        data.campaign.identifier,
        current?.campaign?.id,
      ))
    )
      return {
        success: false,
        error: "DUPLICATE_CAMPAIGN_IDENTIFIER",
        field: "campaign",
        message: "A campaign with this identifier already exists",
      };
    const clash = await promotionDal.findByCode(data.code);
    if (clash && clash.id !== id)
      return {
        success: false,
        error: "DUPLICATE_CODE",
        field: "code",
        message: "A promotion with this code already exists",
      };
    const invalidRules = await validateShippingRules(data);
    if (invalidRules) return invalidRules;
    const updated = await promotionDal.update(id, data);
    return updated
      ? { success: true, id }
      : {
          success: false,
          error: "NOT_FOUND",
          message: "Promotion not found",
        };
  },

  async delete(
    id: string,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure> {
    if (!(await promotionDal.findById(id)))
      return {
        success: false,
        error: "NOT_FOUND",
        message: "Promotion not found",
      };
    await promotionDal.softDelete(id);
    return { success: true, id };
  },
};
