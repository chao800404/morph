import type { Metadata, JsonValue } from "@/db/json";
import type {
  PromotionDetailDTO,
  PromotionListDTO,
  PromotionRuleDTO,
} from "@/lib/promotion/dto/promotion.dto";
import type {
  PromotionRuleBatchInput,
  PromotionRuleBatchResult,
  PromotionRuleScope,
} from "@/lib/promotion/dal/promotion.dal";
import type {
  PromotionWriteFailure,
  PromotionWriteInput,
} from "@/lib/promotion/service/promotion-write.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export type AdminPromotionsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listPromotions(input: {
    query?: string;
    campaignId?: string;
    type?: "standard" | "buyget";
    status?: "draft" | "active" | "inactive";
    isAutomatic?: boolean;
    sortBy: "code" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ promotions: PromotionListDTO[]; total: number }>;
  findPromotion(id: string): Promise<PromotionDetailDTO | null>;
  createPromotion(
    input: PromotionWriteInput,
    metadata?: Metadata,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure>;
  updatePromotion(
    id: string,
    input: PromotionWriteInput,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure>;
  deletePromotion(
    id: string,
  ): Promise<{ success: true; id: string } | PromotionWriteFailure>;
  batchRules(
    id: string,
    scope: PromotionRuleScope,
    input: PromotionRuleBatchInput,
  ): Promise<PromotionRuleBatchResult>;
};

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    campaign_id: z.uuid().optional(),
    type: z.enum(["standard", "buyget"]).optional(),
    status: z.enum(["draft", "active", "inactive"]).optional(),
    is_automatic: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "code",
        "-code",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    campaignId: input.campaign_id,
    type: input.type,
    status: input.status,
    isAutomatic: input.is_automatic,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("code")
        ? ("code" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const metadataSchema = z
  .record(z.string().trim().min(1).max(100), jsonValueSchema)
  .refine((value) => Object.keys(value).length <= 50);

const ruleInputSchema = z
  .object({
    description: z.string().trim().max(500).nullable().optional(),
    attribute: z.string().trim().min(1).max(200),
    operator: z.enum(["gte", "lte", "gt", "lt", "eq", "ne", "in"]),
    values: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })
  .strict();

const applicationMethodCreateSchema = z
  .object({
    type: z.enum(["fixed", "percentage"]),
    target_type: z.enum(["order", "shipping_methods", "items"]),
    allocation: z.enum(["each", "across", "once"]).default("across"),
    value: z.number().finite().min(0),
    currency_code: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
    max_quantity: z.number().int().min(1).nullable().optional(),
    apply_to_quantity: z.number().int().min(1).nullable().optional(),
    buy_rules_min_quantity: z.number().int().min(1).nullable().optional(),
    target_rules: z.array(ruleInputSchema).max(20).default([]),
    buy_rules: z.array(ruleInputSchema).max(20).default([]),
  })
  .strict();

const applicationMethodPatchSchema = z
  .object({
    type: z.enum(["fixed", "percentage"]).optional(),
    target_type: z.enum(["order", "shipping_methods", "items"]).optional(),
    allocation: z.enum(["each", "across", "once"]).nullable().optional(),
    value: z.number().finite().min(0).optional(),
    currency_code: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toLowerCase())
      .nullable()
      .optional(),
    max_quantity: z.number().int().min(1).nullable().optional(),
    apply_to_quantity: z.number().int().min(1).nullable().optional(),
    buy_rules_min_quantity: z.number().int().min(1).nullable().optional(),
    target_rules: z.array(ruleInputSchema).max(20).optional(),
    buy_rules: z.array(ruleInputSchema).max(20).optional(),
  })
  .strict();

const campaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).optional(),
    campaign_identifier: z.string().trim().min(1).max(200),
    starts_at: z.string().max(100).optional(),
    ends_at: z.string().max(100).optional(),
    budget: z
      .object({
        type: z.enum([
          "spend",
          "usage",
          "use_by_attribute",
          "spend_by_attribute",
        ]),
        limit: z.number().finite().min(0).optional(),
        currency_code: z
          .string()
          .trim()
          .length(3)
          .transform((value) => value.toLowerCase())
          .optional(),
        attribute: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const createBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value) => value.toUpperCase()),
    type: z.enum(["standard", "buyget"]),
    status: z.enum(["draft", "active", "inactive"]).default("draft"),
    is_automatic: z.boolean().default(false),
    is_tax_inclusive: z.boolean().default(false),
    limit: z.number().int().min(1).optional(),
    campaign_id: z.uuid().optional(),
    campaign: campaignBodySchema.optional(),
    application_method: applicationMethodCreateSchema,
    rules: z.array(ruleInputSchema).max(20).default([]),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.campaign && input.campaign_id) {
      context.addIssue({
        code: "custom",
        path: ["campaign_id"],
        message: "Choose an existing campaign or create a campaign, not both",
      });
    }
  });

const updateBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value) => value.toUpperCase())
      .optional(),
    type: z.enum(["standard", "buyget"]).optional(),
    status: z.enum(["draft", "active", "inactive"]).optional(),
    is_automatic: z.boolean().optional(),
    is_tax_inclusive: z.boolean().optional(),
    limit: z.number().int().min(1).nullable().optional(),
    campaign_id: z.uuid().optional(),
    application_method: applicationMethodPatchSchema.optional(),
  })
  .strict();

const batchRulesBodySchema = z
  .object({
    create: z.array(ruleInputSchema).max(20).optional(),
    update: z
      .array(ruleInputSchema.extend({ id: z.uuid() }).strict())
      .max(20)
      .optional(),
    delete: z.array(z.uuid()).max(20).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const updateIds = (input.update ?? []).map((rule) => rule.id);
    const deleteIds = input.delete ?? [];
    const allIds = [...updateIds, ...deleteIds];
    if (allIds.length > 20) {
      context.addIssue({
        code: "custom",
        path: ["update"],
        message: "A rule batch may update or delete at most 20 existing rules",
      });
    }
    if (new Set(allIds).size !== allIds.length) {
      context.addIssue({
        code: "custom",
        path: ["update"],
        message: "A rule may only appear once in a batch",
      });
    }
    if ((input.create?.length ?? 0) + allIds.length > 20) {
      context.addIssue({
        code: "custom",
        path: ["create"],
        message: "A batch may contain at most 20 rule operations",
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
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const listPromotionToApi = (promotion: PromotionListDTO) => ({
  id: promotion.id,
  code: promotion.code,
  type: promotion.type,
  status: promotion.status,
  is_automatic: promotion.isAutomatic,
  limit: promotion.limit,
  used: promotion.used,
  application_method:
    promotion.methodType && promotion.targetType
      ? {
          ...(promotion.applicationMethodId
            ? { id: promotion.applicationMethodId }
            : {}),
          type: promotion.methodType,
          target_type: promotion.targetType,
          value: promotion.value,
          currency_code: promotion.currencyCode,
        }
      : null,
  updated_at: promotion.updatedAt,
});

const ruleToApi = (rule: PromotionRuleDTO) => ({
  ...(rule.id ? { id: rule.id } : {}),
  ...(rule.description !== undefined ? { description: rule.description } : {}),
  attribute: rule.attribute,
  operator: rule.operator,
  values: rule.values,
});

const promotionToApi = (promotion: PromotionDetailDTO) => ({
  ...listPromotionToApi(promotion),
  campaign_id: promotion.campaign?.id ?? null,
  is_tax_inclusive: promotion.isTaxInclusive,
  metadata: promotion.metadata,
  application_method:
    promotion.methodType && promotion.targetType
      ? {
          ...(promotion.applicationMethodId
            ? { id: promotion.applicationMethodId }
            : {}),
          type: promotion.methodType,
          target_type: promotion.targetType,
          allocation: promotion.allocation,
          value: promotion.value,
          currency_code: promotion.currencyCode,
          max_quantity: promotion.maxQuantity,
          apply_to_quantity: promotion.applyToQuantity,
          buy_rules_min_quantity: promotion.buyRulesMinQuantity,
          target_rules: promotion.targetRules.map(ruleToApi),
          buy_rules: promotion.buyRules.map(ruleToApi),
        }
      : null,
  rules: promotion.rules.map(ruleToApi),
  campaign: promotion.campaign
    ? {
        id: promotion.campaign.id,
        name: promotion.campaign.name,
        description: promotion.campaign.description,
        campaign_identifier: promotion.campaign.identifier,
        starts_at: promotion.campaign.startsAt,
        ends_at: promotion.campaign.endsAt,
        created_at: promotion.campaign.createdAt,
        updated_at: promotion.campaign.updatedAt,
        budget: promotion.campaign.budget
          ? {
              id: promotion.campaign.budget.id,
              type: promotion.campaign.budget.type,
              currency_code: promotion.campaign.budget.currencyCode,
              limit: promotion.campaign.budget.limit,
              used: promotion.campaign.budget.used,
              attribute: promotion.campaign.budget.attribute,
            }
          : null,
      }
    : null,
  created_at: promotion.createdAt,
});

const promotionInputFromCreate = (
  input: z.infer<typeof createBodySchema>,
): PromotionWriteInput => ({
  code: input.code,
  type: input.type,
  status: input.status,
  isAutomatic: input.is_automatic,
  isTaxInclusive: input.is_tax_inclusive,
  limit: input.limit,
  methodType: input.application_method.type,
  targetType: input.application_method.target_type,
  allocation: input.application_method.allocation,
  value: input.application_method.value,
  currencyCode: input.application_method.currency_code ?? undefined,
  maxQuantity: input.application_method.max_quantity ?? undefined,
  applyToQuantity: input.application_method.apply_to_quantity ?? undefined,
  buyRulesMinQuantity:
    input.application_method.buy_rules_min_quantity ?? undefined,
  rules: input.rules.map((rule) => ({
    ...rule,
    description: rule.description ?? undefined,
  })),
  targetRules: input.application_method.target_rules.map((rule) => ({
    ...rule,
    description: rule.description ?? undefined,
  })),
  buyRules: input.application_method.buy_rules.map((rule) => ({
    ...rule,
    description: rule.description ?? undefined,
  })),
  campaignId: input.campaign_id,
  campaign: input.campaign
    ? {
        name: input.campaign.name,
        description: input.campaign.description,
        identifier: input.campaign.campaign_identifier,
        startsAt: input.campaign.starts_at,
        endsAt: input.campaign.ends_at,
        budgetType: input.campaign.budget?.type,
        budgetLimit: input.campaign.budget?.limit,
        budgetCurrencyCode: input.campaign.budget?.currency_code,
        budgetAttribute: input.campaign.budget?.attribute,
      }
    : undefined,
});

const promotionInputFromUpdate = (
  input: z.infer<typeof updateBodySchema>,
  current: PromotionDetailDTO,
): PromotionWriteInput => {
  const method = input.application_method;
  return {
    code: input.code ?? current.code,
    type: input.type ?? current.type,
    status: input.status ?? current.status,
    isAutomatic: input.is_automatic ?? current.isAutomatic,
    isTaxInclusive: input.is_tax_inclusive ?? current.isTaxInclusive,
    limit:
      input.limit === undefined
        ? (current.limit ?? undefined)
        : (input.limit ?? undefined),
    methodType: method?.type ?? current.methodType ?? "percentage",
    targetType: method?.target_type ?? current.targetType ?? "order",
    allocation:
      method?.allocation === undefined
        ? (current.allocation ?? "across")
        : (method.allocation ?? "across"),
    value: method?.value ?? current.value ?? 0,
    currencyCode:
      method?.currency_code === undefined
        ? (current.currencyCode ?? undefined)
        : (method.currency_code ?? undefined),
    maxQuantity:
      method?.max_quantity === undefined
        ? (current.maxQuantity ?? undefined)
        : (method.max_quantity ?? undefined),
    applyToQuantity:
      method?.apply_to_quantity === undefined
        ? (current.applyToQuantity ?? undefined)
        : (method.apply_to_quantity ?? undefined),
    buyRulesMinQuantity:
      method?.buy_rules_min_quantity === undefined
        ? (current.buyRulesMinQuantity ?? undefined)
        : (method.buy_rules_min_quantity ?? undefined),
    rules: current.rules.map((rule) => ({
      ...rule,
      description: rule.description ?? undefined,
    })),
    targetRules: (method?.target_rules ?? current.targetRules).map((rule) => ({
      ...rule,
      description: rule.description ?? undefined,
    })),
    buyRules: (method?.buy_rules ?? current.buyRules).map((rule) => ({
      ...rule,
      description: rule.description ?? undefined,
    })),
    campaignId: input.campaign_id ?? current.campaign?.id ?? undefined,
  };
};

const writeFailure = (result: PromotionWriteFailure) =>
  routeError(
    result.error,
    result.message,
    result.error === "DUPLICATE_CODE" ||
      result.error === "DUPLICATE_CAMPAIGN_IDENTIFIER"
      ? 409
      : result.error === "NOT_FOUND" || result.error === "INVALID_CAMPAIGN"
        ? 404
        : 400,
  );

/** Medusa-shaped Admin promotion endpoints backed by Morph's shared promotion DAL. */
export async function handleAdminPromotionsRequest(
  request: Request,
  dependencies: AdminPromotionsApiDependencies,
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
  const itemMatch = /^promotions\/([^/]+)$/.exec(path);
  const rulesMatch =
    /^promotions\/([^/]+)\/(rules|target-rules|buy-rules)$/.exec(path);
  const batchRulesMatch =
    /^promotions\/([^/]+)\/(rules|target-rules|buy-rules)\/batch$/.exec(path);

  if (path === "promotions" && request.method === "GET") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid promotion query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listPromotions(parsed.data);
      return privateJson({
        promotions: result.promotions.map(listPromotionToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Promotions could not be loaded",
        500,
      );
    }
  }

  if (path === "promotions" && request.method === "POST") {
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = createBodySchema.safeParse(rawBody);
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid promotion fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const input = promotionInputFromCreate(parsed.data);
      const result = await dependencies.createPromotion(
        input,
        parsed.data.metadata,
      );
      if (!result.success) return writeFailure(result);
      const promotion = await dependencies.findPromotion(result.id);
      return promotion
        ? privateJson({ promotion: promotionToApi(promotion) }, 201)
        : routeError(
            "INTERNAL_ERROR",
            "Created promotion could not be loaded",
            500,
          );
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Promotion could not be created",
        500,
      );
    }
  }

  if (batchRulesMatch && request.method === "POST") {
    const parsedId = z.uuid().safeParse(batchRulesMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid promotion ID", 400);
    if (!authorizeAdmin(access))
      return routeError("FORBIDDEN", "Administrator access is required", 403);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = batchRulesBodySchema.safeParse(rawBody);
    if (!parsed.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid promotion rule batch",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.batchRules(
        parsedId.data,
        batchRulesMatch[2] as PromotionRuleScope,
        parsed.data,
      );
      if (!result.success)
        return routeError(
          result.error,
          result.error === "NOT_FOUND"
            ? "Promotion not found"
            : result.error === "SHARED_RULE"
              ? "A shared rule cannot be updated through a single promotion"
              : "One or more rules do not belong to this promotion",
          result.error === "NOT_FOUND" ? 404 : 409,
        );
      return privateJson({
        created: result.created.map(ruleToApi),
        updated: result.updated.map(ruleToApi),
        deleted: result.deleted,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Promotion rules could not be updated",
        500,
      );
    }
  }

  if (rulesMatch && request.method === "GET") {
    const parsedId = z.uuid().safeParse(rulesMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid promotion ID", 400);
    try {
      const promotion = await dependencies.findPromotion(parsedId.data);
      if (!promotion)
        return routeError("NOT_FOUND", "Promotion not found", 404);
      const key = rulesMatch[2] ?? "rules";
      const rules =
        key === "rules"
          ? promotion.rules
          : key === "target-rules"
            ? promotion.targetRules
            : promotion.buyRules;
      return privateJson({ [key.replaceAll("-", "_")]: rules.map(ruleToApi) });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Promotion rules could not be loaded",
        500,
      );
    }
  }

  if (itemMatch) {
    const parsedId = z.uuid().safeParse(itemMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid promotion ID", 400);
    if (request.method === "GET") {
      try {
        const promotion = await dependencies.findPromotion(parsedId.data);
        return promotion
          ? privateJson({ promotion: promotionToApi(promotion) })
          : routeError("NOT_FOUND", "Promotion not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Promotion could not be loaded",
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
      const parsed = updateBodySchema.safeParse(rawBody);
      if (!parsed.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid promotion fields",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      try {
        const current = await dependencies.findPromotion(parsedId.data);
        if (!current)
          return routeError("NOT_FOUND", "Promotion not found", 404);
        const result = await dependencies.updatePromotion(
          parsedId.data,
          promotionInputFromUpdate(parsed.data, current),
        );
        if (!result.success) return writeFailure(result);
        const promotion = await dependencies.findPromotion(parsedId.data);
        return promotion
          ? privateJson({ promotion: promotionToApi(promotion) })
          : routeError("NOT_FOUND", "Promotion not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Promotion could not be updated",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      if (!authorizeAdmin(access))
        return routeError("FORBIDDEN", "Administrator access is required", 403);
      try {
        const result = await dependencies.deletePromotion(parsedId.data);
        if (!result.success) return writeFailure(result);
        return privateJson({
          id: parsedId.data,
          object: "promotion",
          deleted: true,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Promotion could not be deleted",
          500,
        );
      }
    }
  }

  if (path === "promotions" || itemMatch || rulesMatch || batchRulesMatch) {
    const allow = itemMatch
      ? "GET, POST, DELETE"
      : batchRulesMatch
        ? "POST"
        : rulesMatch
          ? "GET"
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
