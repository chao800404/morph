import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
  storefrontThemeTemplateRevisions,
  storefrontThemeRevisions,
  storefrontThemeBuilds,
  storefrontThemeFiles,
  storefrontReleases,
} from "@/db/storefront.schema";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { resolveThemeContentCapabilities } from "@/lib/storefront/theme-content-capability-resolver";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import { readDeployedThemeBuildId } from "@/lib/storefront/service/theme-worker-deployment-state";
import {
  deriveThemeRouteSections,
  mergeDocumentWithRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import {
  filterThemeContentProps,
  type ThemeContentCapabilities,
} from "@/lib/storefront/theme-content-capabilities";
import { and, asc, desc, eq, isNotNull, isNull, max } from "drizzle-orm";

const revisionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routePathForTemplateType(type: string): string | null {
  if (type === "index") return "/";
  const segment =
    type === "product"
      ? "products"
      : type === "collection"
        ? "collections"
        : type === "page"
          ? "pages"
          : type === "blog"
            ? "blogs"
            : null;
  return segment ? `/${segment}/` : null;
}

function deriveTemplateDocumentFromRoutes(args: {
  type: string;
  document: import("@/db/storefront.schema").StorefrontPageDocument;
  files: readonly { path: string; content: string }[];
}) {
  const registry = buildThemeRouteRegistry(args.files);
  if (!registry.valid) return args.document;
  const expectedPath = routePathForTemplateType(args.type);
  if (!expectedPath) return args.document;
  const route = registry.routes.find(
    (candidate) =>
      candidate.kind === "route" &&
      (expectedPath === "/"
        ? candidate.path === "/"
        : candidate.path.startsWith(expectedPath)),
  );
  if (!route) return args.document;
  const derived = deriveThemeRouteSections(args.files, route.sourcePath);
  if (
    derived.diagnostics.length > 0 ||
    (derived.sections.length === 0 && !derived.hasContentImport)
  ) {
    return args.document;
  }
  return mergeDocumentWithRouteSections(args.document, derived.sections, {
    routeOwnsStructure: derived.hasContentImport,
  });
}

export interface ComponentContentManifest {
  allowedContentFields: Set<string>;
}

export const COMPONENT_CONTENT_MANIFESTS: Record<
  string,
  ComponentContentManifest
> = {
  // Hero components
  "hero.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "badge",
      "badgeText",
      "actionLabel",
      "actionHref",
      "secondaryActionLabel",
      "secondaryActionHref",
      "buttonText",
      "buttonLink",
      "imageSrc",
      "imageAlt",
      "backgroundMedia",
    ]),
  },
  "hero.split": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "badge",
      "badgeText",
      "actionLabel",
      "actionHref",
      "secondaryActionLabel",
      "secondaryActionHref",
      "imageSrc",
      "imageAlt",
    ]),
  },
  "hero.minimal": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "title",
      "subtitle",
      "actionLabel",
      "actionHref",
    ]),
  },
  "hero.video": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "videoSrc",
      "posterSrc",
      "autoplay",
      "loop",
      "muted",
      "actionLabel",
      "actionHref",
    ]),
  },
  "hero.3d": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "description",
      "modelSrc",
      "environmentSrc",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Editorial intro
  "editorial-intro.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "body",
      "description",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Category showcase
  "category-showcase.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "title",
      "subtitle",
      "categories",
      "items",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Image with text
  "image-with-text.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "body",
      "description",
      "imageSrc",
      "imageAlt",
      "imagePosition",
      "actionLabel",
      "actionHref",
    ]),
  },

  // Principles
  "principles.default": {
    allowedContentFields: new Set([
      "label",
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "items",
    ]),
  },

  // Header components
  "header.default": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "logoAlt",
      "storeName",
      "navItems",
      "menuItems",
      "showCart",
      "showSearch",
      "announcementText",
    ]),
  },
  "header.minimal": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "storeName",
      "navItems",
      "showCart",
    ]),
  },
  "header.centered": {
    allowedContentFields: new Set([
      "logoText",
      "logoSrc",
      "logoAlt",
      "storeName",
      "navItems",
      "menuItems",
      "showCart",
      "showSearch",
    ]),
  },

  // Footer components
  "footer.default": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "columns",
      "links",
      "socialLinks",
      "showNewsletter",
    ]),
  },
  "footer.minimal": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "links",
    ]),
  },
  "footer.multi-column": {
    allowedContentFields: new Set([
      "copyrightText",
      "brandText",
      "storeName",
      "columns",
      "links",
      "socialLinks",
      "showNewsletter",
      "newsletterHeading",
      "newsletterPlaceholder",
    ]),
  },

  // Products
  "featured-products.default": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "columns",
      "showPrice",
      "actionLabel",
      "actionHref",
    ]),
  },
  "featured-products.carousel": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "autoPlay",
      "showPrice",
    ]),
  },
  "featured-products.grid": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "subheading",
      "collectionId",
      "productLimit",
      "columns",
      "showPrice",
    ]),
  },
  "product-detail.default": {
    allowedContentFields: new Set([
      "showVendor",
      "showSku",
      "showShare",
      "galleryPosition",
    ]),
  },
  "product-detail.gallery": {
    allowedContentFields: new Set([
      "showVendor",
      "showSku",
      "showShare",
      "layout",
      "thumbnailPosition",
    ]),
  },
  "product-grid.default": {
    allowedContentFields: new Set([
      "title",
      "heading",
      "collectionId",
      "itemsPerPage",
      "columns",
      "showFilters",
      "showSort",
    ]),
  },

  // Content / Banners / Showcase / Newsletter
  "banner.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "heading",
      "subheading",
      "description",
      "imageSrc",
      "imageAlt",
      "actionLabel",
      "actionHref",
    ]),
  },
  "banner.announcement": {
    allowedContentFields: new Set([
      "text",
      "linkHref",
      "linkLabel",
      "dismissible",
    ]),
  },
  "newsletter.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "label",
      "heading",
      "subheading",
      "body",
      "description",
      "buttonText",
      "actionLabel",
      "placeholder",
      "note",
      "disclaimer",
    ]),
  },
  "rich-text.default": {
    allowedContentFields: new Set([
      "eyebrow",
      "heading",
      "subheading",
      "body",
      "content",
      "html",
    ]),
  },
  "showcase.default": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "description",
      "items",
      "imageSrc",
      "imageAlt",
      "actionLabel",
      "actionHref",
    ]),
  },
  "showcase.immersive": {
    allowedContentFields: new Set([
      "title",
      "subtitle",
      "heading",
      "description",
      "items",
      "mediaSrc",
      "actionLabel",
      "actionHref",
    ]),
  },
};

export const SECTION_TYPE_DEFAULT_MANIFESTS: Record<string, string> = {
  hero: "hero.default",
  "editorial-intro": "editorial-intro.default",
  "category-showcase": "category-showcase.default",
  "image-with-text": "image-with-text.default",
  principles: "principles.default",
  newsletter: "newsletter.default",
  header: "header.default",
  footer: "footer.default",
  "featured-products": "featured-products.default",
  "product-detail": "product-detail.default",
  "product-grid": "product-grid.default",
  banner: "banner.default",
  "rich-text": "rich-text.default",
  showcase: "showcase.default",
};

export function filterSectionContentProps(
  sectionType: string,
  rawProps: Record<string, unknown>,
  componentRef?: string | null,
  themeCapabilities?: ThemeContentCapabilities,
): Record<string, unknown> {
  // A capability declared in the persisted Theme Workspace manifest is
  // authoritative for that componentRef. The client cannot supply this
  // capability as part of the content mutation.
  if (componentRef) {
    const themeCapability = themeCapabilities?.[componentRef];
    if (themeCapability) {
      return filterThemeContentProps(rawProps, themeCapability);
    }

    // Existing platform manifests remain a compatibility adapter while
    // starter and customer themes migrate to Theme-level contentFields.
    const manifest = COMPONENT_CONTENT_MANIFESTS[componentRef];
    if (!manifest) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawProps)) {
      if (manifest.allowedContentFields.has(k)) {
        result[k] = v;
      }
    }
    return result;
  }

  // If componentRef is omitted, fall back to SECTION_TYPE_DEFAULT_MANIFESTS[sectionType]
  const defaultManifestKey = SECTION_TYPE_DEFAULT_MANIFESTS[sectionType];
  const manifest = defaultManifestKey
    ? COMPONENT_CONTENT_MANIFESTS[defaultManifestKey]
    : null;

  if (manifest) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawProps)) {
      if (manifest.allowedContentFields.has(k)) {
        result[k] = v;
      }
    }
    return result;
  }

  // Unknown sectionType: strict reject
  return {};
}

function prepareTemplateDraftCASGuard(args: {
  storefrontId: string;
  themeId: string;
  templateId: string;
  expectedDraftGeneration: number;
  expectedDraftRevisionId?: string | null;
  expectedSourceGeneration?: number;
}) {
  return env.DATABASE.prepare(
    `
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM storefront_theme_templates t
      INNER JOIN storefront_themes th ON th.id = t.theme_id
      INNER JOIN storefronts s ON s.id = th.storefront_id
      WHERE s.id = ?1
        AND th.id = ?2
        AND t.id = ?3
        AND t.draft_generation = ?4
        AND (t.draft_revision_id = ?5 OR (t.draft_revision_id IS NULL AND ?5 = ''))
        AND (?6 IS NULL OR th.source_generation = ?6)
        AND s.deleted_at IS NULL
        AND th.deleted_at IS NULL
        AND t.deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok
  `,
  ).bind(
    args.storefrontId,
    args.themeId,
    args.templateId,
    args.expectedDraftGeneration,
    args.expectedDraftRevisionId ?? "",
    args.expectedSourceGeneration ?? null,
  );
}

export const storefrontThemeDal = {
  async findEditorContext(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeEditorDTO | null> {
    const db = await getDb();
    const [context] = await db
      .select({
        storefrontId: storefronts.id,
        storefrontName: storefronts.name,
        storefrontDomain: storefronts.domain,
        storefrontStatus: storefronts.status,
        activeReleaseId: storefronts.activeReleaseId,
        themeId: storefrontThemes.id,
        themeName: storefrontThemes.name,
        themeStatus: storefrontThemes.status,
        themeReleaseGeneration: storefrontThemes.releaseGeneration,
      })
      .from(storefrontThemes)
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, storefrontId),
          eq(storefrontThemes.id, themeId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);

    if (!context) return null;

    const [activeRelease] = context.activeReleaseId
      ? await db
          .select({
            id: storefrontReleases.id,
            sourceRevisionId: storefrontReleases.sourceRevisionId,
            themeBuildId: storefrontReleases.themeBuildId,
          })
          .from(storefrontReleases)
          .where(
            and(
              eq(storefrontReleases.id, context.activeReleaseId),
              eq(storefrontReleases.storefrontId, storefrontId),
              eq(storefrontReleases.themeId, themeId),
              eq(storefrontReleases.status, "available"),
              isNull(storefrontReleases.deletedAt),
            ),
          )
          .limit(1)
      : [];

    const templateRows = await db
      .select({
        id: storefrontThemeTemplates.id,
        type: storefrontThemeTemplates.type,
        name: storefrontThemeTemplates.name,
        document: storefrontThemeTemplates.document,
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
        draftGeneration: storefrontThemeTemplates.draftGeneration,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .orderBy(
        asc(storefrontThemeTemplates.type),
        asc(storefrontThemeTemplates.name),
      );

    const themeSourceFiles = await db
      .select({
        path: storefrontThemeFiles.path,
        content: storefrontThemeFiles.content,
      })
      .from(storefrontThemeFiles)
      .where(
        and(
          eq(storefrontThemeFiles.storefrontId, storefrontId),
          eq(storefrontThemeFiles.themeId, themeId),
          isNull(storefrontThemeFiles.deletedAt),
        ),
      )
      .orderBy(asc(storefrontThemeFiles.path));

    const templates = await Promise.all(
      templateRows.map(async (template) => {
        let document = template.document;
        let version = 1;
        if (
          template.draftRevisionId &&
          revisionIdPattern.test(template.draftRevisionId)
        ) {
          const [revision] = await db
            .select({
              document: storefrontThemeTemplateRevisions.document,
              version: storefrontThemeTemplateRevisions.version,
            })
            .from(storefrontThemeTemplateRevisions)
            .where(
              and(
                eq(
                  storefrontThemeTemplateRevisions.id,
                  template.draftRevisionId,
                ),
                eq(storefrontThemeTemplateRevisions.templateId, template.id),
              ),
            )
            .limit(1);
          if (revision) {
            document = revision.document;
            version = revision.version;
          }
        }
        return {
          id: template.id,
          type: template.type as StorefrontThemeEditorDTO["templates"][number]["type"],
          name: template.name,
          document: deriveTemplateDocumentFromRoutes({
            type: template.type,
            document: storefrontPageDocumentSchema.parse(
              typeof document === "string" ? JSON.parse(document) : document,
            ),
            files: themeSourceFiles,
          }),
          draftRevisionId: template.draftRevisionId,
          publishedRevisionId: template.publishedRevisionId,
          draftGeneration: template.draftGeneration ?? 1,
          version,
        };
      }),
    );

    return {
      storefront: {
        id: context.storefrontId,
        name: context.storefrontName,
        domain: context.storefrontDomain,
        status: context.storefrontStatus,
        activeReleaseId: context.activeReleaseId,
      },
      theme: {
        id: context.themeId,
        name: context.themeName,
        status: context.themeStatus,
        releaseGeneration: context.themeReleaseGeneration ?? 1,
        activeRelease: activeRelease ?? null,
      },
      templates,
    };
  },

  async reorderSections(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionIds: string[];
    expectedDraftGeneration: number;
    createdBy: string;
  }) {
    const context = await this.findEditorContext(
      data.storefrontId,
      data.themeId,
    );
    const template = context?.templates.find(
      (item) => item.id === data.templateId,
    );
    if (!template) return null;

    const currentIds = template.document.sections.map((section) => section.id);
    if (
      currentIds.length !== data.sectionIds.length ||
      new Set(currentIds).size !== new Set(data.sectionIds).size ||
      data.sectionIds.some((id) => !currentIds.includes(id))
    )
      return null;

    const sectionById = new Map(
      template.document.sections.map((section) => [section.id, section]),
    );
    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: data.sectionIds.map((id) => sectionById.get(id)),
    });
    const now = new Date().toISOString();
    const db = await getDb();
    const nextGeneration = data.expectedDraftGeneration + 1;

    // If an uncommitted draft revision is currently active, update it in place
    if (
      template.draftRevisionId &&
      template.draftRevisionId !== template.publishedRevisionId
    ) {
      const [activeDraft] = await db
        .select({
          id: storefrontThemeTemplateRevisions.id,
          version: storefrontThemeTemplateRevisions.version,
        })
        .from(storefrontThemeTemplateRevisions)
        .where(
          and(
            eq(storefrontThemeTemplateRevisions.id, template.draftRevisionId),
            eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
          ),
        )
        .limit(1);

      if (activeDraft) {
        const statements = [
          prepareTemplateDraftCASGuard({
            storefrontId: data.storefrontId,
            themeId: data.themeId,
            templateId: data.templateId,
            expectedDraftGeneration: data.expectedDraftGeneration,
            expectedDraftRevisionId: activeDraft.id,
          }),
          env.DATABASE.prepare(
            `
            UPDATE storefront_theme_template_revisions
            SET document = ?1
            WHERE id = ?2 AND template_id = ?3
          `,
          ).bind(JSON.stringify(document), activeDraft.id, data.templateId),
          env.DATABASE.prepare(
            `
            UPDATE storefront_theme_templates
            SET draft_generation = ?1, updated_at = ?2
            WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL
          `,
          ).bind(nextGeneration, now, data.templateId, data.themeId),
        ];

        try {
          await env.DATABASE.batch(statements);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes("malformed JSON") ||
            message.includes("constraint")
          ) {
            throw new Error(
              "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
            );
          }
          throw error;
        }

        return {
          document,
          version: activeDraft.version,
          draftRevisionId: activeDraft.id,
          draftGeneration: nextGeneration,
        };
      }
    }

    // Branch a new draft revision
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;

    const statements = [
      prepareTemplateDraftCASGuard({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        templateId: data.templateId,
        expectedDraftGeneration: data.expectedDraftGeneration,
        expectedDraftRevisionId: template.draftRevisionId,
      }),
      env.DATABASE.prepare(
        `
        INSERT INTO storefront_theme_template_revisions (
          id, template_id, version, document, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
      ).bind(
        revisionId,
        data.templateId,
        version,
        JSON.stringify(document),
        data.createdBy,
        now,
      ),
      env.DATABASE.prepare(
        `
        UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, draft_generation = ?2, updated_at = ?3
        WHERE id = ?4 AND theme_id = ?5 AND deleted_at IS NULL
      `,
      ).bind(revisionId, nextGeneration, now, data.templateId, data.themeId),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        throw new Error(
          "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
        );
      }
      throw error;
    }

    return {
      document,
      version,
      draftRevisionId: revisionId,
      draftGeneration: nextGeneration,
    };
  },

  async updateSectionProps(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionId: string;
    props: Record<string, unknown>;
    expectedDraftGeneration: number;
    createdBy: string;
  }) {
    const context = await this.findEditorContext(
      data.storefrontId,
      data.themeId,
    );
    const template = context?.templates.find(
      (item) => item.id === data.templateId,
    );
    if (!template) return null;

    const targetSection = template.document.sections.find(
      (section) => section.id === data.sectionId,
    );
    if (!targetSection) return null;

    const db = await getDb();
    const manifestState = await env.DATABASE.prepare(
      `
      SELECT
        th.source_generation AS sourceGeneration,
        f.content AS manifestContent
      FROM storefront_themes th
      LEFT JOIN storefront_theme_files f
        ON f.storefront_id = th.storefront_id
        AND f.theme_id = th.id
        AND f.path = 'morph.theme.json'
        AND f.deleted_at IS NULL
      WHERE th.id = ?1
        AND th.storefront_id = ?2
        AND th.deleted_at IS NULL
      LIMIT 1
    `,
    )
      .bind(data.themeId, data.storefrontId)
      .first<{ sourceGeneration: number; manifestContent: string | null }>();
    if (!manifestState) return null;
    // Components may declare their editable fields in their own source, so the
    // manifest alone no longer answers what this mutation is allowed to write.
    // Only the sources the manifest references are read, never the whole
    // workspace, and the client cannot influence which paths are loaded.
    const themeCapabilityState = await resolveThemeContentCapabilities({
      manifestContent: manifestState.manifestContent,
      additionalSourcePaths: targetSection.componentRef?.startsWith("src/")
        ? [targetSection.componentRef]
        : [],
      readSource: async (path) => {
        const row = await env.DATABASE.prepare(
          `
          SELECT content
          FROM storefront_theme_files
          WHERE storefront_id = ?1 AND theme_id = ?2 AND path = ?3
            AND deleted_at IS NULL
          LIMIT 1
        `,
        )
          .bind(data.storefrontId, data.themeId, path)
          .first<{ content: string | null }>();
        return row?.content ?? null;
      },
    });
    const themeCapabilities = themeCapabilityState.capabilities;
    const resolvedComponentRef =
      targetSection.componentRef ??
      themeCapabilityState.sectionComponentRefs[targetSection.type] ??
      null;

    const { enabled: propEnabled, ...restProps } = data.props;
    const cleanIncomingProps = filterSectionContentProps(
      targetSection.type,
      restProps,
      resolvedComponentRef,
      themeCapabilities,
    );
    const existingProps =
      (targetSection.props as Record<string, unknown>) ?? {};
    const themeCapability = resolvedComponentRef
      ? themeCapabilities[resolvedComponentRef]
      : null;
    if (themeCapability) {
      // Validate declared values against the current capability, but preserve
      // existing non-editable props. contentFields is an authoring allowlist,
      // not the complete runtime prop schema, so a partial content edit must
      // not erase references or other persisted component data.
      filterThemeContentProps(existingProps, themeCapability);
    }
    const cleanExistingProps = themeCapability
      ? existingProps
      : filterSectionContentProps(
          targetSection.type,
          existingProps,
          resolvedComponentRef,
          themeCapabilities,
        );

    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: template.document.sections.map((section) =>
        section.id === data.sectionId
          ? {
              ...section,
              componentRef: resolvedComponentRef ?? section.componentRef,
              enabled:
                typeof propEnabled === "boolean"
                  ? propEnabled
                  : section.enabled !== false,
              props: {
                ...cleanExistingProps,
                ...cleanIncomingProps,
              },
            }
          : section,
      ),
    });

    const now = new Date().toISOString();
    const nextGeneration = data.expectedDraftGeneration + 1;

    // If an uncommitted draft revision is currently active, update it in place
    if (
      template.draftRevisionId &&
      template.draftRevisionId !== template.publishedRevisionId
    ) {
      const [activeDraft] = await db
        .select({
          id: storefrontThemeTemplateRevisions.id,
          version: storefrontThemeTemplateRevisions.version,
        })
        .from(storefrontThemeTemplateRevisions)
        .where(
          and(
            eq(storefrontThemeTemplateRevisions.id, template.draftRevisionId),
            eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
          ),
        )
        .limit(1);

      if (activeDraft) {
        const statements = [
          prepareTemplateDraftCASGuard({
            storefrontId: data.storefrontId,
            themeId: data.themeId,
            templateId: data.templateId,
            expectedDraftGeneration: data.expectedDraftGeneration,
            expectedDraftRevisionId: activeDraft.id,
            expectedSourceGeneration: manifestState.sourceGeneration,
          }),
          env.DATABASE.prepare(
            `
            UPDATE storefront_theme_template_revisions
            SET document = ?1
            WHERE id = ?2 AND template_id = ?3
          `,
          ).bind(JSON.stringify(document), activeDraft.id, data.templateId),
          env.DATABASE.prepare(
            `
            UPDATE storefront_theme_templates
            SET draft_generation = ?1, updated_at = ?2
            WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL
          `,
          ).bind(nextGeneration, now, data.templateId, data.themeId),
        ];

        try {
          await env.DATABASE.batch(statements);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes("malformed JSON") ||
            message.includes("constraint")
          ) {
            throw new Error(
              "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
            );
          }
          throw error;
        }

        return {
          document,
          version: activeDraft.version,
          draftRevisionId: activeDraft.id,
          draftGeneration: nextGeneration,
        };
      }
    }

    // Branch a new draft revision
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;

    const statements = [
      prepareTemplateDraftCASGuard({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        templateId: data.templateId,
        expectedDraftGeneration: data.expectedDraftGeneration,
        expectedDraftRevisionId: template.draftRevisionId,
        expectedSourceGeneration: manifestState.sourceGeneration,
      }),
      env.DATABASE.prepare(
        `
        INSERT INTO storefront_theme_template_revisions (
          id, template_id, version, document, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
      ).bind(
        revisionId,
        data.templateId,
        version,
        JSON.stringify(document),
        data.createdBy,
        now,
      ),
      env.DATABASE.prepare(
        `
        UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, draft_generation = ?2, updated_at = ?3
        WHERE id = ?4 AND theme_id = ?5 AND deleted_at IS NULL
      `,
      ).bind(revisionId, nextGeneration, now, data.templateId, data.themeId),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        throw new Error(
          "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
        );
      }
      throw error;
    }

    return {
      document,
      version,
      draftRevisionId: revisionId,
      draftGeneration: nextGeneration,
    };
  },

  async publishTemplate(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sourceRevisionId?: string;
    expectedDraftRevisionId: string;
    expectedDraftGeneration: number;
    expectedReleaseGeneration: number;
    themeBuildId?: string;
    createdBy?: string;
  }) {
    const db = await getDb();
    const [template] = await db
      .select({
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
        draftGeneration: storefrontThemeTemplates.draftGeneration,
        publishedSourceRevisionId: storefrontThemes.publishedSourceRevisionId,
        releaseGeneration: storefrontThemes.releaseGeneration,
        sourceGeneration: storefrontThemes.sourceGeneration,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefrontThemeTemplates)
      .innerJoin(
        storefrontThemes,
        eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
      )
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, data.storefrontId),
          eq(storefrontThemes.id, data.themeId),
          eq(storefrontThemeTemplates.id, data.templateId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!template) return null;

    const [activeRelease] = template.activeReleaseId
      ? await db
          .select({
            id: storefrontReleases.id,
            sourceRevisionId: storefrontReleases.sourceRevisionId,
            themeBuildId: storefrontReleases.themeBuildId,
            // Read before this publish activates anything, because afterwards
            // the active release is the new one and its deployment record is
            // necessarily empty.
            metadata: storefrontReleases.metadata,
            sourceGeneration: storefrontThemeRevisions.sourceGeneration,
          })
          .from(storefrontReleases)
          .innerJoin(
            storefrontThemeRevisions,
            eq(
              storefrontReleases.sourceRevisionId,
              storefrontThemeRevisions.id,
            ),
          )
          .where(
            and(
              eq(storefrontReleases.id, template.activeReleaseId),
              eq(storefrontReleases.storefrontId, data.storefrontId),
              eq(storefrontReleases.themeId, data.themeId),
              eq(storefrontReleases.status, "available"),
              isNull(storefrontReleases.deletedAt),
            ),
          )
          .limit(1)
      : [];
    // Resolve the build server-side when the caller did not name one.
    //
    // The editor only knows about a Build Preview while it is showing one, so a
    // reload would otherwise make an existing, valid build unpublishable and
    // force a rebuild. Falling back to the active release's build instead is
    // wrong in the opposite direction: it would publish stale bytes under a
    // newer source. The authoritative answer is the newest succeeded build
    // whose revision matches the theme's current source generation.
    const [resolvedBuild] =
      data.themeBuildId || data.sourceRevisionId
        ? []
        : await db
            .select({
              id: storefrontThemeBuilds.id,
              sourceRevisionId: storefrontThemeBuilds.sourceRevisionId,
            })
            .from(storefrontThemeBuilds)
            .innerJoin(
              storefrontThemeRevisions,
              eq(
                storefrontThemeBuilds.sourceRevisionId,
                storefrontThemeRevisions.id,
              ),
            )
            .where(
              and(
                eq(storefrontThemeBuilds.storefrontId, data.storefrontId),
                eq(storefrontThemeBuilds.themeId, data.themeId),
                eq(storefrontThemeBuilds.status, "succeeded"),
                isNotNull(storefrontThemeBuilds.artifactPrefix),
                isNotNull(storefrontThemeBuilds.manifestJson),
                isNull(storefrontThemeBuilds.deletedAt),
                isNull(storefrontThemeRevisions.deletedAt),
                eq(
                  storefrontThemeRevisions.sourceGeneration,
                  template.sourceGeneration,
                ),
              ),
            )
            .orderBy(desc(storefrontThemeBuilds.createdAt))
            .limit(1);

    const sourceRevisionId =
      data.sourceRevisionId ??
      resolvedBuild?.sourceRevisionId ??
      activeRelease?.sourceRevisionId;
    const themeBuildId =
      data.themeBuildId ?? resolvedBuild?.id ?? activeRelease?.themeBuildId;
    if (
      !data.sourceRevisionId &&
      !resolvedBuild &&
      (activeRelease?.sourceGeneration == null ||
        activeRelease.sourceGeneration !== template.sourceGeneration)
    ) {
      throw new Error(
        "PUBLISH_BUILD_NOT_READY: Theme source changed after the active release. Build Preview is required before publishing.",
      );
    }
    if (!sourceRevisionId || !themeBuildId) {
      throw new Error(
        "PUBLISH_BUILD_NOT_READY: No succeeded Build Preview is available for this storefront theme.",
      );
    }

    const [build] = await db
      .select({
        sourceRevisionId: storefrontThemeBuilds.sourceRevisionId,
        status: storefrontThemeBuilds.status,
        artifactPrefix: storefrontThemeBuilds.artifactPrefix,
        manifestJson: storefrontThemeBuilds.manifestJson,
      })
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.id, themeBuildId),
          eq(storefrontThemeBuilds.storefrontId, data.storefrontId),
          eq(storefrontThemeBuilds.themeId, data.themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);

    if (!build) {
      throw new Error(
        `PUBLISH_BUILD_NOT_FOUND: Theme build "${themeBuildId}" was not found for this storefront theme.`,
      );
    }
    if (build.status !== "succeeded") {
      throw new Error(
        `PUBLISH_BUILD_NOT_READY: Theme build "${themeBuildId}" is not succeeded (status: ${build.status}).`,
      );
    }
    if (
      build.sourceRevisionId !== sourceRevisionId ||
      !build.artifactPrefix ||
      !build.manifestJson
    ) {
      throw new Error(
        `PUBLISH_BUILD_MISMATCH: Theme build "${themeBuildId}" is not bound to source revision "${sourceRevisionId}" or has no immutable artifact.`,
      );
    }

    const [revision] = await db
      .select({ document: storefrontThemeTemplateRevisions.document })
      .from(storefrontThemeTemplateRevisions)
      .where(
        and(
          eq(storefrontThemeTemplateRevisions.id, data.expectedDraftRevisionId),
          eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
        ),
      )
      .limit(1);
    if (!revision) return null;

    const document = storefrontPageDocumentSchema.parse(
      typeof revision.document === "string"
        ? JSON.parse(revision.document)
        : revision.document,
    );
    const now = new Date().toISOString();
    const templateUnchanged =
      template.draftRevisionId === template.publishedRevisionId;
    const sourceUnchanged =
      template.publishedSourceRevisionId === sourceRevisionId;
    const unchanged =
      templateUnchanged &&
      sourceUnchanged &&
      activeRelease?.sourceRevisionId === sourceRevisionId &&
      activeRelease?.themeBuildId === themeBuildId;
    const releaseId = unchanged
      ? (activeRelease?.id ?? null)
      : crypto.randomUUID();
    const contentPublication = unchanged
      ? null
      : await storefrontContentPublicationDal.resolveForTheme({
          storefrontId: data.storefrontId,
          themeId: data.themeId,
          templateId: data.templateId,
          templateRevisionId: data.expectedDraftRevisionId,
          createdBy: data.createdBy,
        });

    const statements = [
      env.DATABASE.prepare(
        `
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM storefront_theme_templates t
          INNER JOIN storefront_themes th ON th.id = t.theme_id
          INNER JOIN storefronts s ON s.id = th.storefront_id
          WHERE s.id = ?1
            AND th.id = ?2
            AND t.id = ?3
            AND t.draft_revision_id = ?4
            AND t.draft_generation = ?5
            AND th.release_generation = ?6
            AND s.deleted_at IS NULL
            AND th.deleted_at IS NULL
            AND t.deleted_at IS NULL
        ) AND EXISTS (
          SELECT 1
          FROM storefront_theme_revisions r
          WHERE r.id = ?7
            AND r.theme_id = ?2
            AND r.storefront_id = ?1
            AND r.deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
      ).bind(
        data.storefrontId,
        data.themeId,
        data.templateId,
        data.expectedDraftRevisionId,
        data.expectedDraftGeneration,
        data.expectedReleaseGeneration,
        sourceRevisionId,
      ),
    ];

    if (contentPublication) {
      statements.push(
        ...storefrontContentPublicationDal.insertStatements(contentPublication),
      );
    }

    if (!templateUnchanged) {
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_templates
          SET document = ?1, published_revision_id = ?2, draft_generation = draft_generation + 1, updated_at = ?3
          WHERE id = ?4
            AND theme_id = ?5
            AND draft_revision_id = ?2
            AND deleted_at IS NULL
        `,
        ).bind(
          JSON.stringify(document),
          data.expectedDraftRevisionId,
          now,
          data.templateId,
          data.themeId,
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_template_revisions
          SET published_at = ?1
          WHERE id = ?2 AND template_id = ?3
        `,
        ).bind(now, data.expectedDraftRevisionId, data.templateId),
      );
    }

    if (!unchanged) {
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_themes
          SET published_source_revision_id = ?1, release_generation = release_generation + 1, updated_at = ?2
          WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL
        `,
        ).bind(sourceRevisionId, now, data.themeId, data.storefrontId),
      );
    }

    if (!unchanged) {
      statements.push(
        env.DATABASE.prepare(
          `
          INSERT INTO storefront_releases (
            id, storefront_id, theme_id, source_revision_id, theme_build_id,
            content_publication_id, status, created_by, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'available', ?7, ?8, ?8)
        `,
        ).bind(
          releaseId,
          data.storefrontId,
          data.themeId,
          sourceRevisionId,
          themeBuildId,
          contentPublication?.id ?? null,
          data.createdBy ?? null,
          now,
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefronts
          SET active_release_id = ?1, updated_at = ?2
          WHERE id = ?3 AND deleted_at IS NULL
        `,
        ).bind(releaseId, now, data.storefrontId),
      );
    }

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        const latestContext = await this.findEditorContext(
          data.storefrontId,
          data.themeId,
        );
        const latestTemplate = latestContext?.templates.find(
          (t) => t.id === data.templateId,
        );
        if (
          latestContext &&
          (latestContext.theme.releaseGeneration ?? 1) !==
            data.expectedReleaseGeneration
        ) {
          throw new Error(
            "RELEASE_GENERATION_CONFLICT: Another release was published. Refresh the latest release before publishing again.",
          );
        }
        if (
          latestTemplate &&
          latestTemplate.draftGeneration !== data.expectedDraftGeneration
        ) {
          throw new Error(
            "TEMPLATE_DRAFT_CONFLICT: Template draft was modified concurrently.",
          );
        }
        throw new Error(
          "CONFLICT_PUBLISH_GUARD_FAILED: Template, Source revision, or Release generation mismatch or concurrently modified.",
        );
      }
      throw error;
    }

    return {
      revisionId: data.expectedDraftRevisionId,
      sourceRevisionId,
      draftGeneration: templateUnchanged
        ? (template.draftGeneration ?? 1)
        : (template.draftGeneration ?? 1) + 1,
      releaseGeneration: unchanged
        ? (template.releaseGeneration ?? 1)
        : (template.releaseGeneration ?? 1) + 1,
      templateUnchanged,
      sourceUnchanged,
      unchanged,
      // Surfaced so the caller can deploy the Theme Worker for the release it
      // just activated. Publishing writes D1 atomically, but the deployed
      // script is separate state that has to be reconciled afterwards.
      releaseId,
      themeBuildId,
      /** `true` when this publish created and activated a new release. */
      releaseCreated: !unchanged,
      /**
       * Build the Theme Worker was last recorded as actually running, read from
       * the release that was active before this publish. Lets the caller skip a
       * redeploy when only content changed, without trusting activation alone
       * as evidence that a deployment landed.
       */
      previousDeployedThemeBuildId: readDeployedThemeBuildId(
        activeRelease?.metadata ?? null,
      ),
    };
  },
};
