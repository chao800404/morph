import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { metadata, timestamps } from "./columns";
import type { JsonValue } from "./json";

export type StorefrontStatus = "draft" | "published" | "disabled";
export type StorefrontThemeStatus = "draft" | "published" | "archived";
export type StorefrontPageStatus = "draft" | "published" | "archived";
export type StorefrontDomainStatus = "pending" | "active" | "failed";
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
    salesChannelId: text("sales_channel_id").notNull(),
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

/** Merchant-owned hostnames attached to a storefront's Worker. */
export const storefrontDomains = sqliteTable(
  "storefront_domains",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status")
      .$type<StorefrontDomainStatus>()
      .notNull()
      .default("pending"),
    cloudflareDomainId: text("cloudflare_domain_id"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_domains_active_hostname_unique")
      .on(table.hostname)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("storefront_domains_primary_unique")
      .on(table.storefrontId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isPrimary} = 1`),
    index("storefront_domains_storefront_status_idx").on(
      table.storefrontId,
      table.status,
      table.deletedAt,
    ),
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

/** Merchant-authored routes. Commerce records stay authoritative elsewhere. */
export const storefrontPages = sqliteTable(
  "storefront_pages",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    status: text("status")
      .$type<StorefrontPageStatus>()
      .notNull()
      .default("draft"),
    draftRevisionId: text("draft_revision_id"),
    publishedRevisionId: text("published_revision_id"),
    createdBy: text("created_by").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_pages_active_handle_unique")
      .on(table.storefrontId, table.handle)
      .where(sql`${table.deletedAt} IS NULL`),
    index("storefront_pages_storefront_status_idx").on(
      table.storefrontId,
      table.status,
      table.deletedAt,
    ),
  ],
);

/** Immutable snapshots shared by the visual editor, preview and AI authoring. */
export const storefrontPageRevisions = sqliteTable(
  "storefront_page_revisions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => storefrontPages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    document: text("document", { mode: "json" })
      .$type<StorefrontPageDocument>()
      .notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("storefront_page_revisions_page_version_unique").on(
      table.pageId,
      table.version,
    ),
    index("storefront_page_revisions_page_created_idx").on(
      table.pageId,
      table.createdAt,
    ),
  ],
);
