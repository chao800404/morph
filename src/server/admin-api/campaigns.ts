import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import type { CampaignBudgetType } from "@/db/promotion.schema";
import type { CampaignWriteFailure } from "@/lib/promotion/service/campaign-write.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminCampaignsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listCampaigns(input: {
    query?: string;
    identifier?: string;
    offset: number;
    limit: number;
    sortBy: "name" | "identifier" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
  }): Promise<{ campaigns: CampaignDTO[]; total: number }>;
  findCampaign(id: string): Promise<CampaignDTO | null>;
  createCampaign(input: {
    name: string;
    description?: string | null;
    identifier: string;
    startsAt?: string | null;
    endsAt?: string | null;
    budget?: {
      type: CampaignBudgetType;
      limit?: number | null;
      currencyCode?: string | null;
      attribute?: string | null;
    };
  }): Promise<{ success: true; id: string } | CampaignWriteFailure>;
  updateCampaign(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      identifier?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      budgetLimit?: number | null;
    },
  ): Promise<{ success: true; id: string } | CampaignWriteFailure>;
  deleteCampaign(
    id: string,
  ): Promise<{ success: true; id: string } | CampaignWriteFailure>;
  managePromotions(
    id: string,
    input: { add: string[]; remove: string[] },
  ): Promise<{ success: true; id: string } | CampaignWriteFailure>;
};

const budgetTypes = [
  "spend",
  "usage",
  "use_by_attribute",
  "spend_by_attribute",
] as const satisfies readonly CampaignBudgetType[];

const dateInput = z.string().trim().min(1).max(100).nullable().optional();

const createBudgetSchema = z
  .object({
    type: z.enum(budgetTypes),
    limit: z.number().int().min(0).nullable().optional(),
    currency_code: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
    attribute: z.enum(["customer_id", "email"]).nullable().optional(),
  })
  .strict();

const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    campaign_identifier: z.string().trim().min(1).max(200),
    starts_at: dateInput,
    ends_at: dateInput,
    budget: createBudgetSchema.optional(),
  })
  .strict();

const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    campaign_identifier: z.string().trim().min(1).max(200).optional(),
    starts_at: dateInput,
    ends_at: dateInput,
    // Medusa permits changing the limit, while budget type, currency, and
    // per-customer attribute remain immutable after campaign creation.
    budget: z
      .object({ limit: z.number().int().min(0).nullable().optional() })
      .strict()
      .optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    campaign_identifier: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "name",
        "-name",
        "campaign_identifier",
        "-campaign_identifier",
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    identifier: input.campaign_identifier || undefined,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("campaign_identifier")
      ? ("identifier" as const)
      : input.order.includes("name")
        ? ("name" as const)
        : input.order.includes("updated_at")
          ? ("updatedAt" as const)
          : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const managePromotionsSchema = z
  .object({
    add: z.array(z.uuid()).max(20).default([]),
    remove: z.array(z.uuid()).max(20).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.add).size !== input.add.length ||
      new Set(input.remove).size !== input.remove.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["add"],
        message: "A promotion may only appear once in a batch.",
      });
    }
    if (input.add.some((id) => input.remove.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["remove"],
        message: "A promotion cannot be added and removed in the same batch.",
      });
    }
  });

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const authorizeAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId?: string; role?: string } =>
  Boolean(access.allowed && access.role === "admin");

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const campaignToApi = (campaign: CampaignDTO) => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  campaign_identifier: campaign.identifier,
  starts_at: campaign.startsAt,
  ends_at: campaign.endsAt,
  budget: campaign.budget
    ? {
        id: campaign.budget.id,
        type: campaign.budget.type,
        currency_code: campaign.budget.currencyCode,
        limit: campaign.budget.limit,
        used: campaign.budget.used,
        attribute: campaign.budget.attribute,
      }
    : null,
  created_at: campaign.createdAt,
  updated_at: campaign.updatedAt,
  deleted_at: campaign.deletedAt,
});

const inputError = (
  message: string,
  details: Record<string, string[] | undefined>,
) => privateJson({ error: "INVALID_REQUEST", message, details }, 400);

const writeFailure = (result: CampaignWriteFailure) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_IDENTIFIER" ||
          result.error === "BUDGET_NOT_FOUND" ||
          result.error === "BUDGET_LIMIT_BELOW_USED" ||
          result.error === "PROMOTION_UNAVAILABLE"
        ? 409
        : 400;
  return routeError(result.error, result.message, status);
};

/** Medusa-shaped campaign endpoints using Morph's promotion module and D1 DAL. */
export async function handleAdminCampaignsRequest(
  request: Request,
  dependencies: AdminCampaignsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  const itemMatch = /^campaigns\/([^/]+)$/.exec(path);
  const promotionsMatch = /^campaigns\/([^/]+)\/promotions$/.exec(path);

  if (path === "campaigns" && request.method === "GET") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return inputError(
        "Invalid campaign query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.listCampaigns(parsed.data);
      return privateJson({
        campaigns: result.campaigns.map(campaignToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Campaigns could not be loaded", 500);
    }
  }

  if (path === "campaigns" && request.method === "POST") {
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = createCampaignSchema.safeParse(rawBody);
    if (!parsed.success)
      return inputError(
        "Invalid campaign fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.createCampaign({
        name: parsed.data.name,
        description: parsed.data.description,
        identifier: parsed.data.campaign_identifier,
        startsAt: parsed.data.starts_at,
        endsAt: parsed.data.ends_at,
        budget: parsed.data.budget
          ? {
              type: parsed.data.budget.type,
              limit: parsed.data.budget.limit,
              currencyCode: parsed.data.budget.currency_code,
              attribute: parsed.data.budget.attribute,
            }
          : undefined,
      });
      if (!result.success) return writeFailure(result);
      const campaign = await dependencies.findCampaign(result.id);
      return campaign
        ? privateJson({ campaign: campaignToApi(campaign) })
        : routeError(
            "INTERNAL_ERROR",
            "Created campaign could not be loaded",
            500,
          );
    } catch {
      return routeError("INTERNAL_ERROR", "Campaign could not be created", 500);
    }
  }

  if (promotionsMatch && request.method === "POST") {
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const campaignId = z.uuid().safeParse(promotionsMatch[1] ?? "");
    if (!campaignId.success)
      return routeError("INVALID_REQUEST", "Invalid campaign ID", 400);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = managePromotionsSchema.safeParse(rawBody);
    if (!parsed.success)
      return inputError(
        "Invalid campaign promotion batch",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.managePromotions(
        campaignId.data,
        parsed.data,
      );
      if (!result.success) return writeFailure(result);
      const campaign = await dependencies.findCampaign(campaignId.data);
      return campaign
        ? privateJson({ campaign: campaignToApi(campaign) })
        : routeError("NOT_FOUND", "Campaign not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Campaign promotions could not be updated",
        500,
      );
    }
  }

  if (itemMatch) {
    const campaignId = z.uuid().safeParse(itemMatch[1] ?? "");
    if (!campaignId.success)
      return routeError("INVALID_REQUEST", "Invalid campaign ID", 400);
    if (request.method === "GET") {
      try {
        const campaign = await dependencies.findCampaign(campaignId.data);
        return campaign
          ? privateJson({ campaign: campaignToApi(campaign) })
          : routeError("NOT_FOUND", "Campaign not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Campaign could not be loaded",
          500,
        );
      }
    }
    if (request.method === "POST") {
      if (!authorizeAdmin(access))
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const parsed = updateCampaignSchema.safeParse(rawBody);
      if (!parsed.success)
        return inputError(
          "Invalid campaign fields",
          parsed.error.flatten().fieldErrors,
        );
      try {
        const result = await dependencies.updateCampaign(campaignId.data, {
          name: parsed.data.name,
          description: parsed.data.description,
          identifier: parsed.data.campaign_identifier,
          startsAt: parsed.data.starts_at,
          endsAt: parsed.data.ends_at,
          ...(parsed.data.budget === undefined
            ? {}
            : { budgetLimit: parsed.data.budget.limit }),
        });
        if (!result.success) return writeFailure(result);
        const campaign = await dependencies.findCampaign(campaignId.data);
        return campaign
          ? privateJson({ campaign: campaignToApi(campaign) })
          : routeError("NOT_FOUND", "Campaign not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Campaign could not be updated",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      if (!authorizeAdmin(access))
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      try {
        const result = await dependencies.deleteCampaign(campaignId.data);
        if (!result.success) return writeFailure(result);
        return privateJson({
          id: campaignId.data,
          object: "campaign",
          deleted: true,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Campaign could not be deleted",
          500,
        );
      }
    }
  }

  if (path === "campaigns" || itemMatch || promotionsMatch) {
    const allow = itemMatch
      ? "GET, POST, DELETE"
      : promotionsMatch
        ? "POST"
        : "GET, POST";
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: `Use ${allow}` }),
      {
        status: 405,
        headers: {
          allow,
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
