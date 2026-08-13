import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";
import type { SalesChannelType } from "@/lib/sales-channel/types";

/**
 * Sales channels — a storefront, a POS, a marketplace feed.
 *
 * Translated from Medusa's Sales Channel Module; see `region.schema.ts` for
 * the translation rules.
 *
 * The module is one table. What makes it useful is what points at it: which
 * products are listed (`productSalesChannels`), which stock locations it can
 * ship from (`salesChannelStockLocations`) and which publishable API key
 * resolves to it — all in `link.schema.ts`.
 *
 * Until the storefront reads that link, a published product is available
 * everywhere; the product detail page says so.
 */
export const salesChannels = sqliteTable(
  "sales_channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").$type<SalesChannelType>().notNull().default("custom"),
    isDisabled: integer("is_disabled", { mode: "boolean" })
      .notNull()
      .default(false),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sales_channels_active_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
