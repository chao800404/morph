import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
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
export type StorefrontCommentThreadStatus = "open" | "resolved" | "archived";
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
    componentRef?: string | null;
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
    publishedSourceRevisionId: text("published_source_revision_id"),
    sourceGeneration: integer("source_generation").notNull().default(1),
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
    draftRevisionId: text("draft_revision_id"),
    publishedRevisionId: text("published_revision_id"),
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

/** Immutable theme-template snapshots used by editor preview and publishing. */
export const storefrontThemeTemplateRevisions = sqliteTable(
  "storefront_theme_template_revisions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => storefrontThemeTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    document: text("document", { mode: "json" })
      .$type<StorefrontPageDocument>()
      .notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("storefront_theme_template_revisions_version_unique").on(
      table.templateId,
      table.version,
    ),
    index("storefront_theme_template_revisions_created_idx").on(
      table.templateId,
      table.createdAt,
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

/** Collaborative comment group scoped to a template and viewport width. */
export const storefrontCommentGroups = sqliteTable(
  "storefront_comment_groups",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => storefrontThemeTemplates.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    viewportWidth: integer("viewport_width").notNull().default(1440),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("storefront_comment_groups_template_idx").on(
      table.templateId,
      table.deletedAt,
    ),
    index("storefront_comment_groups_created_by_idx").on(
      table.createdBy,
      table.deletedAt,
    ),
  ],
);

/** Collaborative annotation thread anchored to a template section / canvas position. */
export const storefrontCommentThreads = sqliteTable(
  "storefront_comment_threads",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => storefrontThemeTemplates.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => storefrontCommentGroups.id, {
      onDelete: "cascade",
    }),
    sectionId: text("section_id"),
    nodeId: text("node_id"),
    elementKey: text("element_key"),
    viewportWidth: integer("viewport_width").default(1440),
    viewport: text("viewport").default("desktop"),
    positionX: real("position_x").notNull().default(50.0),
    positionY: real("position_y").notNull().default(50.0),
    status: text("status")
      .$type<StorefrontCommentThreadStatus>()
      .notNull()
      .default("open"),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("storefront_comment_threads_template_status_idx").on(
      table.templateId,
      table.status,
      table.deletedAt,
    ),
    index("storefront_comment_threads_group_idx").on(
      table.groupId,
      table.deletedAt,
    ),
    index("storefront_comment_threads_created_by_idx").on(
      table.createdBy,
      table.deletedAt,
    ),
  ],
);

/** Individual message or reply in a collaborative comment thread. */
export const storefrontComments = sqliteTable(
  "storefront_comments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => storefrontCommentThreads.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    content: text("content").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("storefront_comments_thread_created_idx").on(
      table.threadId,
      table.createdAt,
      table.deletedAt,
    ),
    index("storefront_comments_created_by_idx").on(
      table.createdBy,
      table.deletedAt,
    ),
  ],
);

/** Individual code/style/config file within a theme's virtual workspace. */
export const storefrontThemeFiles = sqliteTable(
  "storefront_theme_files",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    path: text("path").notNull(), // e.g. "src/components/Hero.tsx", "src/styles/global.css"
    content: text("content").notNull(),
    mimeType: text("mime_type").default("text/plain"),
    isEntry: integer("is_entry", { mode: "boolean" }).default(false),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_files_theme_path_unique")
      .on(table.themeId, table.path)
      .where(sql`${table.deletedAt} IS NULL`),
    index("storefront_theme_files_theme_idx").on(
      table.themeId,
      table.deletedAt,
    ),
  ],
);

/** Snapshot revision of a theme workspace (supporting rollback, AI history, and publishing). */
export const storefrontThemeRevisions = sqliteTable(
  "storefront_theme_revisions",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    message: text("message"),
    source: text("source").notNull().default("manual"), // "manual" | "ai" | "publish" | "rollback"
    snapshot: text("snapshot", { mode: "json" })
      .$type<
        Array<{
          path: string;
          content: string;
          mimeType: string;
          isEntry: boolean;
        }>
      >()
      .notNull(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_revisions_theme_rev_unique").on(
      table.themeId,
      table.revisionNumber,
    ),
    index("storefront_theme_revisions_theme_idx").on(
      table.themeId,
      table.deletedAt,
    ),
  ],
);


