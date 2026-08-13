import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";
import { salesChannels } from "./sales-channel.schema";
import type { JsonValue } from "./json";

export type StorefrontStatus = "draft" | "published" | "disabled";
export type StorefrontThemeStatus = "draft" | "published" | "archived";
export type StorefrontTemplateType =
  | "index"
  | "product"
  | "collection"
  | "page"
  | "blog";

export type StorefrontPageDocument = {
  version: 1;
  sections: Array<{
    id: string;
    type: string;
    enabled: boolean;
    props: Record<string, JsonValue>;
  }>;
};

/** A website presentation attached to one storefront-capable sales channel. */
export const storefronts = sqliteTable(
  "storefronts",
  {
    id: text("id").primaryKey(),
    salesChannelId: text("sales_channel_id")
      .notNull()
      .references(() => salesChannels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    status: text("status").$type<StorefrontStatus>().notNull().default("draft"),
    // Kept as an explicit link rather than inferred from a published theme.
    // It is populated after the theme row is created during initialization.
    activeThemeId: text("active_theme_id"),
    preferences: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefronts_active_channel_unique")
      .on(table.salesChannelId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("storefronts_active_domain_unique")
      .on(table.domain)
      .where(sql`${table.deletedAt} IS NULL AND ${table.domain} IS NOT NULL`),
  ],
);

export const storefrontThemes = sqliteTable(
  "storefront_themes",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status")
      .$type<StorefrontThemeStatus>()
      .notNull()
      .default("draft"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_themes_active_name_unique")
      .on(table.storefrontId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index("storefront_themes_storefront_status_idx").on(
      table.storefrontId,
      table.status,
      table.deletedAt,
    ),
  ],
);

/** JSON templates are rendered by registered, schema-validated sections. */
export const storefrontThemeTemplates = sqliteTable(
  "storefront_theme_templates",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    type: text("type").$type<StorefrontTemplateType>().notNull(),
    name: text("name").notNull(),
    document: text("document", { mode: "json" })
      .$type<StorefrontPageDocument>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_templates_active_name_unique")
      .on(table.themeId, table.type, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index("storefront_theme_templates_theme_type_idx").on(
      table.themeId,
      table.type,
      table.deletedAt,
    ),
  ],
);
