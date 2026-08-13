import { getDb } from "@/db";
import type { Metadata } from "@/db/json";
import {
  promotionApplicationMethods,
  promotionApplicationMethodBuyRules,
  promotionApplicationMethodTargetRules,
  promotionCampaignBudgets,
  promotionCampaigns,
  promotionPromotionRules,
  promotionRules,
  promotionRuleValues,
  promotions,
} from "@/db/schema";
import { containsPattern } from "@/lib/db/like-pattern";
import type {
  PromotionCampaignDTO,
  PromotionDetailDTO,
  PromotionRuleDTO,
} from "@/lib/promotion/dto/promotion.dto";
import {
  toPromotionCampaignDTO,
  toPromotionDetailDTO,
  toPromotionListDTO,
  toPromotionRuleDTOs,
} from "@/lib/promotion/mapper/promotion.mapper";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

interface PromotionWrite {
  id: string;
  code: string;
  type: typeof promotions.$inferInsert.type;
  status: typeof promotions.$inferInsert.status;
  isAutomatic: boolean;
  isTaxInclusive: boolean;
  limit?: number;
  methodType: typeof promotionApplicationMethods.$inferInsert.type;
  targetType: typeof promotionApplicationMethods.$inferInsert.targetType;
  allocation: typeof promotionApplicationMethods.$inferInsert.allocation;
  value: number;
  currencyCode?: string;
  maxQuantity?: number;
  applyToQuantity?: number;
  buyRulesMinQuantity?: number;
  rules: PromotionRuleWrite[];
  targetRules: PromotionRuleWrite[];
  buyRules: PromotionRuleWrite[];
  campaignId?: string;
  campaign?: {
    name: string;
    description?: string;
    identifier: string;
    startsAt?: string;
    endsAt?: string;
    budgetType: "spend" | "usage" | "use_by_attribute" | "spend_by_attribute";
    budgetLimit?: number;
    budgetCurrencyCode?: string;
    budgetAttribute?: string;
  };
}

interface PromotionRuleWrite {
  attribute: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "in";
  values: string[];
}

const ruleStatements = (
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  rules: PromotionRuleWrite[],
  owner: "promotion" | "target" | "buy",
  now: string,
) =>
  rules.flatMap((rule) => {
    const ruleId = crypto.randomUUID();
    const link =
      owner === "promotion"
        ? db
            .insert(promotionPromotionRules)
            .values({ promotionId: ownerId, promotionRuleId: ruleId })
        : owner === "target"
          ? db
              .insert(promotionApplicationMethodTargetRules)
              .values({ applicationMethodId: ownerId, promotionRuleId: ruleId })
          : db.insert(promotionApplicationMethodBuyRules).values({
              applicationMethodId: ownerId,
              promotionRuleId: ruleId,
            });
    return [
      db.insert(promotionRules).values({
        id: ruleId,
        attribute: rule.attribute,
        operator: rule.operator,
        createdAt: now,
        updatedAt: now,
      }),
      ...(rule.values.length > 0
        ? [
            db.insert(promotionRuleValues).values(
              rule.values.map((value) => ({
                id: crypto.randomUUID(),
                promotionRuleId: ruleId,
                value,
                createdAt: now,
                updatedAt: now,
              })),
            ),
          ]
        : []),
      link,
    ];
  });

const mapRules = async (
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  owner: "promotion" | "target" | "buy",
): Promise<PromotionRuleDTO[]> => {
  const link =
    owner === "promotion"
      ? promotionPromotionRules
      : owner === "target"
        ? promotionApplicationMethodTargetRules
        : promotionApplicationMethodBuyRules;
  const ownerColumn =
    owner === "promotion"
      ? promotionPromotionRules.promotionId
      : owner === "target"
        ? promotionApplicationMethodTargetRules.applicationMethodId
        : promotionApplicationMethodBuyRules.applicationMethodId;
  const rows = await db
    .select({ rule: promotionRules, value: promotionRuleValues.value })
    .from(link)
    .innerJoin(promotionRules, eq(promotionRules.id, link.promotionRuleId))
    .leftJoin(
      promotionRuleValues,
      and(
        eq(promotionRuleValues.promotionRuleId, promotionRules.id),
        isNull(promotionRuleValues.deletedAt),
      ),
    )
    .where(and(eq(ownerColumn, ownerId), isNull(promotionRules.deletedAt)));
  return toPromotionRuleDTOs(rows);
};

export const promotionDal = {
  async listCampaignPage(options: {
    query?: string;
    page: number;
    limit: number;
    selectedIds?: string[];
  }): Promise<{
    campaigns: PromotionCampaignDTO[];
    selected: PromotionCampaignDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(promotionCampaigns.deletedAt)];
    if (options.query?.trim()) {
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(promotionCampaigns.name, pattern),
          like(promotionCampaigns.campaignIdentifier, pattern),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const [totals, rows, selectedRows] = await Promise.all([
      db.select({ value: count() }).from(promotionCampaigns).where(where),
      db
        .select()
        .from(promotionCampaigns)
        .where(where)
        .orderBy(desc(promotionCampaigns.createdAt), asc(promotionCampaigns.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
      options.selectedIds?.length
        ? db
            .select()
            .from(promotionCampaigns)
            .where(
              and(
                inArray(promotionCampaigns.id, options.selectedIds),
                isNull(promotionCampaigns.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);
    return {
      campaigns: rows.map(toPromotionCampaignDTO),
      selected: selectedRows.map(toPromotionCampaignDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },
  async listPage(options: {
    query?: string;
    sortBy: "code" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(promotions.deletedAt)];
    if (options.query)
      conditions.push(like(promotions.code, containsPattern(options.query)));
    const where = and(...conditions);
    const sortColumn =
      options.sortBy === "code"
        ? promotions.code
        : options.sortBy === "updatedAt"
          ? promotions.updatedAt
          : promotions.createdAt;
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(promotions).where(where),
      db
        .select({ promotion: promotions, method: promotionApplicationMethods })
        .from(promotions)
        .leftJoin(
          promotionApplicationMethods,
          and(
            eq(promotionApplicationMethods.promotionId, promotions.id),
            isNull(promotionApplicationMethods.deletedAt),
          ),
        )
        .where(where)
        .orderBy(orderBy)
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    return {
      promotions: rows.map(toPromotionListDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async findById(id: string): Promise<PromotionDetailDTO | null> {
    const db = await getDb();
    const rows = await db
      .select({
        promotion: promotions,
        method: promotionApplicationMethods,
        campaign: promotionCampaigns,
      })
      .from(promotions)
      .leftJoin(
        promotionApplicationMethods,
        and(
          eq(promotionApplicationMethods.promotionId, promotions.id),
          isNull(promotionApplicationMethods.deletedAt),
        ),
      )
      .leftJoin(
        promotionCampaigns,
        and(
          eq(promotionCampaigns.id, promotions.campaignId),
          isNull(promotionCampaigns.deletedAt),
        ),
      )
      .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [rules, targetRules, buyRules] = await Promise.all([
      mapRules(db, row.promotion.id, "promotion"),
      row.method ? mapRules(db, row.method.id, "target") : Promise.resolve([]),
      row.method ? mapRules(db, row.method.id, "buy") : Promise.resolve([]),
    ]);
    return toPromotionDetailDTO({
      row,
      rules,
      targetRules,
      buyRules,
    });
  },

  async findByCode(code: string) {
    const db = await getDb();
    return (
      (
        await db
          .select({ id: promotions.id })
          .from(promotions)
          .where(and(eq(promotions.code, code), isNull(promotions.deletedAt)))
          .limit(1)
      )[0] ?? null
    );
  },

  async create(data: PromotionWrite) {
    const db = await getDb();
    const now = new Date().toISOString();
    const campaignId = data.campaign
      ? crypto.randomUUID()
      : (data.campaignId ?? null);
    const campaignStatements = data.campaign
      ? [
          db.insert(promotionCampaigns).values({
            id: campaignId!,
            name: data.campaign.name,
            description: data.campaign.description || null,
            campaignIdentifier: data.campaign.identifier,
            startsAt: data.campaign.startsAt || null,
            endsAt: data.campaign.endsAt || null,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(promotionCampaignBudgets).values({
            id: crypto.randomUUID(),
            campaignId: campaignId!,
            type: data.campaign.budgetType,
            limit: data.campaign.budgetLimit ?? null,
            currencyCode:
              data.campaign.budgetCurrencyCode?.toLowerCase() || null,
            attribute: data.campaign.budgetAttribute || null,
            used: 0,
            createdAt: now,
            updatedAt: now,
          }),
        ]
      : [];
    const methodId = crypto.randomUUID();
    const statements: BatchItem<"sqlite">[] = [
      ...campaignStatements,
      db.insert(promotions).values({
        id: data.id,
        code: data.code,
        type: data.type,
        status: data.status,
        isAutomatic: data.isAutomatic,
        isTaxInclusive: data.isTaxInclusive,
        limit: data.limit ?? null,
        campaignId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(promotionApplicationMethods).values({
        id: methodId,
        promotionId: data.id,
        type: data.methodType,
        targetType: data.targetType,
        allocation: data.allocation,
        value: data.value,
        currencyCode: data.currencyCode || null,
        maxQuantity: data.maxQuantity ?? null,
        applyToQuantity: data.applyToQuantity ?? null,
        buyRulesMinQuantity: data.buyRulesMinQuantity ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      ...ruleStatements(db, data.id, data.rules, "promotion", now),
      ...ruleStatements(db, methodId, data.targetRules, "target", now),
      ...ruleStatements(db, methodId, data.buyRules, "buy", now),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
  },

  async update(id: string, data: Omit<PromotionWrite, "id">) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(promotions)
        .set({
          code: data.code,
          type: data.type,
          status: data.status,
          isAutomatic: data.isAutomatic,
          isTaxInclusive: data.isTaxInclusive,
          limit: data.limit ?? null,
          campaignId: data.campaignId ?? null,
          updatedAt: now,
        })
        .where(and(eq(promotions.id, id), isNull(promotions.deletedAt))),
      db
        .update(promotionApplicationMethods)
        .set({
          type: data.methodType,
          targetType: data.targetType,
          allocation: data.allocation,
          value: data.value,
          currencyCode: data.currencyCode || null,
          maxQuantity: data.maxQuantity ?? null,
          applyToQuantity: data.applyToQuantity ?? null,
          buyRulesMinQuantity: data.buyRulesMinQuantity ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(promotionApplicationMethods.promotionId, id),
            isNull(promotionApplicationMethods.deletedAt),
          ),
        ),
    ]);
  },

  async updateMetadata(id: string, metadata: Metadata) {
    const db = await getDb();
    await db
      .update(promotions)
      .set({ metadata, updatedAt: new Date().toISOString() })
      .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)));
  },

  async softDelete(id: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(promotions)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)));
  },
};
