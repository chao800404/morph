import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { metadata, providerData, timestamps } from "./columns";
import type { JsonValue } from "./json";

export type OrderStatus =
  | "pending"
  | "completed"
  | "draft"
  | "archived"
  | "canceled"
  | "requires_action";

export type OrderChangeStatus =
  | "pending"
  | "requested"
  | "confirmed"
  | "declined"
  | "canceled";

export type ReturnStatus =
  | "open"
  | "requested"
  | "received"
  | "partially_received"
  | "canceled";

export type ClaimType = "refund" | "replace";

export type ClaimReason =
  | "missing_item"
  | "wrong_item"
  | "production_failure"
  | "other";

/**
 * Orders — and everything that can happen to one afterwards.
 *
 * Translated from Medusa's Order Module; see `region.schema.ts` for the
 * translation rules. This is the largest module by a wide margin, and the size
 * comes from one decision worth understanding before reading the tables:
 *
 * **An order is versioned, not edited.** `orders.version` starts at 1 and every
 * accepted change increments it. The child tables that can differ between
 * versions — `orderItems`, `orderShippings`, `orderSummaries`,
 * `orderTransactions`, `orderCreditLines` — carry a `version` of their own, so
 * reading an order means reading the rows at one version. That is why
 * quantities live in `orderItems` rather than on the line item: the line item
 * is the immutable description of a product, and the quantity is the part that
 * a return or an exchange changes.
 *
 * **A change is proposed before it is applied.** `orderChanges` and
 * `orderChangeActions` are the pending diff — requested by whom, confirmed by
 * whom, declined why. Returns, claims and exchanges are the three shapes a
 * confirmed change takes, and each brings its own items, shipping and
 * transactions. `orderTransactions` is the ledger that ties them together: one
 * row per movement of money, positive or negative, so the balance owed is a
 * sum rather than a status.
 *
 * Totals are computed, never stored — the same rule as `cart.schema.ts`. The
 * one exception is `orderSummaries.totals`, a JSON snapshot per version, kept
 * because a historical invoice must not be recalculated with today's tax rates.
 *
 * `displayId` is the human-facing number. Medusa uses a Postgres sequence; D1
 * has none, so the DAL assigns it and must do so inside the same batch that
 * inserts the order.
 */
export const orderAddresses = sqliteTable(
  "order_addresses",
  {
    id: text("id").primaryKey(),
    /** A `customers.id`. Plain text: different module. */
    customerId: text("customer_id"),
    company: text("company"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    address1: text("address_1"),
    address2: text("address_2"),
    city: text("city"),
    countryCode: text("country_code"),
    province: text("province"),
    postalCode: text("postal_code"),
    phone: text("phone"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [index("order_addresses_customer_idx").on(table.customerId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    displayId: integer("display_id").notNull(),
    /** An author-supplied number that replaces `displayId` on documents. */
    customDisplayId: text("custom_display_id"),
    version: integer("version").notNull().default(1),
    status: text("status").$type<OrderStatus>().notNull().default("pending"),
    /** All three are plain text: each belongs to a different module. */
    regionId: text("region_id"),
    customerId: text("customer_id"),
    salesChannelId: text("sales_channel_id"),
    email: text("email"),
    currencyCode: text("currency_code").notNull(),
    /** BCP 47 language tag, e.g. `en-US`. */
    locale: text("locale"),
    isDraftOrder: integer("is_draft_order", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Suppresses the customer emails this order would otherwise send. */
    noNotification: integer("no_notification", { mode: "boolean" }),
    shippingAddressId: text("shipping_address_id").references(
      () => orderAddresses.id,
      { onDelete: "set null" },
    ),
    billingAddressId: text("billing_address_id").references(
      () => orderAddresses.id,
      { onDelete: "set null" },
    ),
    canceledAt: text("canceled_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("orders_active_display_id_unique")
      .on(table.displayId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("orders_active_custom_display_id_unique")
      .on(table.customDisplayId)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.customDisplayId} IS NOT NULL`,
      ),
    index("orders_customer_active_idx").on(table.customerId, table.deletedAt),
    index("orders_status_active_idx").on(table.status, table.deletedAt),
    index("orders_region_active_idx").on(table.regionId, table.deletedAt),
    index("orders_sales_channel_active_idx").on(
      table.salesChannelId,
      table.deletedAt,
    ),
    index("orders_draft_active_idx").on(table.isDraftOrder, table.deletedAt),
    check(
      "orders_status_check",
      sql`${table.status} IN ('pending', 'completed', 'draft', 'archived', 'canceled', 'requires_action')`,
    ),
    check(
      "orders_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
  ],
);

/**
 * The computed totals for one version, frozen.
 *
 * The only stored totals in the module. An invoice issued last year must show
 * last year's numbers even after a tax rate changes, and recomputing is the one
 * thing that cannot promise that.
 */
export const orderSummaries = sqliteTable(
  "order_summaries",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    totals: text("totals", { mode: "json" }).$type<JsonValue>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("order_summaries_order_version_unique")
      .on(table.orderId, table.version)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/**
 * What was bought, as described at the time.
 *
 * No `orderId` and no quantity: an order reaches its items through
 * `orderItems`, which is versioned. This row is the immutable snapshot, copied
 * from the catalogue exactly as `cartLineItems` explains.
 */
export const orderLineItems = sqliteTable(
  "order_line_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    thumbnail: text("thumbnail"),
    variantId: text("variant_id"),
    productId: text("product_id"),
    productTitle: text("product_title"),
    productDescription: text("product_description"),
    productSubtitle: text("product_subtitle"),
    productType: text("product_type"),
    productTypeId: text("product_type_id"),
    productCollection: text("product_collection"),
    productHandle: text("product_handle"),
    variantSku: text("variant_sku"),
    variantBarcode: text("variant_barcode"),
    variantTitle: text("variant_title"),
    variantOptionValues: text("variant_option_values", {
      mode: "json",
    }).$type<JsonValue>(),
    requiresShipping: integer("requires_shipping", { mode: "boolean" })
      .notNull()
      .default(true),
    isDiscountable: integer("is_discountable", { mode: "boolean" })
      .notNull()
      .default(true),
    isGiftcard: integer("is_giftcard", { mode: "boolean" })
      .notNull()
      .default(false),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    isCustomPrice: integer("is_custom_price", { mode: "boolean" })
      .notNull()
      .default(false),
    unitPrice: integer("unit_price"),
    compareAtUnitPrice: integer("compare_at_unit_price"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_line_items_variant_active_idx").on(
      table.variantId,
      table.deletedAt,
    ),
    index("order_line_items_product_active_idx").on(
      table.productId,
      table.deletedAt,
    ),
  ],
);

/**
 * A line item's place in one version of one order.
 *
 * The seven quantity columns are the item's lifecycle, each a count rather than
 * a state: three of five fulfilled, two returned, one written off. A single
 * status could not describe a part-shipped, part-returned line, which is the
 * normal case once a return exists.
 */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    quantity: integer("quantity").notNull(),
    fulfilledQuantity: integer("fulfilled_quantity").notNull().default(0),
    deliveredQuantity: integer("delivered_quantity").notNull().default(0),
    shippedQuantity: integer("shipped_quantity").notNull().default(0),
    returnRequestedQuantity: integer("return_requested_quantity")
      .notNull()
      .default(0),
    returnReceivedQuantity: integer("return_received_quantity")
      .notNull()
      .default(0),
    returnDismissedQuantity: integer("return_dismissed_quantity")
      .notNull()
      .default(0),
    writtenOffQuantity: integer("written_off_quantity").notNull().default(0),
    unitPrice: integer("unit_price"),
    compareAtUnitPrice: integer("compare_at_unit_price"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("order_items_order_version_item_unique")
      .on(table.orderId, table.version, table.itemId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("order_items_item_active_idx").on(table.itemId, table.deletedAt),
    check("order_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);

export const orderLineItemAdjustments = sqliteTable(
  "order_line_item_adjustments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    description: text("description"),
    code: text("code"),
    amount: integer("amount").notNull(),
    providerId: text("provider_id"),
    /** A `promotions.id`. Plain text: different module. */
    promotionId: text("promotion_id"),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    index("order_line_item_adjustments_item_idx").on(table.itemId),
    check(
      "order_line_item_adjustments_amount_check",
      sql`${table.amount} >= 0`,
    ),
  ],
);

/** `rate` is a percentage as a float, matching `taxRates.rate`. */
export const orderLineItemTaxLines = sqliteTable(
  "order_line_item_tax_lines",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    description: text("description"),
    code: text("code").notNull(),
    rate: real("rate").notNull(),
    providerId: text("provider_id"),
    /** A `taxRates.id`. Plain text: different module. */
    taxRateId: text("tax_rate_id"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [index("order_line_item_tax_lines_item_idx").on(table.itemId)],
);

export const orderShippingMethods = sqliteTable(
  "order_shipping_methods",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description", { mode: "json" }).$type<JsonValue>(),
    amount: integer("amount").notNull(),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    /** The agent typed a price instead of taking the option's. */
    isCustomAmount: integer("is_custom_amount", { mode: "boolean" })
      .notNull()
      .default(false),
    /** A `shippingOptions.id`. Plain text: different module. */
    shippingOptionId: text("shipping_option_id"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_shipping_methods_option_idx").on(table.shippingOptionId),
    check("order_shipping_methods_amount_check", sql`${table.amount} >= 0`),
  ],
);

/**
 * Which shipping method belongs to which version of which thing.
 *
 * The parent is an order, or a return, or an exchange, or a claim — a return
 * ships too, in the other direction, and it needs its own method and its own
 * cost. Exactly one of the four is set.
 */
export const orderShippings = sqliteTable(
  "order_shippings",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => orderShippingMethods.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    returnId: text("return_id").references(() => returns.id, {
      onDelete: "cascade",
    }),
    exchangeId: text("exchange_id").references(() => orderExchanges.id, {
      onDelete: "cascade",
    }),
    claimId: text("claim_id").references(() => orderClaims.id, {
      onDelete: "cascade",
    }),
    ...timestamps,
  },
  (table) => [
    index("order_shippings_order_version_active_idx").on(
      table.orderId,
      table.version,
      table.deletedAt,
    ),
    index("order_shippings_method_active_idx").on(
      table.shippingMethodId,
      table.deletedAt,
    ),
    index("order_shippings_return_active_idx").on(
      table.returnId,
      table.deletedAt,
    ),
    index("order_shippings_exchange_active_idx").on(
      table.exchangeId,
      table.deletedAt,
    ),
    index("order_shippings_claim_active_idx").on(
      table.claimId,
      table.deletedAt,
    ),
  ],
);

export const orderShippingMethodAdjustments = sqliteTable(
  "order_shipping_method_adjustments",
  {
    id: text("id").primaryKey(),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => orderShippingMethods.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    description: text("description"),
    code: text("code"),
    amount: integer("amount").notNull(),
    providerId: text("provider_id"),
    /** A `promotions.id`. Plain text: different module. */
    promotionId: text("promotion_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("order_shipping_method_adjustments_version_method_unique")
      .on(table.version, table.shippingMethodId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const orderShippingMethodTaxLines = sqliteTable(
  "order_shipping_method_tax_lines",
  {
    id: text("id").primaryKey(),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => orderShippingMethods.id, { onDelete: "cascade" }),
    description: text("description"),
    code: text("code").notNull(),
    rate: real("rate").notNull(),
    providerId: text("provider_id"),
    /** A `taxRates.id`. Plain text: different module. */
    taxRateId: text("tax_rate_id"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_shipping_method_tax_lines_method_idx").on(
      table.shippingMethodId,
    ),
  ],
);

/**
 * The money ledger.
 *
 * One row per movement — a capture, a refund, a credit. The balance owed is
 * their sum, which is why a partly refunded order needs no extra status: the
 * arithmetic already says where it stands. Amounts may be negative.
 */
export const orderTransactions = sqliteTable(
  "order_transactions",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    amount: integer("amount").notNull(),
    currencyCode: text("currency_code").notNull(),
    /** Where the movement came from, e.g. `payment` / a payment id. */
    reference: text("reference"),
    referenceId: text("reference_id"),
    returnId: text("return_id").references(() => returns.id, {
      onDelete: "cascade",
    }),
    exchangeId: text("exchange_id").references(() => orderExchanges.id, {
      onDelete: "cascade",
    }),
    claimId: text("claim_id").references(() => orderClaims.id, {
      onDelete: "cascade",
    }),
    ...timestamps,
  },
  (table) => [
    index("order_transactions_order_version_active_idx").on(
      table.orderId,
      table.version,
      table.deletedAt,
    ),
    index("order_transactions_reference_active_idx").on(
      table.referenceId,
      table.deletedAt,
    ),
    index("order_transactions_return_active_idx").on(
      table.returnId,
      table.deletedAt,
    ),
  ],
);

/** Store credit and gift cards applied to the order. See `cartCreditLines`. */
export const orderCreditLines = sqliteTable(
  "order_credit_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    reference: text("reference"),
    referenceId: text("reference_id"),
    amount: integer("amount").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_credit_lines_order_version_active_idx").on(
      table.orderId,
      table.version,
      table.deletedAt,
    ),
  ],
);

/**
 * A proposed edit, before it becomes a new version.
 *
 * The four actor columns are the point of the table: an exchange requested by a
 * customer and confirmed by an agent is a different record from one an agent
 * did unilaterally, and a declined change has to keep its reason.
 */
export const orderChanges = sqliteTable(
  "order_changes",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Free-form: `edit`, `return_request`, `exchange`, `claim`. */
    changeType: text("change_type"),
    description: text("description"),
    status: text("status").$type<OrderChangeStatus>().default("pending"),
    internalNote: text("internal_note"),
    returnId: text("return_id"),
    claimId: text("claim_id"),
    exchangeId: text("exchange_id"),
    createdBy: text("created_by"),
    requestedBy: text("requested_by"),
    requestedAt: text("requested_at"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: text("confirmed_at"),
    declinedBy: text("declined_by"),
    declinedReason: text("declined_reason"),
    declinedAt: text("declined_at"),
    canceledBy: text("canceled_by"),
    canceledAt: text("canceled_at"),
    /** Whether the order's promotions survive into the new version. */
    carryOverPromotions: integer("carry_over_promotions", { mode: "boolean" }),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_changes_order_version_active_idx").on(
      table.orderId,
      table.version,
      table.deletedAt,
    ),
    index("order_changes_status_active_idx").on(table.status, table.deletedAt),
    check(
      "order_changes_status_check",
      sql`${table.status} IS NULL OR ${table.status} IN ('pending', 'requested', 'confirmed', 'declined', 'canceled')`,
    ),
  ],
);

/**
 * One line of a proposed edit, e.g. "add two of this variant".
 *
 * `applied` is what separates the proposal from the result: the actions are
 * written when the change is drafted and flipped when it is confirmed, so a
 * pending change can be previewed without touching the order.
 *
 * `ordering` must be assigned by the DAL — Medusa uses a Postgres sequence and
 * D1 has none, the same constraint as `orders.displayId`.
 */
export const orderChangeActions = sqliteTable(
  "order_change_actions",
  {
    id: text("id").primaryKey(),
    orderChangeId: text("order_change_id").references(() => orderChanges.id, {
      onDelete: "cascade",
    }),
    orderId: text("order_id").notNull(),
    returnId: text("return_id"),
    claimId: text("claim_id"),
    exchangeId: text("exchange_id"),
    ordering: integer("ordering").notNull(),
    version: integer("version"),
    reference: text("reference"),
    referenceId: text("reference_id"),
    action: text("action").notNull(),
    details: text("details", { mode: "json" })
      .$type<JsonValue>()
      .notNull()
      .default(sql`'{}'`),
    amount: integer("amount"),
    internalNote: text("internal_note"),
    applied: integer("applied", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("order_change_actions_change_active_idx").on(
      table.orderChangeId,
      table.deletedAt,
    ),
    index("order_change_actions_order_active_idx").on(
      table.orderId,
      table.deletedAt,
    ),
    index("order_change_actions_ordering_active_idx").on(
      table.ordering,
      table.deletedAt,
    ),
  ],
);

/** The author-managed list a return item picks its reason from. */
export const returnReasons = sqliteTable(
  "return_reasons",
  {
    id: text("id").primaryKey(),
    value: text("value").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    // Two levels in practice: "Damaged" then "Damaged in transit".
    parentReturnReasonId: text("parent_return_reason_id").references(
      (): AnySQLiteColumn => returnReasons.id,
      { onDelete: "cascade" },
    ),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("return_reasons_active_value_unique")
      .on(table.value)
      .where(sql`${table.deletedAt} IS NULL`),
    index("return_reasons_parent_active_idx").on(
      table.parentReturnReasonId,
      table.deletedAt,
    ),
  ],
);

/**
 * Goods coming back.
 *
 * `claimId` and `exchangeId` are plain text, not foreign keys, even though both
 * targets are in this file. A claim creates its return, so the return row
 * exists first and `orderClaims.returnId` is the real reference; storing the
 * reverse as a foreign key too would make the pair mutually dependent and leave
 * no legal insert order in SQLite.
 */
export const returns = sqliteTable(
  "returns",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    displayId: integer("display_id").notNull(),
    orderVersion: integer("order_version").notNull(),
    status: text("status").$type<ReturnStatus>().notNull().default("open"),
    /** A `stockLocations.id`. Plain text: different module. */
    locationId: text("location_id"),
    claimId: text("claim_id"),
    exchangeId: text("exchange_id"),
    refundAmount: integer("refund_amount"),
    noNotification: integer("no_notification", { mode: "boolean" }),
    createdBy: text("created_by"),
    requestedAt: text("requested_at"),
    receivedAt: text("received_at"),
    canceledAt: text("canceled_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("returns_order_active_idx").on(table.orderId, table.deletedAt),
    index("returns_display_id_active_idx").on(table.displayId, table.deletedAt),
    index("returns_claim_active_idx").on(table.claimId, table.deletedAt),
    index("returns_exchange_active_idx").on(table.exchangeId, table.deletedAt),
    check(
      "returns_status_check",
      sql`${table.status} IN ('open', 'requested', 'received', 'partially_received', 'canceled')`,
    ),
  ],
);

/**
 * One line of a return.
 *
 * `receivedQuantity` and `damagedQuantity` are separate counts because they
 * settle differently: what came back damaged is not restocked, but it may still
 * be refunded.
 */
export const returnItems = sqliteTable(
  "return_items",
  {
    id: text("id").primaryKey(),
    returnId: text("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    reasonId: text("reason_id").references(() => returnReasons.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    damagedQuantity: integer("damaged_quantity").notNull().default(0),
    note: text("note"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("return_items_return_active_idx").on(table.returnId, table.deletedAt),
    index("return_items_item_active_idx").on(table.itemId, table.deletedAt),
    check("return_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);

/**
 * A claim — something was wrong with what arrived.
 *
 * `refund` sends money back, `replace` sends another one out. The distinction
 * from an exchange is who chose: a claim is the shop's fault, an exchange is
 * the customer changing their mind, and only the claim carries a `reason` and
 * photographs.
 */
export const orderClaims = sqliteTable(
  "order_claims",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    returnId: text("return_id").references(() => returns.id, {
      onDelete: "set null",
    }),
    displayId: integer("display_id").notNull(),
    orderVersion: integer("order_version").notNull(),
    type: text("type").$type<ClaimType>().notNull(),
    refundAmount: integer("refund_amount"),
    noNotification: integer("no_notification", { mode: "boolean" }),
    createdBy: text("created_by"),
    canceledAt: text("canceled_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_claims_order_active_idx").on(table.orderId, table.deletedAt),
    index("order_claims_return_active_idx").on(table.returnId, table.deletedAt),
    index("order_claims_display_id_active_idx").on(
      table.displayId,
      table.deletedAt,
    ),
    check(
      "order_claims_type_check",
      sql`${table.type} IN ('refund', 'replace')`,
    ),
  ],
);

/**
 * One line of a claim.
 *
 * `isAdditionalItem` splits the two halves of a replacement: false is the item
 * being complained about, true is the one being sent instead.
 */
export const orderClaimItems = sqliteTable(
  "order_claim_items",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => orderClaims.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    reason: text("reason").$type<ClaimReason>(),
    quantity: integer("quantity").notNull(),
    isAdditionalItem: integer("is_additional_item", { mode: "boolean" })
      .notNull()
      .default(false),
    note: text("note"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_claim_items_claim_active_idx").on(
      table.claimId,
      table.deletedAt,
    ),
    index("order_claim_items_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    check("order_claim_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "order_claim_items_reason_check",
      sql`${table.reason} IS NULL OR ${table.reason} IN ('missing_item', 'wrong_item', 'production_failure', 'other')`,
    ),
  ],
);

/**
 * The customer's photograph of the damage.
 *
 * A bare `url`, unlike `productAssets`, which references the asset library:
 * this image is uploaded by a shopper as evidence, not authored by the shop,
 * and it must not appear in the media picker.
 */
export const orderClaimItemImages = sqliteTable(
  "order_claim_item_images",
  {
    id: text("id").primaryKey(),
    claimItemId: text("claim_item_id")
      .notNull()
      .references(() => orderClaimItems.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_claim_item_images_item_active_idx").on(
      table.claimItemId,
      table.deletedAt,
    ),
  ],
);

/**
 * An exchange — send this back, send that out.
 *
 * `differenceDue` may be negative: swapping for something cheaper owes the
 * customer money, and the ledger in `orderTransactions` is what settles it.
 */
export const orderExchanges = sqliteTable(
  "order_exchanges",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    returnId: text("return_id").references(() => returns.id, {
      onDelete: "set null",
    }),
    displayId: integer("display_id").notNull(),
    orderVersion: integer("order_version").notNull(),
    differenceDue: integer("difference_due"),
    /** Ship the replacement before the original comes back. */
    allowBackorder: integer("allow_backorder", { mode: "boolean" })
      .notNull()
      .default(false),
    noNotification: integer("no_notification", { mode: "boolean" }),
    createdBy: text("created_by"),
    canceledAt: text("canceled_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_exchanges_order_active_idx").on(
      table.orderId,
      table.deletedAt,
    ),
    index("order_exchanges_return_active_idx").on(
      table.returnId,
      table.deletedAt,
    ),
    index("order_exchanges_display_id_active_idx").on(
      table.displayId,
      table.deletedAt,
    ),
  ],
);

/** What is going out in an exchange. */
export const orderExchangeItems = sqliteTable(
  "order_exchange_items",
  {
    id: text("id").primaryKey(),
    exchangeId: text("exchange_id")
      .notNull()
      .references(() => orderExchanges.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    note: text("note"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("order_exchange_items_exchange_active_idx").on(
      table.exchangeId,
      table.deletedAt,
    ),
    index("order_exchange_items_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    check("order_exchange_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);
