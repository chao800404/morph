import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, providerData, timestamps } from "./columns";
import type { JsonValue } from "./json";

export type GeoZoneType = "country" | "province" | "city" | "zip";

export type ShippingOptionPriceType = "flat" | "calculated";

/** Shared by shipping-option rules and, in spirit, the promotion rules. */
export type FulfillmentRuleOperator =
  | "in"
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "nin";

/**
 * Fulfillment — where a shop ships, at what price, and what actually shipped.
 *
 * Translated from Medusa's Fulfillment Module; see `region.schema.ts` for the
 * translation rules.
 *
 * Two halves that read as one module:
 *
 * *Configuration* is a funnel. A **fulfillment set** belongs to a location and
 * holds **service zones**; a zone is defined by **geo zones** (this country,
 * that postcode) and offers **shipping options**; an option carries **rules**
 * that decide whether the cart qualifies. Checkout walks it top down to answer
 * "what can this address choose?".
 *
 * *Execution* is a **fulfillment**: the items that left a location, its
 * tracking **labels**, and the address they went to. The address is copied, not
 * referenced — the customer may edit theirs afterwards, and the record of where
 * a parcel was actually sent must not change with it.
 *
 * A **shipping profile** cuts across both: it groups products that ship
 * together, so an option can serve "everything except oversized goods".
 */
export const shippingProfiles = sqliteTable(
  "shipping_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Free-form, e.g. `default`, `gift_card`, `custom`. */
    type: text("type").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("shipping_profiles_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const fulfillmentProviders = sqliteTable("fulfillment_providers", {
  /** The provider's own handle, e.g. `manual_manual`. Not generated. */
  id: text("id").primaryKey(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const fulfillmentSets = sqliteTable(
  "fulfillment_sets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** `shipping` or `pickup`; the two behave differently at checkout. */
    type: text("type").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("fulfillment_sets_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const serviceZones = sqliteTable(
  "service_zones",
  {
    id: text("id").primaryKey(),
    fulfillmentSetId: text("fulfillment_set_id")
      .notNull()
      .references(() => fulfillmentSets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("service_zones_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index("service_zones_set_active_idx").on(
      table.fulfillmentSetId,
      table.deletedAt,
    ),
  ],
);

/**
 * One geographic clause of a service zone.
 *
 * `type` says which of the columns below it actually reads, narrowing from
 * country to postcode. `postalExpression` is JSON because a zip rule is a
 * pattern or a range, not a single value.
 */
export const geoZones = sqliteTable(
  "geo_zones",
  {
    id: text("id").primaryKey(),
    serviceZoneId: text("service_zone_id")
      .notNull()
      .references(() => serviceZones.id, { onDelete: "cascade" }),
    type: text("type").$type<GeoZoneType>().notNull().default("country"),
    countryCode: text("country_code").notNull(),
    provinceCode: text("province_code"),
    city: text("city"),
    postalExpression: text("postal_expression", {
      mode: "json",
    }).$type<JsonValue>(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("geo_zones_zone_active_idx").on(table.serviceZoneId, table.deletedAt),
    index("geo_zones_country_active_idx").on(
      table.countryCode,
      table.deletedAt,
    ),
    index("geo_zones_province_active_idx").on(
      table.provinceCode,
      table.deletedAt,
    ),
    check(
      "geo_zones_type_check",
      sql`${table.type} IN ('country', 'province', 'city', 'zip')`,
    ),
  ],
);

/** The shopper-facing category of an option, e.g. "Express". */
export const shippingOptionTypes = sqliteTable("shipping_option_types", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  code: text("code").notNull(),
  ...timestamps,
});

/**
 * A shipping choice offered inside one service zone.
 *
 * The price is not here. A `flat` option's amount lives in the Pricing module
 * (joined by `shippingOptionPriceSets` in `link.schema.ts`) so it can vary by
 * region and currency the same way a product price does; a `calculated` one is
 * quoted by the provider at checkout and has no stored amount at all.
 */
export const shippingOptions = sqliteTable(
  "shipping_options",
  {
    id: text("id").primaryKey(),
    serviceZoneId: text("service_zone_id")
      .notNull()
      .references(() => serviceZones.id, { onDelete: "cascade" }),
    shippingProfileId: text("shipping_profile_id").references(
      () => shippingProfiles.id,
      { onDelete: "set null" },
    ),
    providerId: text("provider_id").references(() => fulfillmentProviders.id, {
      onDelete: "set null",
    }),
    shippingOptionTypeId: text("shipping_option_type_id").references(
      () => shippingOptionTypes.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    priceType: text("price_type")
      .$type<ShippingOptionPriceType>()
      .notNull()
      .default("flat"),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("shipping_options_zone_active_idx").on(
      table.serviceZoneId,
      table.deletedAt,
    ),
    index("shipping_options_profile_active_idx").on(
      table.shippingProfileId,
      table.deletedAt,
    ),
    check(
      "shipping_options_price_type_check",
      sql`${table.priceType} IN ('flat', 'calculated')`,
    ),
  ],
);

/** e.g. `total gte 10000` — free shipping over a hundred. */
export const shippingOptionRules = sqliteTable(
  "shipping_option_rules",
  {
    id: text("id").primaryKey(),
    shippingOptionId: text("shipping_option_id")
      .notNull()
      .references(() => shippingOptions.id, { onDelete: "cascade" }),
    attribute: text("attribute").notNull(),
    operator: text("operator").$type<FulfillmentRuleOperator>().notNull(),
    // JSON, not text: `in` and `nin` take a list.
    value: text("value", { mode: "json" }).$type<JsonValue>(),
    ...timestamps,
  },
  (table) => [
    index("shipping_option_rules_option_active_idx").on(
      table.shippingOptionId,
      table.deletedAt,
    ),
    check(
      "shipping_option_rules_operator_check",
      sql`${table.operator} IN ('in', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'nin')`,
    ),
  ],
);

/** A snapshot of where a parcel was sent. Never updated after the fact. */
export const fulfillmentAddresses = sqliteTable("fulfillment_addresses", {
  id: text("id").primaryKey(),
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

/**
 * One shipment.
 *
 * The timestamps are the state machine — there is no `status` column. A
 * fulfillment is packed, then shipped, then delivered, or cancelled, and each
 * transition is the moment it happened rather than a word that loses the when.
 */
export const fulfillments = sqliteTable(
  "fulfillments",
  {
    id: text("id").primaryKey(),
    /** A `stockLocations.id`. Plain text: different module. */
    locationId: text("location_id").notNull(),
    providerId: text("provider_id").references(() => fulfillmentProviders.id, {
      onDelete: "set null",
    }),
    shippingOptionId: text("shipping_option_id").references(
      () => shippingOptions.id,
      { onDelete: "set null" },
    ),
    deliveryAddressId: text("delivery_address_id").references(
      () => fulfillmentAddresses.id,
      { onDelete: "set null" },
    ),
    packedAt: text("packed_at"),
    shippedAt: text("shipped_at"),
    deliveredAt: text("delivered_at"),
    canceledAt: text("canceled_at"),
    markedShippedBy: text("marked_shipped_by"),
    createdBy: text("created_by"),
    requiresShipping: integer("requires_shipping", { mode: "boolean" })
      .notNull()
      .default(true),
    data: providerData("data"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("fulfillments_location_active_idx").on(
      table.locationId,
      table.deletedAt,
    ),
    index("fulfillments_option_active_idx").on(
      table.shippingOptionId,
      table.deletedAt,
    ),
  ],
);

/**
 * What went in the box.
 *
 * The title, SKU and barcode are copied rather than joined: the parcel's
 * contents must still read correctly after the variant is renamed or deleted.
 */
export const fulfillmentItems = sqliteTable(
  "fulfillment_items",
  {
    id: text("id").primaryKey(),
    fulfillmentId: text("fulfillment_id")
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode").notNull(),
    quantity: integer("quantity").notNull(),
    /** An `orderLineItems.id`. Plain text: different module. */
    lineItemId: text("line_item_id"),
    /** An `inventoryItems.id`. Plain text: different module. */
    inventoryItemId: text("inventory_item_id"),
    ...timestamps,
  },
  (table) => [
    index("fulfillment_items_fulfillment_active_idx").on(
      table.fulfillmentId,
      table.deletedAt,
    ),
    index("fulfillment_items_line_item_active_idx").on(
      table.lineItemId,
      table.deletedAt,
    ),
    index("fulfillment_items_inventory_item_active_idx").on(
      table.inventoryItemId,
      table.deletedAt,
    ),
    check("fulfillment_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);

/** A tracking number. Many per fulfillment — one parcel is not one box. */
export const fulfillmentLabels = sqliteTable(
  "fulfillment_labels",
  {
    id: text("id").primaryKey(),
    fulfillmentId: text("fulfillment_id")
      .notNull()
      .references(() => fulfillments.id, { onDelete: "cascade" }),
    trackingNumber: text("tracking_number").notNull(),
    trackingUrl: text("tracking_url").notNull(),
    labelUrl: text("label_url").notNull(),
    ...timestamps,
  },
  (table) => [
    index("fulfillment_labels_fulfillment_active_idx").on(
      table.fulfillmentId,
      table.deletedAt,
    ),
  ],
);
