import { z } from "zod";

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const dateValue = z.string().trim().max(100).optional().default("");
const amount = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
);

const campaignBudgetSchema = z
  .object({
    type: z.enum(["usage", "spend", "use_by_attribute", "spend_by_attribute"]),
    limit: amount.optional(),
    currencyCode: z.string().trim().max(3).optional().default(""),
    attribute: z.enum(["customer_id", "email"]).optional(),
  })
  .superRefine((budget, context) => {
    const requiresCurrency =
      budget.type === "spend" || budget.type === "spend_by_attribute";
    const requiresAttribute =
      budget.type === "use_by_attribute" ||
      budget.type === "spend_by_attribute";
    if (requiresCurrency && budget.currencyCode.length !== 3) {
      context.addIssue({
        code: "custom",
        path: ["currencyCode"],
        message: "Enter a three-letter currency code for a spend budget",
      });
    }
    if (requiresAttribute && !budget.attribute) {
      context.addIssue({
        code: "custom",
        path: ["attribute"],
        message: "Choose whether the budget is tracked by customer or email",
      });
    }
  });

const validateCampaignDates = (
  campaign: { startsAt?: string; endsAt?: string },
  context: z.RefinementCtx,
) => {
  const start = campaign.startsAt
    ? new Date(campaign.startsAt).getTime()
    : null;
  const end = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;
  if (start !== null && !Number.isFinite(start)) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Enter a valid start date",
    });
  }
  if (end !== null && !Number.isFinite(end)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Enter a valid end date",
    });
  }
  if (start !== null && end !== null && end < start) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "End date must be after the start date",
    });
  }
};

const campaignFields = z.object({
  name: z.string().trim().min(1).max(200),
  identifier: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional().default(""),
  startsAt: dateValue,
  endsAt: dateValue,
});

export const listCampaignsInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(["active", "scheduled", "expired"]).optional(),
  sortBy: z
    .enum(["name", "identifier", "createdAt", "updatedAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page,
  limit,
});

export const campaignIdInputSchema = z.object({ id: z.uuid() });

export const createCampaignInputSchema = campaignFields
  .extend({ budget: campaignBudgetSchema.nullable().optional() })
  .superRefine(validateCampaignDates);

export const updateCampaignInputSchema = campaignFields
  .partial()
  .extend({
    id: z.uuid(),
    budgetLimit: amount.optional(),
  })
  .superRefine(validateCampaignDates);

export const manageCampaignPromotionsInputSchema = z
  .object({
    id: z.uuid(),
    add: z.array(z.uuid()).max(20).default([]),
    remove: z.array(z.uuid()).max(20).default([]),
  })
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["add", value.add],
      ["remove", value.remove],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Promotion IDs must be unique",
        });
      }
    }
    if (value.add.some((id) => value.remove.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["add"],
        message: "A promotion cannot be added and removed at the same time",
      });
    }
  });
