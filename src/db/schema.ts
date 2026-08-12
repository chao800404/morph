/**
 * Unified schema export for Drizzle migrations.
 *
 * drizzle-kit reads only this file, so a table that is not re-exported here
 * does not exist as far as `pnpm db:generate` is concerned.
 *
 * To add a schema:
 * 1. Create `./<name>.schema.ts`
 * 2. Re-export it below
 *
 * The commerce modules are translated from Medusa one module per file, and
 * none of them import each other — ids that cross a module boundary are plain
 * `text` and the relationship is declared in `link.schema.ts`. The reasoning is
 * in `region.schema.ts`, which is the first of them.
 */

// Platform
export * from "./asset.schema";
export * from "./auth.schema";
export * from "./invite.schema";
export * from "./notification.schema";
export * from "./api-key.schema";
export * from "./table-view.schema";

// Store configuration
export * from "./currency.schema";
export * from "./region.schema";
export * from "./sales-channel.schema";
export * from "./stock-location.schema";

// Catalogue
export * from "./product.schema";
export * from "./inventory.schema";
export * from "./pricing.schema";

// Selling
export * from "./customer.schema";
export * from "./promotion.schema";
export * from "./tax.schema";
export * from "./fulfillment.schema";

// Checkout and after
export * from "./cart.schema";
export * from "./payment.schema";
export * from "./order.schema";

// The joins between all of the above
export * from "./link.schema";
