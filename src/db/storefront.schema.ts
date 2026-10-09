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
import type {
  StorefrontConcreteRenderPolicy,
  StorefrontPageRenderPolicy,
} from "@/lib/validations/storefront-render-policy";

export type StorefrontStatus = "draft" | "published" | "disabled";
export type StorefrontThemeStatus = "draft" | "published" | "archived";
/** Release lifecycle is independent from the production pointer. */
export type StorefrontReleaseStatus = "available" | "invalidated";
export type StorefrontContentPublicationItemType =
  "template" | "page" | "navigation";
export type StorefrontPageStatus = "draft" | "published" | "archived";
export type StorefrontDomainStatus = "pending" | "active" | "failed";
export type StorefrontCommentThreadStatus = "open" | "resolved" | "archived";
/**
 * `layout` is the shell every route renders inside, not a route of its own.
 *
 * Header and footer content belongs to every page at once, so it cannot live
 * in a page's document without becoming one copy per page that drift apart.
 * It is a template because it is a versioned, publishable content document
 * like any other; it differs only in that no URL resolves to it and the
 * runtime merges it into every path.
 */
export type StorefrontTemplateType =
  "index" | "product" | "collection" | "page" | "blog" | "layout";

export type StorefrontPageDocument = {
  version: 1;
  /** Page route captured with this revision; absent on legacy/template docs. */
  handle?: string;
  /** Versioned route override; absence inherits the layout's website default. */
  renderPolicy?: StorefrontPageRenderPolicy;
  /** Website default. Only the layout template may author this field. */
  websiteRenderPolicy?: StorefrontConcreteRenderPolicy;
  sections: Array<{
    id: string;
    type: string;
    componentRef?: string | null;
    /**
     * What the author calls this section, when they have renamed it.
     *
     * Beside `props`, not inside it. `props` is the component's content: it is
     * spread into the component and travels to every visitor, and a component
     * is free to declare a content field of its own called `name`. This is the
     * editor's label for one placement — the storefront never sees it.
     *
     * Stored per section entry, so the same component placed on three pages
     * has three names. A layout section has one entry for the whole site and
     * therefore one name, which is what the editor's "Global" badge already says.
     */
    name?: string;
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
    // Immutable release selected by the production storefront runtime.
    // Kept as a plain id here to avoid a circular table declaration; the
    // release DAL validates ownership and existence before activation.
    activeReleaseId: text("active_release_id"),
    /**
     * Held for the whole activate-and-deploy sequence, not just the pointer
     * flip. Without it a second request reads the freshly written pointer,
     * passes its own CAS and deploys alongside the first, leaving the active
     * release naming one build while the Worker runs another.
     *
     * Not in `preferences`: that column is user-facing and a preferences write
     * would drop whatever the platform hid there.
     */
    deploymentLeaseOwner: text("deployment_lease_owner"),
    /** Stale diagnostic threshold only; never permits automatic takeover. */
    deploymentLeaseExpiresAt: integer("deployment_lease_expires_at"),
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
    /** Server-derived source contract cache, never accepted from the client. */
    sourceIndexVersion: integer("source_index_version"),
    sourceIndexStatus: text("source_index_status"),
    sourceIndex: text("source_index", { mode: "json" }).$type<JsonValue>(),
    releaseGeneration: integer("release_generation").notNull().default(1),
    /**
     * The framework the site is a project of (docs/astro-theme-plan.md 2.1),
     * recorded once and never converted. Each build freezes it into its own
     * record. NULL is every site from before it was recorded, and reads as
     * TanStack Start; nothing in the product sets it yet (multi-runtime
     * step 6 chooses it when a site is created).
     */
    framework: text("framework"),
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

/**
 * Versioned content/assembly document whose componentRef values reference
 * components implemented by the code-backed Theme Source.
 */
export const storefrontThemeTemplates = sqliteTable(
  "storefront_theme_templates",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    type: text("type").$type<StorefrontTemplateType>().notNull(),
    name: text("name").notNull(),
    /**
     * The one source route this document holds content for, or null.
     *
     * Most documents are addressed by type — `/` reads `index`, every
     * `/products/...` reads `product`. A static route no type describes
     * (`/aboutus`) has no such document to share, and sharing one `page`
     * document between several of them would let a write on one route drop
     * the others' sections. So each gets its own, bound here by route path,
     * and is never returned by a lookup by type.
     */
    routePath: text("route_path"),
    document: text("document", { mode: "json" })
      .$type<StorefrontPageDocument>()
      .notNull(),
    draftRevisionId: text("draft_revision_id"),
    publishedRevisionId: text("published_revision_id"),
    draftGeneration: integer("draft_generation").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_templates_active_name_unique")
      .on(table.themeId, table.type, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("storefront_theme_templates_active_route_unique")
      .on(table.themeId, table.routePath)
      .where(
        sql`${table.routePath} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
    index("storefront_theme_templates_theme_type_idx").on(
      table.themeId,
      table.type,
      table.deletedAt,
    ),
  ],
);

/**
 * Every time a static route's source moved to another static route path.
 *
 * A source rollback puts route files back where a revision had them, but
 * nothing in the files says which path became which: `/company` restored as
 * `/about` looks like one route deleted and another added. This history is
 * what lets a rollback carry each route's document back with it, by undoing
 * every move recorded after the revision's source generation. Moves are
 * recorded by path, document or not: a route's document is created by its
 * first content write, which may come after the route moved.
 */
export const storefrontThemeRouteDocumentMoves = sqliteTable(
  "storefront_theme_route_document_moves",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    fromRoutePath: text("from_route_path").notNull(),
    toRoutePath: text("to_route_path").notNull(),
    /** The theme source generation the move produced. */
    sourceGeneration: integer("source_generation").notNull(),
    /** Orders the moves one batch made, so they undo in reverse. */
    sequence: integer("sequence").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("storefront_theme_route_document_moves_theme_generation_idx").on(
      table.themeId,
      table.sourceGeneration,
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
    /**
     * Source text. For a binary file this is always the empty string, kept
     * only because the column is NOT NULL: its bytes live in the immutable
     * blob store under `blobDigest`, and nothing may read them from here.
     */
    content: text("content").notNull(),
    mimeType: text("mime_type").default("text/plain"),
    /**
     * `utf8` source, or `binary` bytes held in the blob store. A trigger in
     * the migration refuses a row whose columns disagree with it.
     */
    encoding: text("encoding", { enum: ["utf8", "binary"] })
      .notNull()
      .default("utf8"),
    /** SHA-256 of a binary file's bytes; null for source text. */
    blobDigest: text("blob_digest"),
    /** Byte length of a binary file; null for source text. */
    sizeBytes: integer("size_bytes"),
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

/**
 * Snapshot revision of a theme workspace (supporting rollback, AI history,
 * and publishing).
 *
 * @deprecated Compatibility snapshot. The target storage is D1 revision
 * metadata plus immutable, content-addressed source blobs in R2.
 */
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
    sourceGeneration: integer("source_generation"),
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
    /**
     * Content-addressed R2 source blob manifest. Nullable for existing
     * revisions while the legacy D1 snapshot compatibility path is migrated.
     */
    sourceManifest: text("source_manifest", { mode: "json" }).$type<{
      version: 1;
      algorithm: "sha256";
      files: Array<{
        path: string;
        digest: string;
        sizeBytes: number;
        mimeType: string;
        isEntry: boolean;
      }>;
    }>(),
    /** Source-derived index for this immutable byte snapshot. */
    sourceIndex: text("source_index", { mode: "json" }).$type<JsonValue>(),
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

/**
 * `cancelled` is terminal and, like `failed`, is never publishable.
 *
 * Cancellation is cooperative: Queues cannot revoke an in-flight message, so a
 * cancel wins by claiming the row first and then destroying the build's Sandbox
 * session. The runner's own failure write must therefore lose to it rather than
 * relabel a cancelled build as failed.
 */
export type StorefrontThemeBuildStatus =
  "queued" | "building" | "succeeded" | "failed" | "cancelled";

/**
 * Whether a build's artifact carries CMS content in it, as the platform's
 * build proved it — never as a Theme declares it.
 *
 * - `dependent`: the build was given the sealed content (prerendering read
 *   it), so the artifact holds that content and only that content.
 * - `independent`: the content was never in the build's process, so nothing
 *   of it can be in the artifact; runtime reads the release's content.
 * - absent (NULL): unknown — a build from before this was recorded, or one
 *   whose evidence is incomplete. Treated as `dependent` wherever it matters.
 */
export type StorefrontThemeBuildContentDependency = "dependent" | "independent";

export type StorefrontThemeDependencyStatus =
  "requested" | "building" | "ready" | "failed" | "rejected";

/** Build execution record permanently bound to an immutable source revision. */
export const storefrontThemeBuilds = sqliteTable(
  "storefront_theme_builds",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => storefrontThemeRevisions.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<StorefrontThemeBuildStatus>()
      .notNull()
      .default("queued"),
    inputHash: text("input_hash"),
    compilerId: text("compiler_id"),
    compilerVersion: text("compiler_version"),
    /**
     * The framework the build was made for, frozen with it. NULL is a build
     * from before the framework was recorded, and reads as TanStack Start
     * (`resolveThemeFramework`); a value is read as recorded, never mapped
     * to another framework.
     */
    framework: text("framework"),
    /**
     * How `inputHash` was computed. NULL is the legacy format: every build from
     * before this column, verified exactly as it always was and never
     * rewritten. 2: framework and toolchain identity always part of the hash.
     * A build is verified only by the format it records.
     */
    inputHashFormat: integer("input_hash_format"),
    /**
     * The toolchain the build is recorded with: the SHA-256 identity of the
     * Sandbox image's toolchain manifest (theme-toolchains.ts). NULL on legacy
     * builds, which did not record one and are not assumed to have used any.
     */
    toolchainId: text("toolchain_id"),
    dependenciesJson: text("dependencies_json", { mode: "json" }).$type<
      Record<string, string>
    >(),
    /** Optional immutable content binding for content-dependent build output. */
    contentPublicationId: text("content_publication_id").references(
      () => storefrontContentPublications.id,
      { onDelete: "restrict" },
    ),
    /** Recorded with success; NULL is unknown (StorefrontThemeBuildContentDependency). */
    contentDependency:
      text("content_dependency").$type<StorefrontThemeBuildContentDependency>(),
    artifactPrefix: text("artifact_prefix"),
    manifestJson: text("manifest_json", { mode: "json" }),
    diagnosticsJson: text("diagnostics_json", { mode: "json" }),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    index("storefront_theme_builds_theme_idx").on(
      table.themeId,
      table.deletedAt,
    ),
    index("storefront_theme_builds_revision_idx").on(
      table.sourceRevisionId,
      table.deletedAt,
    ),
    index("storefront_theme_builds_status_idx").on(
      table.status,
      table.deletedAt,
    ),
  ],
);

/**
 * Access to one build's isolated Build Preview, held by one user.
 *
 * The browser presents the capability as the first label of the preview host,
 * so every sub-resource carries it without a cookie. Only its SHA-256 is
 * stored; each request is checked against the row, the build and the user
 * again, so expiry, revocation, a failed build or a removed admin all take
 * effect on the next request.
 *
 * With a release, the capability previews that release rather than the bare
 * build: the release's build, answered with the release's content. Null is the
 * build alone, answered with the content it was sealed with.
 */
export const storefrontBuildPreviewCapabilities = sqliteTable(
  "storefront_build_preview_capabilities",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => storefrontThemeBuilds.id, { onDelete: "cascade" }),
    releaseId: text("release_id").references(() => storefrontReleases.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_build_preview_capabilities_token_idx").on(
      table.tokenHash,
    ),
    index("storefront_build_preview_capabilities_build_user_idx").on(
      table.buildId,
      table.userId,
    ),
  ],
);

/**
 * Access to one Theme's source from a developer's own machine, held by one
 * user: what `morph-sync` presents to read and write the workspace it keeps
 * a local copy of (docs/local-code-sync.md).
 *
 * The same shape as a Build Preview capability, for the same reasons: only
 * the token's SHA-256 is stored, and each request is checked against the row,
 * the Theme and the user again, so expiry, revocation, a deleted Theme or a
 * removed admin take effect on the next request. It grants nothing beyond the
 * Theme's source files — no publish, no rollback, no other store data.
 */
export const storefrontThemeSyncCapabilities = sqliteTable(
  "storefront_theme_sync_capabilities",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_sync_capabilities_token_idx").on(
      table.tokenHash,
    ),
    index("storefront_theme_sync_capabilities_theme_user_idx").on(
      table.themeId,
      table.userId,
    ),
  ],
);

/**
 * Per-theme package enablement state.  The package/version itself is always
 * checked against the platform allowlist from cms.config before this table is
 * written; the table only records tenant intent and build lifecycle state.
 */
export const storefrontThemeDependencies = sqliteTable(
  "storefront_theme_dependencies",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    packageVersion: text("package_version").notNull(),
    status: text("status")
      .$type<StorefrontThemeDependencyStatus>()
      .notNull()
      .default("requested"),
    buildId: text("build_id").references(() => storefrontThemeBuilds.id, {
      onDelete: "set null",
    }),
    requestedBy: text("requested_by"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_theme_dependencies_theme_package_unique")
      .on(table.themeId, table.packageName)
      .where(sql`${table.deletedAt} IS NULL`),
    index("storefront_theme_dependencies_theme_status_idx").on(
      table.themeId,
      table.status,
      table.deletedAt,
    ),
    index("storefront_theme_dependencies_build_idx").on(
      table.buildId,
      table.deletedAt,
    ),
  ],
);

/** Immutable production composition of a theme source revision and build artifact. */
export const storefrontReleases = sqliteTable(
  "storefront_releases",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    themeId: text("theme_id")
      .notNull()
      .references(() => storefrontThemes.id, { onDelete: "cascade" }),
    sourceRevisionId: text("source_revision_id")
      .notNull()
      .references(() => storefrontThemeRevisions.id, { onDelete: "restrict" }),
    themeBuildId: text("theme_build_id")
      .notNull()
      .references(() => storefrontThemeBuilds.id, { onDelete: "restrict" }),
    contentPublicationId: text("content_publication_id").references(
      () => storefrontContentPublications.id,
      { onDelete: "restrict" },
    ),
    status: text("status")
      .$type<StorefrontReleaseStatus>()
      .notNull()
      .default("available"),
    metadata: metadata(),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (table) => [
    index("storefront_releases_storefront_status_idx").on(
      table.storefrontId,
      table.status,
      table.deletedAt,
    ),
    index("storefront_releases_theme_idx").on(table.themeId, table.deletedAt),
    index("storefront_releases_source_revision_idx").on(
      table.sourceRevisionId,
      table.deletedAt,
    ),
    index("storefront_releases_theme_build_idx").on(
      table.themeBuildId,
      table.deletedAt,
    ),
  ],
);

/** Immutable set of published content revisions selected by a release. */
export const storefrontContentPublications = sqliteTable(
  "storefront_content_publications",
  {
    id: text("id").primaryKey(),
    storefrontId: text("storefront_id")
      .notNull()
      .references(() => storefronts.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    index("storefront_content_publications_storefront_idx").on(
      table.storefrontId,
      table.deletedAt,
    ),
  ],
);

/** Revision references captured by one immutable content publication. */
export const storefrontContentPublicationItems = sqliteTable(
  "storefront_content_publication_items",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => storefrontContentPublications.id, {
        onDelete: "cascade",
      }),
    itemType: text("item_type")
      .$type<StorefrontContentPublicationItemType>()
      .notNull(),
    contentId: text("content_id").notNull(),
    revisionId: text("revision_id").notNull(),
    metadata: metadata(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storefront_content_publication_items_unique").on(
      table.publicationId,
      table.itemType,
      table.contentId,
    ),
    index("storefront_content_publication_items_revision_idx").on(
      table.revisionId,
      table.deletedAt,
    ),
  ],
);
