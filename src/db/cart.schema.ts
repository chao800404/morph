import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { metadata, providerData, timestamps } from "./columns";
import type { JsonValue } from "./json";

/**
 * Carts — an order that has not happened yet.
 *
 * Translated from Medusa's Cart Module; see `region.schema.ts` for the
 * translation rules.
 *
 * Two things drive the shape and both survive into `order.schema.ts`:
 *
 * **A line item is a copy, not a pointer.** `variantId` is kept for reporting,
 * but the title, thumbnail, SKU and price are written into the row. A cart can
 * sit for a week; renaming a product, or deleting it, must not silently change
 * what the shopper is looking at or what they agreed to pay.
 *
 * **Totals are not stored.** Medusa marks every one of them computed, and they
 * are derived here too, from the unit prices plus the adjustment and tax-line
 * rows. A stored total is the number that disagrees with its own line items
 * after a promotion changes.
 *
 * Adjustments are discounts, tax lines are tax, and both hang off the item or
 * the shipping method rather than the cart so a receipt can explain itself.
 */
export const cartAddresses = sqliteTable("cart_addresses", {
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
});

export const carts = sqliteTable(
  "carts",
  {
    id: text("id").primaryKey(),
    /** All four are plain text: each belongs to a different module. */
    regionId: text("region_id"),
    customerId: text("customer_id"),
    salesChannelId: text("sales_channel_id"),
    email: text("email"),
    currencyCode: text("currency_code").notNull(),
    /** BCP 47 language tag, e.g. `en-US`. */
    locale: text("locale"),
    shippingAddressId: text("shipping_address_id").references(
      () => cartAddresses.id,
      { onDelete: "set null" },
    ),
    billingAddressId: text("billing_address_id").references(
      () => cartAddresses.id,
      { onDelete: "set null" },
    ),
    /** Set when the cart became an order. A completed cart is never edited. */
    completedAt: text("completed_at"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("carts_customer_active_idx").on(table.customerId, table.deletedAt),
    index("carts_region_active_idx").on(table.regionId, table.deletedAt),
    index("carts_sales_channel_active_idx").on(
      table.salesChannelId,
      table.deletedAt,
    ),
    check(
      "carts_currency_code_check",
      sql`length(${table.currencyCode}) = 3 AND ${table.currencyCode} = lower(${table.currencyCode})`,
    ),
  ],
);

export const cartLineItems = sqliteTable(
  "cart_line_items",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    thumbnail: text("thumbnail"),
    quantity: integer("quantity").notNull(),
    // The catalogue snapshot. Plain text ids, and every label beside them is a
    // copy taken when the item was added.
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
    /** Set by an agent overriding the catalogue price. */
    isCustomPrice: integer("is_custom_price", { mode: "boolean" })
      .notNull()
      .default(false),
    unitPrice: integer("unit_price").notNull(),
    /** The struck-through price, when a price list marked this a sale. */
    compareAtUnitPrice: integer("compare_at_unit_price"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("cart_line_items_cart_active_idx").on(table.cartId, table.deletedAt),
    index("cart_line_items_variant_active_idx").on(
      table.variantId,
      table.deletedAt,
    ),
    index("cart_line_items_product_active_idx").on(
      table.productId,
      table.deletedAt,
    ),
    check("cart_line_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);

/** A discount on one line item. `amount` is what came off, in minor units. */
export const cartLineItemAdjustments = sqliteTable(
  "cart_line_item_adjustments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => cartLineItems.id, { onDelete: "cascade" }),
    description: text("description"),
    code: text("code"),
    amount: integer("amount").notNull(),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    providerId: text("provider_id"),
    /** A `promotions.id`. Plain text: different module. */
    promotionId: text("promotion_id"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("cart_line_item_adjustments_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    index("cart_line_item_adjustments_promotion_active_idx").on(
      table.promotionId,
      table.deletedAt,
    ),
    check("cart_line_item_adjustments_amount_check", sql`${table.amount} >= 0`),
  ],
);

/**
 * Tax on one line item.
 *
 * `rate` is a percentage as a float, matching `taxRates.rate` — 8.25 is 8.25%.
 * The rate is copied rather than joined for the same reason the title is: the
 * jurisdiction may change its rate before the cart is paid.
 */
export const cartLineItemTaxLines = sqliteTable(
  "cart_line_item_tax_lines",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => cartLineItems.id, { onDelete: "cascade" }),
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
    index("cart_line_item_tax_lines_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    index("cart_line_item_tax_lines_rate_active_idx").on(
      table.taxRateId,
      table.deletedAt,
    ),
  ],
);

export const cartShippingMethods = sqliteTable(
  "cart_shipping_methods",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // JSON rather than text: Medusa stores the option's translated
    // descriptions here, not one string.
    description: text("description", { mode: "json" }).$type<JsonValue>(),
    amount: integer("amount").notNull(),
    isTaxInclusive: integer("is_tax_inclusive", { mode: "boolean" })
      .notNull()
      .default(false),
    /** A `shippingOptions.id`. Plain text: different module. */
    shippingOptionId: text("shipping_option_id"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("cart_shipping_methods_cart_active_idx").on(
      table.cartId,
      table.deletedAt,
    ),
    index("cart_shipping_methods_option_active_idx").on(
      table.shippingOptionId,
      table.deletedAt,
    ),
    check("cart_shipping_methods_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const cartShippingMethodAdjustments = sqliteTable(
  "cart_shipping_method_adjustments",
  {
    id: text("id").primaryKey(),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => cartShippingMethods.id, { onDelete: "cascade" }),
    description: text("description"),
    code: text("code"),
    amount: integer("amount").notNull(),
    providerId: text("provider_id"),
    /** A `promotions.id`. Plain text: different module. */
    promotionId: text("promotion_id"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("cart_shipping_method_adjustments_method_active_idx").on(
      table.shippingMethodId,
      table.deletedAt,
    ),
    index("cart_shipping_method_adjustments_promotion_active_idx").on(
      table.promotionId,
      table.deletedAt,
    ),
    check(
      "cart_shipping_method_adjustments_amount_check",
      sql`${table.amount} >= 0`,
    ),
  ],
);

export const cartShippingMethodTaxLines = sqliteTable(
  "cart_shipping_method_tax_lines",
  {
    id: text("id").primaryKey(),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => cartShippingMethods.id, { onDelete: "cascade" }),
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
    index("cart_shipping_method_tax_lines_method_active_idx").on(
      table.shippingMethodId,
      table.deletedAt,
    ),
    index("cart_shipping_method_tax_lines_rate_active_idx").on(
      table.taxRateId,
      table.deletedAt,
    ),
  ],
);

/**
 * Money applied to the cart that is not a payment — store credit, a gift card,
 * the balance of a returned item.
 *
 * `reference` and `referenceId` name where it came from, and are plain text
 * because that source is always in another module.
 */
export const cartCreditLines = sqliteTable(
  "cart_credit_lines",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    reference: text("reference"),
    referenceId: text("reference_id"),
    amount: integer("amount").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("cart_credit_lines_cart_active_idx").on(
      table.cartId,
      table.deletedAt,
    ),
    index("cart_credit_lines_reference_active_idx").on(
      table.reference,
      table.referenceId,
      table.deletedAt,
    ),
  ],
);
