import { getDb } from "@/db";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
  orderSummaries,
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
import type { OrderDetailDTO, OrderListDTO, PromotionCampaignDTO, PromotionDetailDTO, PromotionListDTO, PromotionRuleDTO } from "./dto";
import { and, asc, count, desc, eq, inArray, isNull, like, max, or, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

const totalFromSnapshot = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const candidate = record.total ?? record.current_order_total ?? record.original_order_total;
  return typeof candidate === "number" ? candidate : 0;
};

export const orderDal = {
  async listPage(options: { query?: string; sortBy: "createdAt" | "updatedAt"; sortOrder: "asc" | "desc"; page: number; limit: number }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(orders.deletedAt)];
    if (options.query) {
      const pattern = containsPattern(options.query);
      conditions.push(or(like(orders.email, pattern), like(orders.customDisplayId, pattern)) as SQL);
    }
    const where = and(...conditions);
    const sortColumn = options.sortBy === "updatedAt" ? orders.updatedAt : orders.createdAt;
    const orderBy = options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(orders).where(where),
      db.select({ order: orders, summary: orderSummaries.totals })
        .from(orders)
        .leftJoin(orderSummaries, and(eq(orderSummaries.orderId, orders.id), eq(orderSummaries.version, orders.version), isNull(orderSummaries.deletedAt)))
        .where(where).orderBy(orderBy).limit(options.limit).offset((options.page - 1) * options.limit),
    ]);
    const data: OrderListDTO[] = rows.map(({ order, summary }) => ({
      id: order.id, displayId: order.displayId, status: order.status, email: order.email,
      currencyCode: order.currencyCode, isDraftOrder: order.isDraftOrder,
      total: totalFromSnapshot(summary), createdAt: order.createdAt, updatedAt: order.updatedAt,
    }));
    return { orders: data, total: Number(totals[0]?.value ?? 0) };
  },

  async findById(id: string): Promise<OrderDetailDTO | null> {
    const db = await getDb();
    const rows = await db.select({ order: orders, summary: orderSummaries.totals })
      .from(orders)
      .leftJoin(orderSummaries, and(eq(orderSummaries.orderId, orders.id), eq(orderSummaries.version, orders.version), isNull(orderSummaries.deletedAt)))
      .where(and(eq(orders.id, id), isNull(orders.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const [items, addresses] = await Promise.all([
      db.select({ item: orderLineItems, state: orderItems })
        .from(orderItems).innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(and(eq(orderItems.orderId, id), eq(orderItems.version, row.order.version), isNull(orderItems.deletedAt), isNull(orderLineItems.deletedAt))),
      db.select().from(orderAddresses).where(and(inArray(orderAddresses.id, [row.order.shippingAddressId, row.order.billingAddressId].filter((value): value is string => Boolean(value))), isNull(orderAddresses.deletedAt))),
    ]);
    const mapAddress = (addressId: string | null) => {
      const address = addresses.find((candidate) => candidate.id === addressId);
      if (!address) return null;
      return { firstName: address.firstName, lastName: address.lastName, company: address.company, address1: address.address1, address2: address.address2, city: address.city, province: address.province, postalCode: address.postalCode, countryCode: address.countryCode, phone: address.phone };
    };
    return {
      id: row.order.id, displayId: row.order.displayId, status: row.order.status, email: row.order.email,
      currencyCode: row.order.currencyCode, isDraftOrder: row.order.isDraftOrder, total: totalFromSnapshot(row.summary),
      customerId: row.order.customerId, regionId: row.order.regionId, salesChannelId: row.order.salesChannelId,
      createdAt: row.order.createdAt, updatedAt: row.order.updatedAt,
      items: items.map(({ item, state }) => ({ id: item.id, title: item.title, thumbnail: item.thumbnail, sku: item.variantSku, quantity: state.quantity, fulfilledQuantity: state.fulfilledQuantity, unitPrice: state.unitPrice ?? item.unitPrice ?? 0 })),
      shippingAddress: mapAddress(row.order.shippingAddressId), billingAddress: mapAddress(row.order.billingAddressId),
    };
  },

  async create(data: { id: string; email?: string; currencyCode: string; status: "draft" | "pending"; noNotification: boolean; itemTitle?: string; itemSku?: string; quantity: number; unitPrice: number }) {
    const db = await getDb();
    const nextRows = await db.select({ value: max(orders.displayId) }).from(orders);
    const displayId = Number(nextRows[0]?.value ?? 0) + 1;
    const now = new Date().toISOString();
    const lineItemId = crypto.randomUUID();
    if (data.itemTitle) {
      await db.batch([
        db.insert(orders).values({ id: data.id, displayId, status: data.status, email: data.email || null, currencyCode: data.currencyCode, isDraftOrder: data.status === "draft", noNotification: data.noNotification, createdAt: now, updatedAt: now }),
        db.insert(orderSummaries).values({ id: crypto.randomUUID(), orderId: data.id, version: 1, totals: { total: Math.round(data.unitPrice * data.quantity) }, createdAt: now, updatedAt: now }),
        db.insert(orderLineItems).values({ id: lineItemId, title: data.itemTitle, variantSku: data.itemSku || null, unitPrice: Math.round(data.unitPrice), isCustomPrice: true, createdAt: now, updatedAt: now }),
        db.insert(orderItems).values({ id: crypto.randomUUID(), orderId: data.id, itemId: lineItemId, version: 1, quantity: data.quantity, unitPrice: Math.round(data.unitPrice), createdAt: now, updatedAt: now }),
      ]);
    } else {
      await db.batch([
        db.insert(orders).values({ id: data.id, displayId, status: data.status, email: data.email || null, currencyCode: data.currencyCode, isDraftOrder: data.status === "draft", noNotification: data.noNotification, createdAt: now, updatedAt: now }),
        db.insert(orderSummaries).values({ id: crypto.randomUUID(), orderId: data.id, version: 1, totals: { total: 0 }, createdAt: now, updatedAt: now }),
      ]);
    }
    return { id: data.id, displayId };
  },

  async update(id: string, data: { email?: string; status: OrderDetailDTO["status"]; noNotification: boolean }) {
    const db = await getDb();
    await db.update(orders).set({ email: data.email || null, status: data.status, isDraftOrder: data.status === "draft", noNotification: data.noNotification, canceledAt: data.status === "canceled" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(and(eq(orders.id, id), isNull(orders.deletedAt)));
  },
};

const mapPromotion = (row: { promotion: typeof promotions.$inferSelect; method: typeof promotionApplicationMethods.$inferSelect | null }): PromotionListDTO => ({
  id: row.promotion.id, code: row.promotion.code, type: row.promotion.type, status: row.promotion.status,
  isAutomatic: row.promotion.isAutomatic, limit: row.promotion.limit, used: row.promotion.used,
  methodType: row.method?.type ?? null, targetType: row.method?.targetType ?? null,
  value: row.method?.value ?? null, currencyCode: row.method?.currencyCode ?? null, updatedAt: row.promotion.updatedAt,
});

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
    name: string; description?: string; identifier: string; startsAt?: string; endsAt?: string;
    budgetType: "spend" | "usage" | "use_by_attribute" | "spend_by_attribute";
    budgetLimit?: number; budgetCurrencyCode?: string; budgetAttribute?: string;
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
) => rules.flatMap((rule) => {
    const ruleId = crypto.randomUUID();
    const link = owner === "promotion"
      ? db.insert(promotionPromotionRules).values({ promotionId: ownerId, promotionRuleId: ruleId })
      : owner === "target"
        ? db.insert(promotionApplicationMethodTargetRules).values({ applicationMethodId: ownerId, promotionRuleId: ruleId })
        : db.insert(promotionApplicationMethodBuyRules).values({ applicationMethodId: ownerId, promotionRuleId: ruleId });
    return [
      db.insert(promotionRules).values({ id: ruleId, attribute: rule.attribute, operator: rule.operator, createdAt: now, updatedAt: now }),
      ...(rule.values.length > 0 ? [db.insert(promotionRuleValues).values(rule.values.map((value) => ({ id: crypto.randomUUID(), promotionRuleId: ruleId, value, createdAt: now, updatedAt: now })))] : []),
      link,
    ];
  });

const mapRules = async (
  db: Awaited<ReturnType<typeof getDb>>,
  ownerId: string,
  owner: "promotion" | "target" | "buy",
): Promise<PromotionRuleDTO[]> => {
  const link = owner === "promotion" ? promotionPromotionRules : owner === "target" ? promotionApplicationMethodTargetRules : promotionApplicationMethodBuyRules;
  const ownerColumn = owner === "promotion" ? promotionPromotionRules.promotionId : owner === "target" ? promotionApplicationMethodTargetRules.applicationMethodId : promotionApplicationMethodBuyRules.applicationMethodId;
  const rows = await db.select({ rule: promotionRules, value: promotionRuleValues.value })
    .from(link)
    .innerJoin(promotionRules, eq(promotionRules.id, link.promotionRuleId))
    .leftJoin(promotionRuleValues, and(eq(promotionRuleValues.promotionRuleId, promotionRules.id), isNull(promotionRuleValues.deletedAt)))
    .where(and(eq(ownerColumn, ownerId), isNull(promotionRules.deletedAt)));
  const grouped = new Map<string, PromotionRuleDTO>();
  for (const { rule, value } of rows) {
    const current = grouped.get(rule.id) ?? { attribute: rule.attribute, operator: rule.operator, values: [] };
    if (value !== null) current.values.push(value);
    grouped.set(rule.id, current);
  }
  return [...grouped.values()];
};

export const promotionDal = {
  async listCampaigns(): Promise<PromotionCampaignDTO[]> {
    const db = await getDb();
    const rows = await db.select().from(promotionCampaigns).where(isNull(promotionCampaigns.deletedAt)).orderBy(desc(promotionCampaigns.createdAt));
    return rows.map((row) => ({ id: row.id, name: row.name, identifier: row.campaignIdentifier, startsAt: row.startsAt, endsAt: row.endsAt }));
  },
  async listPage(options: { query?: string; sortBy: "code" | "createdAt" | "updatedAt"; sortOrder: "asc" | "desc"; page: number; limit: number }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(promotions.deletedAt)];
    if (options.query) conditions.push(like(promotions.code, containsPattern(options.query)));
    const where = and(...conditions);
    const sortColumn = options.sortBy === "code" ? promotions.code : options.sortBy === "updatedAt" ? promotions.updatedAt : promotions.createdAt;
    const orderBy = options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
      db.select({ value: count() }).from(promotions).where(where),
      db.select({ promotion: promotions, method: promotionApplicationMethods }).from(promotions)
        .leftJoin(promotionApplicationMethods, and(eq(promotionApplicationMethods.promotionId, promotions.id), isNull(promotionApplicationMethods.deletedAt)))
        .where(where).orderBy(orderBy).limit(options.limit).offset((options.page - 1) * options.limit),
    ]);
    return { promotions: rows.map(mapPromotion), total: Number(totals[0]?.value ?? 0) };
  },

  async findById(id: string): Promise<PromotionDetailDTO | null> {
    const db = await getDb();
    const rows = await db.select({ promotion: promotions, method: promotionApplicationMethods, campaign: promotionCampaigns })
      .from(promotions)
      .leftJoin(promotionApplicationMethods, and(eq(promotionApplicationMethods.promotionId, promotions.id), isNull(promotionApplicationMethods.deletedAt)))
      .leftJoin(promotionCampaigns, and(eq(promotionCampaigns.id, promotions.campaignId), isNull(promotionCampaigns.deletedAt)))
      .where(and(eq(promotions.id, id), isNull(promotions.deletedAt))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const [rules, targetRules, buyRules] = await Promise.all([
      mapRules(db, row.promotion.id, "promotion"),
      row.method ? mapRules(db, row.method.id, "target") : Promise.resolve([]),
      row.method ? mapRules(db, row.method.id, "buy") : Promise.resolve([]),
    ]);
    return { ...mapPromotion(row), isTaxInclusive: row.promotion.isTaxInclusive, allocation: row.method?.allocation ?? null, maxQuantity: row.method?.maxQuantity ?? null, applyToQuantity: row.method?.applyToQuantity ?? null, buyRulesMinQuantity: row.method?.buyRulesMinQuantity ?? null, rules, targetRules, buyRules, campaign: row.campaign ? { id: row.campaign.id, name: row.campaign.name, description: row.campaign.description, identifier: row.campaign.campaignIdentifier, startsAt: row.campaign.startsAt, endsAt: row.campaign.endsAt } : null, createdAt: row.promotion.createdAt };
  },

  async findByCode(code: string) {
    const db = await getDb();
    return (await db.select({ id: promotions.id }).from(promotions).where(and(eq(promotions.code, code), isNull(promotions.deletedAt))).limit(1))[0] ?? null;
  },

  async create(data: PromotionWrite) {
    const db = await getDb(); const now = new Date().toISOString();
    const campaignId = data.campaign ? crypto.randomUUID() : data.campaignId ?? null;
    const campaignStatements = data.campaign ? [
        db.insert(promotionCampaigns).values({ id: campaignId!, name: data.campaign.name, description: data.campaign.description || null, campaignIdentifier: data.campaign.identifier, startsAt: data.campaign.startsAt || null, endsAt: data.campaign.endsAt || null, createdAt: now, updatedAt: now }),
        db.insert(promotionCampaignBudgets).values({ id: crypto.randomUUID(), campaignId: campaignId!, type: data.campaign.budgetType, limit: data.campaign.budgetLimit ?? null, currencyCode: data.campaign.budgetCurrencyCode?.toLowerCase() || null, attribute: data.campaign.budgetAttribute || null, used: 0, createdAt: now, updatedAt: now }),
      ] : [];
    const methodId = crypto.randomUUID();
    const statements: BatchItem<"sqlite">[] = [
      ...campaignStatements,
      db.insert(promotions).values({ id: data.id, code: data.code, type: data.type, status: data.status, isAutomatic: data.isAutomatic, isTaxInclusive: data.isTaxInclusive, limit: data.limit ?? null, campaignId, createdAt: now, updatedAt: now }),
      db.insert(promotionApplicationMethods).values({ id: methodId, promotionId: data.id, type: data.methodType, targetType: data.targetType, allocation: data.allocation, value: data.value, currencyCode: data.currencyCode || null, maxQuantity: data.maxQuantity ?? null, applyToQuantity: data.applyToQuantity ?? null, buyRulesMinQuantity: data.buyRulesMinQuantity ?? null, createdAt: now, updatedAt: now }),
      ...ruleStatements(db, data.id, data.rules, "promotion", now),
      ...ruleStatements(db, methodId, data.targetRules, "target", now),
      ...ruleStatements(db, methodId, data.buyRules, "buy", now),
    ];
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  },

  async update(id: string, data: Omit<PromotionWrite, "id">) {
    const db = await getDb(); const now = new Date().toISOString();
    await db.batch([
      db.update(promotions).set({ code: data.code, type: data.type, status: data.status, isAutomatic: data.isAutomatic, isTaxInclusive: data.isTaxInclusive, limit: data.limit ?? null, campaignId: data.campaignId ?? null, updatedAt: now }).where(and(eq(promotions.id, id), isNull(promotions.deletedAt))),
      db.update(promotionApplicationMethods).set({ type: data.methodType, targetType: data.targetType, allocation: data.allocation, value: data.value, currencyCode: data.currencyCode || null, maxQuantity: data.maxQuantity ?? null, applyToQuantity: data.applyToQuantity ?? null, buyRulesMinQuantity: data.buyRulesMinQuantity ?? null, updatedAt: now }).where(and(eq(promotionApplicationMethods.promotionId, id), isNull(promotionApplicationMethods.deletedAt))),
    ]);
  },

  async softDelete(id: string) {
    const db = await getDb(); const now = new Date().toISOString();
    await db.update(promotions).set({ deletedAt: now, updatedAt: now }).where(and(eq(promotions.id, id), isNull(promotions.deletedAt)));
  },
};
