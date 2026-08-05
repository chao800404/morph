import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The joins between modules.
 *
 * Every other `*.schema.ts` file is self-contained: ids that point outside the
 * module are plain `text` with no foreign key, so no two schema files import
 * each other. The relationships still exist, and this is where they are
 * declared — the same split Medusa makes with its `link-modules` package.
 *
 * Three consequences the DAL has to respect, none of them visible from the
 * table definitions alone:
 *
 * 1. **No cascade.** SQLite cannot cascade across a link with no foreign key.
 *    Deleting a product must delete its `productSalesChannels` rows explicitly;
 *    nothing else will.
 * 2. **No referential integrity.** A link can outlive either side. Reads should
 *    join and drop the misses rather than trust the row.
 * 3. **Batch by column count.** These are two- and three-column tables, so
 *    `chunkForInsert` allows far more rows per statement than a wide table
 *    does — that is exactly the calculation rules.md §4 warns against
 *    hard-coding.
 *
 * Columns are ids only, plus timestamps. Composite primary keys rather than
 * Medusa's synthetic ids, matching `productTagLinks`: the pair *is* the row.
 *
 * Medusa's `user_rbac_role` and `invite_rbac_role` are absent — the RBAC module
 * is not translated, so there is nothing for them to point at.
 */
const linkTimestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/** Which channels list a product. No rows means "not listed anywhere". */
export const productSalesChannels = sqliteTable(
  "product_sales_channels",
  {
    productId: text("product_id").notNull(),
    salesChannelId: text("sales_channel_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.salesChannelId] }),
    index("product_sales_channels_channel_idx").on(table.salesChannelId),
  ],
);

/** Which shipping profile a product ships under. */
export const productShippingProfiles = sqliteTable(
  "product_shipping_profiles",
  {
    productId: text("product_id").notNull(),
    shippingProfileId: text("shipping_profile_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.shippingProfileId] }),
    index("product_shipping_profiles_profile_idx").on(table.shippingProfileId),
  ],
);

/**
 * A variant's prices.
 *
 * The variant owns a price *set*, not a price — see `pricing.schema.ts` for why
 * the indirection is what buys per-region and per-quantity pricing.
 */
export const productVariantPriceSets = sqliteTable(
  "product_variant_price_sets",
  {
    variantId: text("variant_id").notNull(),
    priceSetId: text("price_set_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.priceSetId] }),
    index("product_variant_price_sets_price_set_idx").on(table.priceSetId),
  ],
);

/**
 * What stock a variant consumes.
 *
 * `requiredQuantity` is why this link carries a column of its own: a boxed set
 * of six sells one variant and draws six from inventory.
 */
export const productVariantInventoryItems = sqliteTable(
  "product_variant_inventory_items",
  {
    variantId: text("variant_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    requiredQuantity: integer("required_quantity").notNull().default(1),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.inventoryItemId] }),
    index("product_variant_inventory_items_item_idx").on(table.inventoryItemId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Channels, locations and keys                                               */
/* -------------------------------------------------------------------------- */

/** Which locations a channel may ship from. */
export const salesChannelStockLocations = sqliteTable(
  "sales_channel_stock_locations",
  {
    salesChannelId: text("sales_channel_id").notNull(),
    stockLocationId: text("stock_location_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.salesChannelId, table.stockLocationId] }),
    index("sales_channel_stock_locations_location_idx").on(
      table.stockLocationId,
    ),
  ],
);

/** What a publishable key resolves to. This is the key's entire authority. */
export const publishableApiKeySalesChannels = sqliteTable(
  "publishable_api_key_sales_channels",
  {
    apiKeyId: text("api_key_id").notNull(),
    salesChannelId: text("sales_channel_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.apiKeyId, table.salesChannelId] }),
    index("publishable_api_key_sales_channels_channel_idx").on(
      table.salesChannelId,
    ),
  ],
);

export const locationFulfillmentSets = sqliteTable(
  "location_fulfillment_sets",
  {
    stockLocationId: text("stock_location_id").notNull(),
    fulfillmentSetId: text("fulfillment_set_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.stockLocationId, table.fulfillmentSetId] }),
    index("location_fulfillment_sets_set_idx").on(table.fulfillmentSetId),
  ],
);

export const locationFulfillmentProviders = sqliteTable(
  "location_fulfillment_providers",
  {
    stockLocationId: text("stock_location_id").notNull(),
    fulfillmentProviderId: text("fulfillment_provider_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({
      columns: [table.stockLocationId, table.fulfillmentProviderId],
    }),
    index("location_fulfillment_providers_provider_idx").on(
      table.fulfillmentProviderId,
    ),
  ],
);

/** A flat-rate shipping option's price, held in the Pricing module. */
export const shippingOptionPriceSets = sqliteTable(
  "shipping_option_price_sets",
  {
    shippingOptionId: text("shipping_option_id").notNull(),
    priceSetId: text("price_set_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.shippingOptionId, table.priceSetId] }),
    index("shipping_option_price_sets_price_set_idx").on(table.priceSetId),
  ],
);

/** Which providers a region accepts. */
export const regionPaymentProviders = sqliteTable(
  "region_payment_providers",
  {
    regionId: text("region_id").notNull(),
    paymentProviderId: text("payment_provider_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.regionId, table.paymentProviderId] }),
    index("region_payment_providers_provider_idx").on(table.paymentProviderId),
  ],
);

/** A customer's saved identity with a payment provider. */
export const customerAccountHolders = sqliteTable(
  "customer_account_holders",
  {
    customerId: text("customer_id").notNull(),
    accountHolderId: text("account_holder_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.customerId, table.accountHolderId] }),
    index("customer_account_holders_holder_idx").on(table.accountHolderId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Checkout and after                                                         */
/* -------------------------------------------------------------------------- */

export const cartPaymentCollections = sqliteTable(
  "cart_payment_collections",
  {
    cartId: text("cart_id").notNull(),
    paymentCollectionId: text("payment_collection_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.paymentCollectionId] }),
    index("cart_payment_collections_collection_idx").on(
      table.paymentCollectionId,
    ),
  ],
);

/** Which promotions a cart has applied. */
export const cartPromotions = sqliteTable(
  "cart_promotions",
  {
    cartId: text("cart_id").notNull(),
    promotionId: text("promotion_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.promotionId] }),
    index("cart_promotions_promotion_idx").on(table.promotionId),
  ],
);

/** The cart an order came from. Kept for auditing a completed checkout. */
export const orderCarts = sqliteTable(
  "order_carts",
  {
    orderId: text("order_id").notNull(),
    cartId: text("cart_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.cartId] }),
    index("order_carts_cart_idx").on(table.cartId),
  ],
);

export const orderPromotions = sqliteTable(
  "order_promotions",
  {
    orderId: text("order_id").notNull(),
    promotionId: text("promotion_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.promotionId] }),
    index("order_promotions_promotion_idx").on(table.promotionId),
  ],
);

export const orderPaymentCollections = sqliteTable(
  "order_payment_collections",
  {
    orderId: text("order_id").notNull(),
    paymentCollectionId: text("payment_collection_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.paymentCollectionId] }),
    index("order_payment_collections_collection_idx").on(
      table.paymentCollectionId,
    ),
  ],
);

/** A claim can take its own payment — a replacement may cost more. */
export const orderClaimPaymentCollections = sqliteTable(
  "order_claim_payment_collections",
  {
    claimId: text("claim_id").notNull(),
    paymentCollectionId: text("payment_collection_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.paymentCollectionId] }),
    index("order_claim_payment_collections_collection_idx").on(
      table.paymentCollectionId,
    ),
  ],
);

/** Likewise an exchange, when the difference is due from the customer. */
export const orderExchangePaymentCollections = sqliteTable(
  "order_exchange_payment_collections",
  {
    exchangeId: text("exchange_id").notNull(),
    paymentCollectionId: text("payment_collection_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.exchangeId, table.paymentCollectionId] }),
    index("order_exchange_payment_collections_collection_idx").on(
      table.paymentCollectionId,
    ),
  ],
);

export const orderFulfillments = sqliteTable(
  "order_fulfillments",
  {
    orderId: text("order_id").notNull(),
    fulfillmentId: text("fulfillment_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.fulfillmentId] }),
    index("order_fulfillments_fulfillment_idx").on(table.fulfillmentId),
  ],
);

/** The inbound shipment that carries a return back. */
export const returnFulfillments = sqliteTable(
  "return_fulfillments",
  {
    returnId: text("return_id").notNull(),
    fulfillmentId: text("fulfillment_id").notNull(),
    ...linkTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.returnId, table.fulfillmentId] }),
    index("return_fulfillments_fulfillment_idx").on(table.fulfillmentId),
  ],
);
