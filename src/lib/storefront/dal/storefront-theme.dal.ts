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
    const db = await getDb();
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date().toISOString();
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

    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: template.document.sections.map((section) =>
        section.id === data.sectionId
          ? {
              ...section,
              props: {
                ...section.props,
                ...data.props,
              },
            }
          : section,
      ),
    });

    const db = await getDb();
    const [versionRow] = await db
      .select({ value: max(storefrontThemeTemplateRevisions.version) })
      .from(storefrontThemeTemplateRevisions)
      .where(eq(storefrontThemeTemplateRevisions.templateId, data.templateId));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date().toISOString();
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
    if (template.draftRevisionId === template.publishedRevisionId) {
      return { revisionId: template.draftRevisionId, unchanged: true };
    }

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
    await db.batch([
      db
        .update(storefrontThemeTemplates)
        .set({
          document,
          publishedRevisionId: template.draftRevisionId,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontThemeTemplates.id, data.templateId),
            eq(storefrontThemeTemplates.themeId, data.themeId),
            eq(
              storefrontThemeTemplates.draftRevisionId,
              template.draftRevisionId,
            ),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        ),
      db
        .update(storefrontThemeTemplateRevisions)
        .set({ publishedAt: now })
        .where(
          and(
            eq(storefrontThemeTemplateRevisions.id, template.draftRevisionId),
            eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
          ),
        ),
    ]);
    return { revisionId: template.draftRevisionId, unchanged: false };
  },
};
