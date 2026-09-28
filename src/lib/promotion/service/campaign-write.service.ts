import type {
  CampaignBudgetWrite,
  CampaignCreateWrite,
  CampaignUpdateWrite,
} from "@/lib/promotion/dal/campaign.dal";
import { campaignDal } from "@/lib/promotion/dal/campaign.dal";

export type CampaignWriteFailure = {
  success: false;
  error:
    | "NOT_FOUND"
    | "DUPLICATE_IDENTIFIER"
    | "INVALID_DATE"
    | "INVALID_BUDGET"
    | "BUDGET_NOT_FOUND"
    | "BUDGET_LIMIT_BELOW_USED"
    | "PROMOTION_UNAVAILABLE";
  message: string;
};

const toTimestamp = (
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined || value === null) return value;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return undefined;
  return timestamp.toISOString();
};

const validateDates = (
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
):
  | {
      success: true;
      startsAt: string | null | undefined;
      endsAt: string | null | undefined;
    }
  | CampaignWriteFailure => {
  const normalizedStart = toTimestamp(startsAt);
  const normalizedEnd = toTimestamp(endsAt);
  if (
    startsAt !== undefined &&
    startsAt !== null &&
    normalizedStart === undefined
  )
    return {
      success: false,
      error: "INVALID_DATE",
      message: "Campaign start date must be a valid date and time.",
    };
  if (endsAt !== undefined && endsAt !== null && normalizedEnd === undefined)
    return {
      success: false,
      error: "INVALID_DATE",
      message: "Campaign end date must be a valid date and time.",
    };
  if (
    normalizedStart &&
    normalizedEnd &&
    new Date(normalizedEnd).getTime() < new Date(normalizedStart).getTime()
  )
    return {
      success: false,
      error: "INVALID_DATE",
      message: "Campaign end date must be after its start date.",
    };
  return { success: true, startsAt: normalizedStart, endsAt: normalizedEnd };
};

const validateBudget = (
  budget: CampaignBudgetWrite | undefined,
): CampaignWriteFailure | null => {
  if (!budget) return null;
  const requiresCurrency =
    budget.type === "spend" || budget.type === "spend_by_attribute";
  const requiresAttribute =
    budget.type === "use_by_attribute" || budget.type === "spend_by_attribute";
  if (requiresCurrency && !budget.currencyCode?.trim())
    return {
      success: false,
      error: "INVALID_BUDGET",
      message: "Spend budgets require a currency code.",
    };
  if (
    requiresAttribute &&
    budget.attribute !== "customer_id" &&
    budget.attribute !== "email"
  )
    return {
      success: false,
      error: "INVALID_BUDGET",
      message:
        "Per-customer budgets require the customer_id or email attribute.",
    };
  if (!requiresAttribute && budget.attribute)
    return {
      success: false,
      error: "INVALID_BUDGET",
      message: "Only per-customer budgets can set an attribute.",
    };
  if (!requiresCurrency && budget.currencyCode)
    return {
      success: false,
      error: "INVALID_BUDGET",
      message: "Only spend budgets can set a currency code.",
    };
  return null;
};

export const campaignWriteService = {
  async create(
    input: Omit<CampaignCreateWrite, "id">,
  ): Promise<{ success: true; id: string } | CampaignWriteFailure> {
    const dates = validateDates(input.startsAt, input.endsAt);
    if (!dates.success) return dates;
    const budgetFailure = validateBudget(input.budget);
    if (budgetFailure) return budgetFailure;
    if (await campaignDal.findActiveByIdentifier(input.identifier))
      return {
        success: false,
        error: "DUPLICATE_IDENTIFIER",
        message: "A campaign with this identifier already exists.",
      };
    const id = crypto.randomUUID();
    await campaignDal.create({
      ...input,
      id,
      ...(dates.startsAt === undefined ? {} : { startsAt: dates.startsAt }),
      ...(dates.endsAt === undefined ? {} : { endsAt: dates.endsAt }),
      budget: input.budget
        ? {
            ...input.budget,
            currencyCode: input.budget.currencyCode?.toLowerCase() ?? null,
          }
        : undefined,
    });
    return { success: true, id };
  },

  async update(
    id: string,
    input: Omit<CampaignUpdateWrite, "id">,
  ): Promise<{ success: true; id: string } | CampaignWriteFailure> {
    const current = await campaignDal.findById(id);
    if (!current)
      return {
        success: false,
        error: "NOT_FOUND",
        message: "Campaign not found.",
      };
    if (
      input.identifier &&
      (await campaignDal.findActiveByIdentifier(input.identifier, id))
    )
      return {
        success: false,
        error: "DUPLICATE_IDENTIFIER",
        message: "A campaign with this identifier already exists.",
      };
    const startsAt =
      input.startsAt === undefined ? current.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    const dates = validateDates(startsAt, endsAt);
    if (!dates.success) return dates;
    if (input.budgetLimit !== undefined) {
      if (!current.budget)
        return {
          success: false,
          error: "BUDGET_NOT_FOUND",
          message: "This campaign does not have a budget to update.",
        };
      if (input.budgetLimit !== null && input.budgetLimit < current.budget.used)
        return {
          success: false,
          error: "BUDGET_LIMIT_BELOW_USED",
          message: "The budget limit cannot be lower than its current usage.",
        };
    }
    const updated = await campaignDal.update({
      id,
      ...input,
      ...(input.startsAt === undefined ? {} : { startsAt: dates.startsAt }),
      ...(input.endsAt === undefined ? {} : { endsAt: dates.endsAt }),
    });
    return updated
      ? { success: true, id }
      : {
          success: false,
          error: "NOT_FOUND",
          message: "Campaign not found.",
        };
  },

  async delete(
    id: string,
  ): Promise<{ success: true; id: string } | CampaignWriteFailure> {
    if (!(await campaignDal.findById(id)))
      return {
        success: false,
        error: "NOT_FOUND",
        message: "Campaign not found.",
      };
    await campaignDal.softDelete(id);
    return { success: true, id };
  },

  async managePromotions(
    id: string,
    input: { add: string[]; remove: string[] },
  ): Promise<{ success: true; id: string } | CampaignWriteFailure> {
    const result = await campaignDal.managePromotions(id, input);
    if (!result.success)
      return result.error === "NOT_FOUND"
        ? {
            success: false,
            error: "NOT_FOUND",
            message: "Campaign not found.",
          }
        : {
            success: false,
            error: "PROMOTION_UNAVAILABLE",
            message:
              "Promotions must exist, be active, and not belong to another campaign.",
          };
    return { success: true, id };
  },
};
