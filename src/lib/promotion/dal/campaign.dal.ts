import {
  promotionCampaignBudgets,
  promotionCampaignBudgetUsages,
  promotionCampaigns,
  promotions,
} from "@/db/promotion.schema";
import type { CampaignBudgetType } from "@/db/promotion.schema";
import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import { likeContains } from "@/lib/db/like-query";
import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

export type CampaignSortField =
  "name" | "identifier" | "createdAt" | "updatedAt";

export interface CampaignBudgetWrite {
  type: CampaignBudgetType;
  limit?: number | null;
  currencyCode?: string | null;
  attribute?: string | null;
}

export interface CampaignCreateWrite {
  id: string;
  name: string;
  description?: string | null;
  identifier: string;
  startsAt?: string | null;
  endsAt?: string | null;
  budget?: CampaignBudgetWrite;
}

export interface CampaignUpdateWrite {
  id: string;
  name?: string;
  description?: string | null;
  identifier?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  budgetLimit?: number | null;
}

const mapCampaign = (
  campaign: typeof promotionCampaigns.$inferSelect,
  budget: typeof promotionCampaignBudgets.$inferSelect | null,
): CampaignDTO => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  identifier: campaign.campaignIdentifier,
  startsAt: campaign.startsAt,
  endsAt: campaign.endsAt,
  budget: budget
    ? {
        id: budget.id,
        type: budget.type,
        currencyCode: budget.currencyCode,
        limit: budget.limit,
        used: budget.used,
        attribute: budget.attribute,
      }
    : null,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
  deletedAt: campaign.deletedAt,
});

export const campaignDal = {
  async listPage(options: {
    query?: string;
    status?: "active" | "scheduled" | "expired";
    identifier?: string;
    ids?: string[];
    offset: number;
    limit: number;
    sortBy: CampaignSortField;
    sortOrder: "asc" | "desc";
  }): Promise<{ campaigns: CampaignDTO[]; total: number }> {
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
    const now = new Date().toISOString();
    if (options.status === "scheduled") {
      conditions.push(gt(promotionCampaigns.startsAt, now));
    } else if (options.status === "expired") {
      conditions.push(lt(promotionCampaigns.endsAt, now));
    } else if (options.status === "active") {
      conditions.push(
        and(
          or(
            isNull(promotionCampaigns.startsAt),
            lte(promotionCampaigns.startsAt, now),
          ),
          or(
            isNull(promotionCampaigns.endsAt),
            gte(promotionCampaigns.endsAt, now),
          ),
        ) as SQL,
      );
    }
    if (options.identifier)
      conditions.push(
        eq(promotionCampaigns.campaignIdentifier, options.identifier),
      );
    if (options.ids?.length)
      conditions.push(inArray(promotionCampaigns.id, options.ids));
    const where = and(...conditions);
    const total =
      firstOrNull(
        await db
          .select({ total: count() })
          .from(promotionCampaigns)
          .where(where),
      )?.total ?? 0;
    const sortColumn =
      options.sortBy === "identifier"
        ? promotionCampaigns.campaignIdentifier
        : options.sortBy === "name"
          ? promotionCampaigns.name
          : options.sortBy === "updatedAt"
            ? promotionCampaigns.updatedAt
            : promotionCampaigns.createdAt;
    const rows = await db
      .select({
        campaign: promotionCampaigns,
        budget: promotionCampaignBudgets,
      })
      .from(promotionCampaigns)
      .leftJoin(
        promotionCampaignBudgets,
        and(
          eq(promotionCampaignBudgets.campaignId, promotionCampaigns.id),
          isNull(promotionCampaignBudgets.deletedAt),
        ),
      )
      .where(where)
      .orderBy(
        options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
        asc(promotionCampaigns.id),
      )
      .limit(options.limit)
      .offset(options.offset);
    return {
      campaigns: rows.map(({ campaign, budget }) =>
        mapCampaign(campaign, budget),
      ),
      total,
    };
  },

  async findById(id: string): Promise<CampaignDTO | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({
          campaign: promotionCampaigns,
          budget: promotionCampaignBudgets,
        })
        .from(promotionCampaigns)
        .leftJoin(
          promotionCampaignBudgets,
          and(
            eq(promotionCampaignBudgets.campaignId, promotionCampaigns.id),
            isNull(promotionCampaignBudgets.deletedAt),
          ),
        )
        .where(
          and(
            eq(promotionCampaigns.id, id),
            isNull(promotionCampaigns.deletedAt),
          ),
        )
        .limit(1),
    );
    return row ? mapCampaign(row.campaign, row.budget) : null;
  },

  async findActiveByIdentifier(
    identifier: string,
    excludeId?: string,
  ): Promise<{ id: string } | null> {
    const db = await getDb();
    const conditions = [
      eq(promotionCampaigns.campaignIdentifier, identifier),
      isNull(promotionCampaigns.deletedAt),
    ];
    if (excludeId)
      conditions.push(sql`${promotionCampaigns.id} <> ${excludeId}`);
    return firstOrNull(
      await db
        .select({ id: promotionCampaigns.id })
        .from(promotionCampaigns)
        .where(and(...conditions))
        .limit(1),
    );
  },

  async create(input: CampaignCreateWrite): Promise<string> {
    const db = await getDb();
    const now = new Date().toISOString();
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(promotionCampaigns).values({
        id: input.id,
        name: input.name,
        description: input.description ?? null,
        campaignIdentifier: input.identifier,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    ];
    if (input.budget) {
      statements.push(
        db.insert(promotionCampaignBudgets).values({
          id: crypto.randomUUID(),
          campaignId: input.id,
          type: input.budget.type,
          currencyCode: input.budget.currencyCode ?? null,
          limit: input.budget.limit ?? null,
          used: 0,
          attribute: input.budget.attribute ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    await db.batch(statements);
    return input.id;
  },

  async update(input: CampaignUpdateWrite): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();
    const campaignChanges = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.identifier === undefined
        ? {}
        : { campaignIdentifier: input.identifier }),
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      updatedAt: now,
    };
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db
        .update(promotionCampaigns)
        .set(campaignChanges)
        .where(
          and(
            eq(promotionCampaigns.id, input.id),
            isNull(promotionCampaigns.deletedAt),
          ),
        ),
    ];
    if (input.budgetLimit !== undefined) {
      statements.push(
        db
          .update(promotionCampaignBudgets)
          .set({ limit: input.budgetLimit, updatedAt: now })
          .where(
            and(
              eq(promotionCampaignBudgets.campaignId, input.id),
              isNull(promotionCampaignBudgets.deletedAt),
              sql`EXISTS (SELECT 1 FROM ${promotionCampaigns} WHERE ${promotionCampaigns.id} = ${input.id} AND ${promotionCampaigns.deletedAt} IS NULL)`,
            ),
          ),
      );
    }
    await db.batch(statements);
    return Boolean(await this.findById(input.id));
  },

  async softDelete(id: string): Promise<boolean> {
    const db = await getDb();
    const now = new Date().toISOString();
    const budgetRows = await db
      .select({ id: promotionCampaignBudgets.id })
      .from(promotionCampaignBudgets)
      .where(
        and(
          eq(promotionCampaignBudgets.campaignId, id),
          isNull(promotionCampaignBudgets.deletedAt),
        ),
      );
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db
        .update(promotions)
        .set({ campaignId: null, updatedAt: now })
        .where(
          and(eq(promotions.campaignId, id), isNull(promotions.deletedAt)),
        ),
    ];
    if (budgetRows.length) {
      const budgetIds = budgetRows.map((row) => row.id);
      statements.push(
        db
          .update(promotionCampaignBudgetUsages)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(promotionCampaignBudgetUsages.budgetId, budgetIds),
              isNull(promotionCampaignBudgetUsages.deletedAt),
            ),
          ),
        db
          .update(promotionCampaignBudgets)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(promotionCampaignBudgets.id, budgetIds),
              isNull(promotionCampaignBudgets.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      db
        .update(promotionCampaigns)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(promotionCampaigns.id, id),
            isNull(promotionCampaigns.deletedAt),
          ),
        ),
    );
    await db.batch(statements);
    return true;
  },

  async managePromotions(
    campaignId: string,
    input: { add: string[]; remove: string[] },
  ): Promise<
    | { success: true }
    | { success: false; error: "NOT_FOUND" | "PROMOTION_UNAVAILABLE" }
  > {
    const db = await getDb();
    const campaign = firstOrNull(
      await db
        .select({ id: promotionCampaigns.id })
        .from(promotionCampaigns)
        .where(
          and(
            eq(promotionCampaigns.id, campaignId),
            isNull(promotionCampaigns.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!campaign) return { success: false, error: "NOT_FOUND" };
    if (!input.add.length && !input.remove.length) return { success: true };

    const now = new Date().toISOString();
    const addEligibility = input.add.length
      ? db
          .select({ total: count() })
          .from(promotions)
          .where(
            and(
              inArray(promotions.id, input.add),
              isNull(promotions.deletedAt),
              or(
                isNull(promotions.campaignId),
                eq(promotions.campaignId, campaignId),
              ),
            ),
          )
      : null;
    const addGuard = addEligibility
      ? sql`${addEligibility} = ${input.add.length}`
      : sql`1 = 1`;
    const activeCampaignGuard = sql`EXISTS (SELECT 1 FROM ${promotionCampaigns} WHERE ${promotionCampaigns.id} = ${campaignId} AND ${promotionCampaigns.deletedAt} IS NULL)`;
    const statements: BatchItem<"sqlite">[] = [];
    if (input.add.length) {
      statements.push(
        db
          .update(promotions)
          .set({ campaignId, updatedAt: now })
          .where(
            and(
              inArray(promotions.id, input.add),
              isNull(promotions.deletedAt),
              or(
                isNull(promotions.campaignId),
                eq(promotions.campaignId, campaignId),
              ),
              activeCampaignGuard,
              addGuard,
            ),
          ),
      );
    }
    if (input.remove.length) {
      statements.push(
        db
          .update(promotions)
          .set({ campaignId: null, updatedAt: now })
          .where(
            and(
              inArray(promotions.id, input.remove),
              eq(promotions.campaignId, campaignId),
              isNull(promotions.deletedAt),
              activeCampaignGuard,
              addGuard,
            ),
          ),
      );
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );

    if (input.add.length) {
      const linked = await db
        .select({ id: promotions.id })
        .from(promotions)
        .where(
          and(
            inArray(promotions.id, input.add),
            eq(promotions.campaignId, campaignId),
            isNull(promotions.deletedAt),
          ),
        );
      if (linked.length !== input.add.length)
        return { success: false, error: "PROMOTION_UNAVAILABLE" };
    }
    return { success: true };
  },
};
