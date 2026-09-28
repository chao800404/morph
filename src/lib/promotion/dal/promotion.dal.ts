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
import { likeContains } from "@/lib/db/like-query";
import { chunk, chunkForInsert } from "@/lib/product/dal/d1-batch";
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
  ne,
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
  metadata?: Metadata;
  campaignId?: string;
  campaign?: {
    name: string;
    description?: string;
    identifier: string;
    startsAt?: string;
    endsAt?: string;
    budgetType?: "spend" | "usage" | "use_by_attribute" | "spend_by_attribute";
    budgetLimit?: number;
    budgetCurrencyCode?: string;
    budgetAttribute?: string;
  };
}

interface PromotionRuleWrite {
  id?: string;
  description?: string | null;
  attribute: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "in";
  values: string[];
}

export type PromotionRuleScope = "rules" | "target-rules" | "buy-rules";

export interface PromotionRuleBatchInput {
  create?: PromotionRuleWrite[];
  update?: Array<PromotionRuleWrite & { id: string }>;
  delete?: string[];
}

export type PromotionRuleBatchResult =
  | {
      success: true;
      created: PromotionRuleDTO[];
      updated: PromotionRuleDTO[];
      deleted: { ids: string[]; object: "promotion-rule"; deleted: true };
    }
  | {
      success: false;
      error: "NOT_FOUND" | "RULE_NOT_FOUND" | "SHARED_RULE";
    };

const ruleStatements = (
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  rules: PromotionRuleWrite[],
  owner: "promotion" | "target" | "buy",
  now: string,
): BatchItem<"sqlite">[] => {
  const created = rules.map((rule) => ({
    id: crypto.randomUUID(),
    description: rule.description ?? null,
    attribute: rule.attribute,
    operator: rule.operator,
    createdAt: now,
    updatedAt: now,
    values: rule.values,
  }));
  const ruleRows = created.map(({ values: _values, ...rule }) => rule);
  const valueRows = created.flatMap((rule) =>
    rule.values.map((value) => ({
      id: crypto.randomUUID(),
      promotionRuleId: rule.id,
      value,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const ruleIds = created.map((rule) => rule.id);
  const ruleInserts = chunkForInsert(ruleRows, 6).map((rows) =>
    db.insert(promotionRules).values(rows),
  );
  const valueInserts = chunkForInsert(valueRows, 5).map((rows) =>
    db.insert(promotionRuleValues).values(rows),
  );
  const linkInserts =
    owner === "promotion"
      ? chunkForInsert(
          ruleIds.map((promotionRuleId) => ({
            promotionId: ownerId,
            promotionRuleId,
          })),
          2,
        ).map((rows) => db.insert(promotionPromotionRules).values(rows))
      : owner === "target"
        ? chunkForInsert(
            ruleIds.map((promotionRuleId) => ({
              applicationMethodId: ownerId,
              promotionRuleId,
            })),
            2,
          ).map((rows) =>
            db.insert(promotionApplicationMethodTargetRules).values(rows),
          )
        : chunkForInsert(
            ruleIds.map((promotionRuleId) => ({
              applicationMethodId: ownerId,
              promotionRuleId,
            })),
            2,
          ).map((rows) =>
            db.insert(promotionApplicationMethodBuyRules).values(rows),
          );
  return [...ruleInserts, ...valueInserts, ...linkInserts];
};

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
  async findActiveCampaignById(id: string): Promise<boolean> {
    const db = await getDb();
    return Boolean(
      (
        await db
          .select({ id: promotionCampaigns.id })
          .from(promotionCampaigns)
          .where(
            and(
              eq(promotionCampaigns.id, id),
              isNull(promotionCampaigns.deletedAt),
            ),
          )
          .limit(1)
      )[0],
    );
  },

  async findActiveCampaignByIdentifier(
    identifier: string,
    excludeId?: string,
  ): Promise<{ id: string } | null> {
    const db = await getDb();
    const conditions = [
      eq(promotionCampaigns.campaignIdentifier, identifier),
      isNull(promotionCampaigns.deletedAt),
    ];
    if (excludeId) conditions.push(ne(promotionCampaigns.id, excludeId));
    return (
      (
        await db
          .select({ id: promotionCampaigns.id })
          .from(promotionCampaigns)
          .where(and(...conditions))
          .limit(1)
      )[0] ?? null
    );
  },

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
      const term = options.query.trim();
      conditions.push(
        or(
          likeContains(promotionCampaigns.name, term),
          likeContains(promotionCampaigns.campaignIdentifier, term),
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
    campaignId?: string;
    unassigned?: boolean;
    type?: "standard" | "buyget";
    status?: "draft" | "active" | "inactive";
    isAutomatic?: boolean;
    sortBy: "code" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
  }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(promotions.deletedAt)];
    if (options.query)
      conditions.push(likeContains(promotions.code, options.query));
    if (options.campaignId)
      conditions.push(eq(promotions.campaignId, options.campaignId));
    else if (options.unassigned) conditions.push(isNull(promotions.campaignId));
    if (options.type) conditions.push(eq(promotions.type, options.type));
    if (options.status) conditions.push(eq(promotions.status, options.status));
    if (options.isAutomatic !== undefined)
      conditions.push(eq(promotions.isAutomatic, options.isAutomatic));
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
        .offset(options.offset ?? (options.page - 1) * options.limit),
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
    const [rules, targetRules, buyRules, campaignBudgets] = await Promise.all([
      mapRules(db, row.promotion.id, "promotion"),
      row.method ? mapRules(db, row.method.id, "target") : Promise.resolve([]),
      row.method ? mapRules(db, row.method.id, "buy") : Promise.resolve([]),
      row.campaign
        ? db
            .select()
            .from(promotionCampaignBudgets)
            .where(
              and(
                eq(promotionCampaignBudgets.campaignId, row.campaign.id),
                isNull(promotionCampaignBudgets.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);
    return toPromotionDetailDTO({
      row,
      campaignBudget: campaignBudgets[0] ?? null,
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
    const campaignStatements: BatchItem<"sqlite">[] = data.campaign
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
          ...(data.campaign.budgetType
            ? [
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
            : []),
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
        metadata: data.metadata,
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
    const [promotionRows, methodRows] = await Promise.all([
      db
        .select({ id: promotions.id, campaignId: promotions.campaignId })
        .from(promotions)
        .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)))
        .limit(1),
      db
        .select({ id: promotionApplicationMethods.id })
        .from(promotionApplicationMethods)
        .where(
          and(
            eq(promotionApplicationMethods.promotionId, id),
            isNull(promotionApplicationMethods.deletedAt),
          ),
        )
        .limit(1),
    ]);
    const current = promotionRows[0];
    const methodId = methodRows[0]?.id;
    if (!current || !methodId) return false;

    const [promotionLinks, targetLinks, buyLinks] = await Promise.all([
      db
        .select({ id: promotionPromotionRules.promotionRuleId })
        .from(promotionPromotionRules)
        .innerJoin(
          promotionRules,
          eq(promotionRules.id, promotionPromotionRules.promotionRuleId),
        )
        .where(
          and(
            eq(promotionPromotionRules.promotionId, id),
            isNull(promotionRules.deletedAt),
          ),
        ),
      db
        .select({ id: promotionApplicationMethodTargetRules.promotionRuleId })
        .from(promotionApplicationMethodTargetRules)
        .innerJoin(
          promotionRules,
          eq(
            promotionRules.id,
            promotionApplicationMethodTargetRules.promotionRuleId,
          ),
        )
        .where(
          and(
            eq(
              promotionApplicationMethodTargetRules.applicationMethodId,
              methodId,
            ),
            isNull(promotionRules.deletedAt),
          ),
        ),
      db
        .select({ id: promotionApplicationMethodBuyRules.promotionRuleId })
        .from(promotionApplicationMethodBuyRules)
        .innerJoin(
          promotionRules,
          eq(
            promotionRules.id,
            promotionApplicationMethodBuyRules.promotionRuleId,
          ),
        )
        .where(
          and(
            eq(
              promotionApplicationMethodBuyRules.applicationMethodId,
              methodId,
            ),
            isNull(promotionRules.deletedAt),
          ),
        ),
    ]);
    const oldRuleIds = [
      ...new Set([
        ...promotionLinks.map((row) => row.id),
        ...targetLinks.map((row) => row.id),
        ...buyLinks.map((row) => row.id),
      ]),
    ];
    const [externalPromotionLinks, externalTargetLinks, externalBuyLinks] =
      oldRuleIds.length
        ? await Promise.all([
            db
              .select({ id: promotionPromotionRules.promotionRuleId })
              .from(promotionPromotionRules)
              .where(
                and(
                  inArray(promotionPromotionRules.promotionRuleId, oldRuleIds),
                  ne(promotionPromotionRules.promotionId, id),
                ),
              ),
            db
              .select({
                id: promotionApplicationMethodTargetRules.promotionRuleId,
              })
              .from(promotionApplicationMethodTargetRules)
              .where(
                and(
                  inArray(
                    promotionApplicationMethodTargetRules.promotionRuleId,
                    oldRuleIds,
                  ),
                  ne(
                    promotionApplicationMethodTargetRules.applicationMethodId,
                    methodId,
                  ),
                ),
              ),
            db
              .select({
                id: promotionApplicationMethodBuyRules.promotionRuleId,
              })
              .from(promotionApplicationMethodBuyRules)
              .where(
                and(
                  inArray(
                    promotionApplicationMethodBuyRules.promotionRuleId,
                    oldRuleIds,
                  ),
                  ne(
                    promotionApplicationMethodBuyRules.applicationMethodId,
                    methodId,
                  ),
                ),
              ),
          ])
        : [[], [], []];
    const sharedRuleIds = new Set([
      ...externalPromotionLinks.map((row) => row.id),
      ...externalTargetLinks.map((row) => row.id),
      ...externalBuyLinks.map((row) => row.id),
    ]);
    const orphanedRuleIds = oldRuleIds.filter(
      (ruleId) => !sharedRuleIds.has(ruleId),
    );
    const campaignId = data.campaign
      ? crypto.randomUUID()
      : (data.campaignId ?? current.campaignId);
    const campaignStatements: BatchItem<"sqlite">[] = data.campaign
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
          ...(data.campaign.budgetType
            ? [
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
            : []),
        ]
      : [];
    const statements: BatchItem<"sqlite">[] = [
      ...campaignStatements,
      db
        .update(promotions)
        .set({
          code: data.code,
          type: data.type,
          status: data.status,
          isAutomatic: data.isAutomatic,
          isTaxInclusive: data.isTaxInclusive,
          limit: data.limit ?? null,
          campaignId,
          ...(data.metadata === undefined ? {} : { metadata: data.metadata }),
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
            eq(promotionApplicationMethods.id, methodId),
            isNull(promotionApplicationMethods.deletedAt),
          ),
        ),
      db
        .delete(promotionPromotionRules)
        .where(eq(promotionPromotionRules.promotionId, id)),
      db
        .delete(promotionApplicationMethodTargetRules)
        .where(
          eq(
            promotionApplicationMethodTargetRules.applicationMethodId,
            methodId,
          ),
        ),
      db
        .delete(promotionApplicationMethodBuyRules)
        .where(
          eq(promotionApplicationMethodBuyRules.applicationMethodId, methodId),
        ),
      ...chunk(orphanedRuleIds, 80).flatMap((ruleIds) => [
        db
          .update(promotionRules)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(promotionRules.id, ruleIds)),
        db
          .update(promotionRuleValues)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(promotionRuleValues.promotionRuleId, ruleIds)),
      ]),
      ...ruleStatements(db, id, data.rules, "promotion", now),
      ...ruleStatements(db, methodId, data.targetRules, "target", now),
      ...ruleStatements(db, methodId, data.buyRules, "buy", now),
    ];
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  async batchRules(
    id: string,
    scope: PromotionRuleScope,
    input: PromotionRuleBatchInput,
  ): Promise<PromotionRuleBatchResult> {
    const db = await getDb();
    const now = new Date().toISOString();
    const [promotionRow, methodRow] = await Promise.all([
      db
        .select({ id: promotions.id })
        .from(promotions)
        .where(and(eq(promotions.id, id), isNull(promotions.deletedAt)))
        .limit(1),
      db
        .select({ id: promotionApplicationMethods.id })
        .from(promotionApplicationMethods)
        .where(
          and(
            eq(promotionApplicationMethods.promotionId, id),
            isNull(promotionApplicationMethods.deletedAt),
          ),
        )
        .limit(1),
    ]);
    const methodId = methodRow[0]?.id;
    if (!promotionRow[0] || !methodId)
      return { success: false, error: "NOT_FOUND" };

    const currentLinks =
      scope === "rules"
        ? await db
            .select({ id: promotionPromotionRules.promotionRuleId })
            .from(promotionPromotionRules)
            .innerJoin(
              promotionRules,
              eq(promotionRules.id, promotionPromotionRules.promotionRuleId),
            )
            .where(
              and(
                eq(promotionPromotionRules.promotionId, id),
                isNull(promotionRules.deletedAt),
              ),
            )
        : scope === "target-rules"
          ? await db
              .select({
                id: promotionApplicationMethodTargetRules.promotionRuleId,
              })
              .from(promotionApplicationMethodTargetRules)
              .innerJoin(
                promotionRules,
                eq(
                  promotionRules.id,
                  promotionApplicationMethodTargetRules.promotionRuleId,
                ),
              )
              .where(
                and(
                  eq(
                    promotionApplicationMethodTargetRules.applicationMethodId,
                    methodId,
                  ),
                  isNull(promotionRules.deletedAt),
                ),
              )
          : await db
              .select({
                id: promotionApplicationMethodBuyRules.promotionRuleId,
              })
              .from(promotionApplicationMethodBuyRules)
              .innerJoin(
                promotionRules,
                eq(
                  promotionRules.id,
                  promotionApplicationMethodBuyRules.promotionRuleId,
                ),
              )
              .where(
                and(
                  eq(
                    promotionApplicationMethodBuyRules.applicationMethodId,
                    methodId,
                  ),
                  isNull(promotionRules.deletedAt),
                ),
              );
    const allowedRuleIds = new Set(currentLinks.map((row) => row.id));
    const updateIds = (input.update ?? []).map((rule) => rule.id);
    const deleteIds = input.delete ?? [];
    const requestedIds = [...updateIds, ...deleteIds];
    if (
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((ruleId) => !allowedRuleIds.has(ruleId))
    )
      return { success: false, error: "RULE_NOT_FOUND" };

    const [promotionLinks, targetLinks, buyLinks] = await Promise.all([
      requestedIds.length
        ? db
            .select({
              ownerId: promotionPromotionRules.promotionId,
              id: promotionPromotionRules.promotionRuleId,
            })
            .from(promotionPromotionRules)
            .where(
              inArray(promotionPromotionRules.promotionRuleId, requestedIds),
            )
        : [],
      requestedIds.length
        ? db
            .select({
              ownerId:
                promotionApplicationMethodTargetRules.applicationMethodId,
              id: promotionApplicationMethodTargetRules.promotionRuleId,
            })
            .from(promotionApplicationMethodTargetRules)
            .where(
              inArray(
                promotionApplicationMethodTargetRules.promotionRuleId,
                requestedIds,
              ),
            )
        : [],
      requestedIds.length
        ? db
            .select({
              ownerId: promotionApplicationMethodBuyRules.applicationMethodId,
              id: promotionApplicationMethodBuyRules.promotionRuleId,
            })
            .from(promotionApplicationMethodBuyRules)
            .where(
              inArray(
                promotionApplicationMethodBuyRules.promotionRuleId,
                requestedIds,
              ),
            )
        : [],
    ]);
    const isCurrentOwner = (
      link: { ownerId: string; id: string },
      linkScope: PromotionRuleScope,
    ) =>
      link.id &&
      ((scope === "rules" && linkScope === scope && link.ownerId === id) ||
        (scope !== "rules" &&
          linkScope === scope &&
          link.ownerId === methodId));
    const isShared = (ruleId: string) =>
      [
        ...promotionLinks.map((link) => ({ ...link, scope: "rules" as const })),
        ...targetLinks.map((link) => ({
          ...link,
          scope: "target-rules" as const,
        })),
        ...buyLinks.map((link) => ({ ...link, scope: "buy-rules" as const })),
      ].some((link) => link.id === ruleId && !isCurrentOwner(link, link.scope));
    if (updateIds.some(isShared))
      return { success: false, error: "SHARED_RULE" };

    const ownerColumn =
      scope === "rules"
        ? promotionPromotionRules.promotionId
        : scope === "target-rules"
          ? promotionApplicationMethodTargetRules.applicationMethodId
          : promotionApplicationMethodBuyRules.applicationMethodId;
    const ownerId = scope === "rules" ? id : methodId;
    const linkTable =
      scope === "rules"
        ? promotionPromotionRules
        : scope === "target-rules"
          ? promotionApplicationMethodTargetRules
          : promotionApplicationMethodBuyRules;
    const statements: BatchItem<"sqlite">[] = [];
    if (deleteIds.length) {
      statements.push(
        db
          .delete(linkTable)
          .where(
            and(
              eq(ownerColumn, ownerId),
              inArray(
                scope === "rules"
                  ? promotionPromotionRules.promotionRuleId
                  : scope === "target-rules"
                    ? promotionApplicationMethodTargetRules.promotionRuleId
                    : promotionApplicationMethodBuyRules.promotionRuleId,
                deleteIds,
              ),
            ),
          ),
      );
      const orphanIds = deleteIds.filter((ruleId) => !isShared(ruleId));
      if (orphanIds.length) {
        statements.push(
          db
            .update(promotionRules)
            .set({ deletedAt: now, updatedAt: now })
            .where(inArray(promotionRules.id, orphanIds)),
          db
            .update(promotionRuleValues)
            .set({ deletedAt: now, updatedAt: now })
            .where(inArray(promotionRuleValues.promotionRuleId, orphanIds)),
        );
      }
    }
    for (const rule of input.update ?? []) {
      statements.push(
        db
          .update(promotionRules)
          .set({
            description: rule.description ?? null,
            attribute: rule.attribute,
            operator: rule.operator,
            updatedAt: now,
          })
          .where(
            and(
              eq(promotionRules.id, rule.id),
              isNull(promotionRules.deletedAt),
            ),
          ),
        db
          .update(promotionRuleValues)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(promotionRuleValues.promotionRuleId, rule.id),
              isNull(promotionRuleValues.deletedAt),
            ),
          ),
      );
      const valueRows = rule.values.map((value) => ({
        id: crypto.randomUUID(),
        promotionRuleId: rule.id,
        value,
        createdAt: now,
        updatedAt: now,
      }));
      for (const rows of chunkForInsert(valueRows, 5))
        statements.push(db.insert(promotionRuleValues).values(rows));
    }
    const createdRows = (input.create ?? []).map((rule) => ({
      id: crypto.randomUUID(),
      description: rule.description ?? null,
      attribute: rule.attribute,
      operator: rule.operator,
      values: rule.values,
      createdAt: now,
      updatedAt: now,
    }));
    for (const rows of chunkForInsert(
      createdRows.map(({ values: _values, ...rule }) => rule),
      6,
    ))
      statements.push(db.insert(promotionRules).values(rows));
    const createdValues = createdRows.flatMap((rule) =>
      rule.values.map((value) => ({
        id: crypto.randomUUID(),
        promotionRuleId: rule.id,
        value,
        createdAt: now,
        updatedAt: now,
      })),
    );
    for (const rows of chunkForInsert(createdValues, 5))
      statements.push(db.insert(promotionRuleValues).values(rows));
    const createdRuleIds = createdRows.map((rule) => rule.id);
    if (scope === "rules") {
      for (const rows of chunkForInsert(
        createdRuleIds.map((promotionRuleId) => ({
          promotionId: ownerId,
          promotionRuleId,
        })),
        2,
      ))
        statements.push(db.insert(promotionPromotionRules).values(rows));
    } else if (scope === "target-rules") {
      for (const rows of chunkForInsert(
        createdRuleIds.map((promotionRuleId) => ({
          applicationMethodId: ownerId,
          promotionRuleId,
        })),
        2,
      ))
        statements.push(
          db.insert(promotionApplicationMethodTargetRules).values(rows),
        );
    } else {
      for (const rows of chunkForInsert(
        createdRuleIds.map((promotionRuleId) => ({
          applicationMethodId: ownerId,
          promotionRuleId,
        })),
        2,
      ))
        statements.push(
          db.insert(promotionApplicationMethodBuyRules).values(rows),
        );
    }
    if (statements.length) {
      statements.unshift(
        db
          .update(promotions)
          .set({ updatedAt: now })
          .where(and(eq(promotions.id, id), isNull(promotions.deletedAt))),
        db
          .update(promotionApplicationMethods)
          .set({ updatedAt: now })
          .where(
            and(
              eq(promotionApplicationMethods.id, methodId),
              isNull(promotionApplicationMethods.deletedAt),
            ),
          ),
      );
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    }

    const toRule = (
      rule: PromotionRuleWrite & { id: string },
    ): PromotionRuleDTO => ({
      id: rule.id,
      description: rule.description ?? null,
      attribute: rule.attribute,
      operator: rule.operator,
      values: rule.values,
    });
    return {
      success: true,
      created: createdRows.map(toRule),
      updated: (input.update ?? []).map(toRule),
      deleted: { ids: deleteIds, object: "promotion-rule", deleted: true },
    };
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
