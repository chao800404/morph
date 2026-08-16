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

const SOURCE_PRESENTATION_PROP_KEYS = new Set([
  "backgroundColor", "textColor", "textAlign", "fontFamily", "fontWeight",
  "lineHeight", "fontSize", "borderRadius", "padding", "paddingTop",
  "paddingBottom", "paddingLeft", "paddingRight", "className", "customClass",
]);

function stripPresentationProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !SOURCE_PRESENTATION_PROP_KEYS.has(key)),
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
        if (
          template.draftRevisionId &&
          revisionIdPattern.test(template.draftRevisionId)
        ) {
          const [revision] = await db
            .select({ document: storefrontThemeTemplateRevisions.document })
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
          if (revision) document = revision.document;
        }
        return {
          id: template.id,
          type: template.type,
          name: template.name,
          document: storefrontPageDocumentSchema.parse(document),
          draftRevisionId: template.draftRevisionId,
          publishedRevisionId: template.publishedRevisionId,
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
      },
      templates,
    };
  },
  async reorderSections(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionIds: string[];
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
        await db.batch([
          db
            .update(storefrontThemeTemplateRevisions)
            .set({ document })
            .where(
              eq(storefrontThemeTemplateRevisions.id, activeDraft.id),
            ),
          db
            .update(storefrontThemeTemplates)
            .set({ updatedAt: now })
            .where(
              and(
                eq(storefrontThemeTemplates.id, data.templateId),
                eq(storefrontThemeTemplates.themeId, data.themeId),
              ),
            ),
        ]);
        return { document, version: activeDraft.version };
      }
    }

    // Branch a new draft revision
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;

    await db.batch([
      db.insert(storefrontThemeTemplateRevisions).values({
        id: revisionId,
        templateId: data.templateId,
        version,
        document,
        createdBy: data.createdBy,
        createdAt: now,
      }),
      db
        .update(storefrontThemeTemplates)
        .set({ draftRevisionId: revisionId, updatedAt: now })
        .where(
          and(
            eq(storefrontThemeTemplates.id, data.templateId),
            eq(storefrontThemeTemplates.themeId, data.themeId),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        ),
    ]);
    return { document, version };
  },
  async updateSectionProps(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionId: string;
    props: Record<string, unknown>;
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
    const sourceBacked =
      Boolean(targetSection.componentRef) || targetSection.type === "hero";
    const incomingProps = sourceBacked
      ? stripPresentationProps(restProps)
      : restProps;

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
                ...(sourceBacked
                  ? stripPresentationProps(
                      section.props as Record<string, unknown>,
                    )
                  : section.props),
                ...incomingProps,
              },
            }
          : section,
      ),
    });

    const now = new Date().toISOString();
    const db = await getDb();

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
        await db.batch([
          db
            .update(storefrontThemeTemplateRevisions)
            .set({ document })
            .where(
              eq(storefrontThemeTemplateRevisions.id, activeDraft.id),
            ),
          db
            .update(storefrontThemeTemplates)
            .set({ updatedAt: now })
            .where(
              and(
                eq(storefrontThemeTemplates.id, data.templateId),
                eq(storefrontThemeTemplates.themeId, data.themeId),
              ),
            ),
        ]);
        return { document, version: activeDraft.version };
      }
    }

    // Branch a new draft revision
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;

    await db.batch([
      db.insert(storefrontThemeTemplateRevisions).values({
        id: revisionId,
        templateId: data.templateId,
        version,
        document,
        createdBy: data.createdBy,
        createdAt: now,
      }),
      db
        .update(storefrontThemeTemplates)
        .set({ draftRevisionId: revisionId, updatedAt: now })
        .where(
          and(
            eq(storefrontThemeTemplates.id, data.templateId),
            eq(storefrontThemeTemplates.themeId, data.themeId),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        ),
    ]);
    return { document, version };
  },
  async publishTemplate(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    createdBy?: string;
  }) {
    const db = await getDb();
    const [template] = await db
      .select({
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
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

    if (!template?.draftRevisionId) return null;

    const [revision] = await db
      .select({ document: storefrontThemeTemplateRevisions.document })
      .from(storefrontThemeTemplateRevisions)
      .where(
        and(
          eq(storefrontThemeTemplateRevisions.id, template.draftRevisionId),
          eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
        ),
      )
      .limit(1);
    if (!revision) return null;

    const document = storefrontPageDocumentSchema.parse(revision.document);
    const now = new Date().toISOString();
    const sourceRevisionId = crypto.randomUUID();
    const unchanged =
      template.draftRevisionId === template.publishedRevisionId;

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
            AND s.deleted_at IS NULL
            AND th.deleted_at IS NULL
            AND t.deleted_at IS NULL
        ) THEN 1 ELSE json('null') END AS ok
      `).bind(
        data.storefrontId,
        data.themeId,
        data.templateId,
        template.draftRevisionId,
      ),
    ];

    if (!unchanged) {
      statements.push(
        env.DATABASE.prepare(`
          UPDATE storefront_theme_templates
          SET document = ?1, published_revision_id = ?2, updated_at = ?3
          WHERE id = ?4
            AND theme_id = ?5
            AND draft_revision_id = ?2
            AND deleted_at IS NULL
        `).bind(
          JSON.stringify(document),
          template.draftRevisionId,
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
        `).bind(now, template.draftRevisionId, data.templateId),
      );
    }

    statements.push(
      env.DATABASE.prepare(`
        INSERT INTO storefront_theme_revisions (
          id, storefront_id, theme_id, revision_number, message, source,
          snapshot, created_by, created_at, updated_at
        )
        SELECT
          ?1, ?2, ?3,
          COALESCE((
            SELECT MAX(revision_number) + 1
            FROM storefront_theme_revisions
            WHERE theme_id = ?3 AND deleted_at IS NULL
          ), 1),
          'Published Theme Source',
          'publish',
          COALESCE((
            SELECT json_group_array(
              json_object(
                'path', path,
                'content', content,
                'mimeType', COALESCE(mime_type, 'text/plain'),
                'isEntry', json(CASE WHEN is_entry = 1 THEN 'true' ELSE 'false' END)
              )
            )
            FROM (
              SELECT path, content, mime_type, is_entry
              FROM storefront_theme_files
              WHERE storefront_id = ?2 AND theme_id = ?3 AND deleted_at IS NULL
              ORDER BY path
            )
          ), json('[]')),
          ?4, ?5, ?5
      `).bind(
        sourceRevisionId,
        data.storefrontId,
        data.themeId,
        data.createdBy ?? null,
        now,
      ),
    );
    statements.push(
      env.DATABASE.prepare(`
        UPDATE storefront_themes
        SET published_source_revision_id = ?1, updated_at = ?2
        WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL
      `).bind(sourceRevisionId, now, data.themeId, data.storefrontId),
    );

    await env.DATABASE.batch(statements);
    return {
      revisionId: template.draftRevisionId,
      sourceRevisionId,
      unchanged,
    };
  },
};
