import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";

/** `buyget` is "buy X get Y"; everything else is `standard`. */
export type PromotionType = "standard" | "buyget";

export type PromotionStatus = "draft" | "active" | "inactive";

export type ApplicationMethodType = "fixed" | "percentage";

export type ApplicationMethodTargetType =
  | "order"
  | "shipping_methods"
  | "items";

/**
 * How a fixed amount is spread. `each` applies it per unit, `across` splits it
 * over the matched items, `once` applies it a single time.
 */
export type ApplicationMethodAllocation = "each" | "across" | "once";

export type PromotionRuleOperator =
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "eq"
  | "ne"
  | "in";

/**
 * `spend` caps money given away, `usage` caps redemptions. The `_by_attribute`
 * variants apply the cap per customer rather than across the campaign.
 */
export type CampaignBudgetType =
  | "spend"
  | "usage"
  | "use_by_attribute"
  | "spend_by_attribute";

/**
 * Promotions — discounts, and the campaigns that budget them.
 *
 * Translated from Medusa's Promotion Module; see `region.schema.ts` for the
 * translation rules.
 *
 * The shape is three questions kept apart, which is why a single discount
 * spans four tables:
 *
 * - *Does it apply?* → `promotionRules`, joined to the promotion
 * - *What does it do?* → `promotionApplicationMethods`
 * - *What does it do it to?* → the application method's target rules
 * - *When can it stop?* → `promotionCampaigns` and their budgets
 *
 * A rule is `attribute operator values`, with the values in their own table so
 * `customer_group_id in [a, b, c]` is one rule rather than three.
 */
export const promotionCampaigns = sqliteTable(
  "promotion_campaigns",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** The author-facing code for the campaign, unique among live ones. */
    campaignIdentifier: text("campaign_identifier").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promotion_campaigns_active_identifier_unique")
      .on(table.campaignIdentifier)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/**
 * The cap on a campaign.
 *
 * `used` is a running total rather than a count over redemptions: the check
 * happens on every cart calculation, and summing an order history to answer
 * "is this campaign exhausted" would make the discount cost more than it gives.
 */
export const promotionCampaignBudgets = sqliteTable(
  "promotion_campaign_budgets",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => promotionCampaigns.id, { onDelete: "cascade" }),
    type: text("type").$type<CampaignBudgetType>().notNull(),
    currencyCode: text("currency_code"),
    /** Money in minor units when the type is a spend cap, else a count. */
    limit: integer("limit"),
    used: integer("used").notNull().default(0),
    /** For the per-customer types: which field identifies "one customer". */
    attribute: text("attribute"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promotion_campaign_budgets_campaign_unique")
      .on(table.campaignId)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "promotion_campaign_budgets_type_check",
      sql`${table.type} IN ('spend', 'usage', 'use_by_attribute', 'spend_by_attribute')`,
    ),
    check(
      "promotion_campaign_budgets_limit_check",
      sql`${table.limit} IS NULL OR ${table.used} <= ${table.limit}`,
    ),
  ],
);

/** One customer's slice of a per-customer budget. */
export const promotionCampaignBudgetUsages = sqliteTable(
  "promotion_campaign_budget_usages",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id")
      .notNull()
      .references(() => promotionCampaignBudgets.id, { onDelete: "cascade" }),
    /** The value of the budget's `attribute`, e.g. a customer id or email. */
    attributeValue: text("attribute_value").notNull(),
    used: integer("used").notNull().default(0),
    /** Snapshot of the parent budget limit for atomic per-attribute checks. */
    limit: integer("limit"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promotion_campaign_budget_usages_unique")
      .on(table.attributeValue, table.budgetId)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "promotion_campaign_budget_usages_limit_check",
      sql`${table.limit} IS NULL OR ${table.used} <= ${table.limit}`,
    ),
  ],
);

export const promotions = sqliteTable(
  "promotions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    type: text("type").$type<PromotionType>().notNull().default("standard"),
    status: text("status").$type<PromotionStatus>().notNull().default("draft"),
    /** Applied without the shopper entering the code. */
    isAutomatic: integer("is_automatic", { mode: "boolean" })
      .notNull()
      .default(false),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Total redemptions allowed. Null means unlimited. */
    limit: integer("limit"),
    used: integer("used").notNull().default(0),
    campaignId: text("campaign_id").references(() => promotionCampaigns.id, {
      onDelete: "set null",
    }),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promotions_active_code_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    // Every cart calculation looks for the automatic ones.
    index("promotions_automatic_active_idx")
      .on(table.isAutomatic, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    index("promotions_campaign_active_idx").on(
      table.campaignId,
      table.deletedAt,
    ),
    check(
      "promotions_type_check",
      sql`${table.type} IN ('standard', 'buyget')`,
    ),
    check(
      "promotions_status_check",
      sql`${table.status} IN ('draft', 'active', 'inactive')`,
    ),
    check("promotions_used_check", sql`${table.used} >= 0`),
    check(
      "promotions_limit_check",
      sql`${table.limit} IS NULL OR ${table.used} <= ${table.limit}`,
    ),
  ],
);

/**
 * What the promotion actually deducts.
 *
 * `value` is `real` and means two different things by `type`: minor units for
 * `fixed`, a percentage for `percentage` — 12.5 is 12.5%, not 0.125. Medusa
 * overloads the same column; splitting it into two would leave one always null
 * and still need the type to know which to read.
 */
export const promotionApplicationMethods = sqliteTable(
  "promotion_application_methods",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    type: text("type").$type<ApplicationMethodType>().notNull(),
    targetType: text("target_type")
      .$type<ApplicationMethodTargetType>()
      .notNull(),
    allocation: text("allocation").$type<ApplicationMethodAllocation>(),
    value: real("value"),
    currencyCode: text("currency_code"),
    /** Caps how many units one cart may discount. */
    maxQuantity: integer("max_quantity"),
    /** Buy-get: how many of the target to give. */
    applyToQuantity: integer("apply_to_quantity"),
    /** Buy-get: how many must be bought first. */
    buyRulesMinQuantity: integer("buy_rules_min_quantity"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("promotion_application_methods_promotion_unique")
      .on(table.promotionId)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "promotion_application_methods_type_check",
      sql`${table.type} IN ('fixed', 'percentage')`,
    ),
    check(
      "promotion_application_methods_target_type_check",
      sql`${table.targetType} IN ('order', 'shipping_methods', 'items')`,
    ),
    check(
      "promotion_application_methods_allocation_check",
      sql`${table.allocation} IS NULL OR ${table.allocation} IN ('each', 'across', 'once')`,
    ),
  ],
);

/** `attribute operator (values)`. The values live in the next table. */
export const promotionRules = sqliteTable(
  "promotion_rules",
  {
    id: text("id").primaryKey(),
    description: text("description"),
    attribute: text("attribute").notNull(),
    operator: text("operator").$type<PromotionRuleOperator>().notNull(),
    ...timestamps,
  },
  (table) => [
    index("promotion_rules_attribute_operator_active_idx").on(
      table.attribute,
      table.operator,
      table.deletedAt,
    ),
    check(
      "promotion_rules_operator_check",
      sql`${table.operator} IN ('gte', 'lte', 'gt', 'lt', 'eq', 'ne', 'in')`,
    ),
  ],
);

export const promotionRuleValues = sqliteTable(
  "promotion_rule_values",
  {
    id: text("id").primaryKey(),
    promotionRuleId: text("promotion_rule_id")
      .notNull()
      .references(() => promotionRules.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    ...timestamps,
  },
  (table) => [
    index("promotion_rule_values_rule_value_active_idx").on(
      table.promotionRuleId,
      table.value,
      table.deletedAt,
    ),
    index("promotion_rule_values_value_active_idx").on(
      table.value,
      table.deletedAt,
    ),
  ],
);

/**
 * Rules are attached in three places, and the place decides the meaning.
 *
 * On the promotion: whether it applies at all. On the application method as a
 * *target* rule: which items it discounts. As a *buy* rule: which items must be
 * in the cart first, for buy-get. Same rule table, three joins — that is how
 * one rule can be reused as both a condition and a target.
 */
export const promotionPromotionRules = sqliteTable(
  "promotion_promotion_rules",
  {
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    promotionRuleId: text("promotion_rule_id")
      .notNull()
      .references(() => promotionRules.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.promotionId, table.promotionRuleId] }),
    index("promotion_promotion_rules_rule_idx").on(table.promotionRuleId),
  ],
);

export const promotionApplicationMethodTargetRules = sqliteTable(
  "promotion_application_method_target_rules",
  {
    applicationMethodId: text("application_method_id")
      .notNull()
      .references(() => promotionApplicationMethods.id, {
        onDelete: "cascade",
      }),
    promotionRuleId: text("promotion_rule_id")
      .notNull()
      .references(() => promotionRules.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.applicationMethodId, table.promotionRuleId],
    }),
    index("promotion_application_method_target_rules_rule_idx").on(
      table.promotionRuleId,
    ),
  ],
);

export const promotionApplicationMethodBuyRules = sqliteTable(
  "promotion_application_method_buy_rules",
  {
    applicationMethodId: text("application_method_id")
      .notNull()
      .references(() => promotionApplicationMethods.id, {
        onDelete: "cascade",
      }),
    promotionRuleId: text("promotion_rule_id")
      .notNull()
      .references(() => promotionRules.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.applicationMethodId, table.promotionRuleId],
    }),
    index("promotion_application_method_buy_rules_rule_idx").on(
      table.promotionRuleId,
    ),
  ],
);
