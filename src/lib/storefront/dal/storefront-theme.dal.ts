import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
  storefrontThemeTemplateRevisions,
} from "@/db/storefront.schema";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { and, asc, eq, isNull, max } from "drizzle-orm";

const revisionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
): Record<string, unknown> {
  // If componentRef is explicitly specified, check COMPONENT_CONTENT_MANIFESTS.
  // If not found in manifest, return {} (strict reject, do not fall back to sectionType).
  if (componentRef) {
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
}) {
  return env.DATABASE.prepare(`
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
        AND s.deleted_at IS NULL
        AND th.deleted_at IS NULL
        AND t.deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok
  `).bind(
    args.storefrontId,
    args.themeId,
    args.templateId,
    args.expectedDraftGeneration,
    args.expectedDraftRevisionId ?? "",
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
          document: storefrontPageDocumentSchema.parse(
            typeof document === "string" ? JSON.parse(document) : document,
          ),
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
      },
      theme: {
        id: context.themeId,
        name: context.themeName,
        status: context.themeStatus,
        releaseGeneration: context.themeReleaseGeneration ?? 1,
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
          env.DATABASE.prepare(`
            UPDATE storefront_theme_template_revisions
            SET document = ?1
            WHERE id = ?2 AND template_id = ?3
          `).bind(JSON.stringify(document), activeDraft.id, data.templateId),
          env.DATABASE.prepare(`
            UPDATE storefront_theme_templates
            SET draft_generation = ?1, updated_at = ?2
            WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL
          `).bind(nextGeneration, now, data.templateId, data.themeId),
        ];

        try {
          await env.DATABASE.batch(statements);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("malformed JSON") || message.includes("constraint")) {
            throw new Error("CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.");
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
      env.DATABASE.prepare(`
        INSERT INTO storefront_theme_template_revisions (
          id, template_id, version, document, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `).bind(
        revisionId,
        data.templateId,
        version,
        JSON.stringify(document),
        data.createdBy,
        now,
      ),
      env.DATABASE.prepare(`
        UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, draft_generation = ?2, updated_at = ?3
        WHERE id = ?4 AND theme_id = ?5 AND deleted_at IS NULL
      `).bind(revisionId, nextGeneration, now, data.templateId, data.themeId),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error("CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.");
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

    const { enabled: propEnabled, ...restProps } = data.props;
    const cleanIncomingProps = filterSectionContentProps(
      targetSection.type,
      restProps,
      targetSection.componentRef,
    );
    const cleanExistingProps = filterSectionContentProps(
      targetSection.type,
      (targetSection.props as Record<string, unknown>) ?? {},
      targetSection.componentRef,
    );

    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: template.document.sections.map((section) =>
        section.id === data.sectionId
          ? {
              ...section,
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
          env.DATABASE.prepare(`
            UPDATE storefront_theme_template_revisions
            SET document = ?1
            WHERE id = ?2 AND template_id = ?3
          `).bind(JSON.stringify(document), activeDraft.id, data.templateId),
          env.DATABASE.prepare(`
            UPDATE storefront_theme_templates
            SET draft_generation = ?1, updated_at = ?2
            WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL
          `).bind(nextGeneration, now, data.templateId, data.themeId),
        ];

        try {
          await env.DATABASE.batch(statements);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("malformed JSON") || message.includes("constraint")) {
            throw new Error("CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.");
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
      env.DATABASE.prepare(`
        INSERT INTO storefront_theme_template_revisions (
          id, template_id, version, document, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `).bind(
        revisionId,
        data.templateId,
        version,
        JSON.stringify(document),
        data.createdBy,
        now,
      ),
      env.DATABASE.prepare(`
        UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, draft_generation = ?2, updated_at = ?3
        WHERE id = ?4 AND theme_id = ?5 AND deleted_at IS NULL
      `).bind(revisionId, nextGeneration, now, data.templateId, data.themeId),
    ];

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error("CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.");
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
    sourceRevisionId: string;
    expectedDraftRevisionId: string;
    expectedDraftGeneration: number;
    expectedReleaseGeneration: number;
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
      template.publishedSourceRevisionId === data.sourceRevisionId;
    const unchanged = templateUnchanged && sourceUnchanged;

    const statements = [
      env.DATABASE.prepare(`
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
      `).bind(
        data.storefrontId,
        data.themeId,
        data.templateId,
        data.expectedDraftRevisionId,
        data.expectedDraftGeneration,
        data.expectedReleaseGeneration,
        data.sourceRevisionId,
      ),
    ];

    if (!templateUnchanged) {
      statements.push(
        env.DATABASE.prepare(`
          UPDATE storefront_theme_templates
          SET document = ?1, published_revision_id = ?2, draft_generation = draft_generation + 1, updated_at = ?3
          WHERE id = ?4
            AND theme_id = ?5
            AND draft_revision_id = ?2
            AND deleted_at IS NULL
        `).bind(
          JSON.stringify(document),
          data.expectedDraftRevisionId,
          now,
          data.templateId,
          data.themeId,
        ),
      );
      statements.push(
        env.DATABASE.prepare(`
          UPDATE storefront_theme_template_revisions
          SET published_at = ?1
          WHERE id = ?2 AND template_id = ?3
        `).bind(now, data.expectedDraftRevisionId, data.templateId),
      );
    }

    statements.push(
      env.DATABASE.prepare(`
        UPDATE storefront_themes
        SET published_source_revision_id = ?1, release_generation = release_generation + 1, updated_at = ?2
        WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL
      `).bind(data.sourceRevisionId, now, data.themeId, data.storefrontId),
    );

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error("CONFLICT_PUBLISH_GUARD_FAILED: Template, Source revision, or Release generation mismatch or concurrently modified.");
      }
      throw error;
    }

    return {
      revisionId: data.expectedDraftRevisionId,
      sourceRevisionId: data.sourceRevisionId,
      draftGeneration: templateUnchanged
        ? (template.draftGeneration ?? 1)
        : (template.draftGeneration ?? 1) + 1,
      releaseGeneration: (template.releaseGeneration ?? 1) + 1,
      templateUnchanged,
      sourceUnchanged,
      unchanged,
    };
  },
};
