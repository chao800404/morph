import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefrontContentPublicationItems,
  storefrontContentPublications,
  storefrontPages,
  storefrontThemeTemplateRevisions,
  storefrontThemeTemplates,
} from "@/db/storefront.schema";
import type {
  StorefrontContentPublicationDTO,
  StorefrontContentPublicationItemDTO,
} from "@/lib/storefront/dto/storefront-content-publication.dto";
import { and, eq, isNull } from "drizzle-orm";

export type StorefrontContentPublicationDraft = StorefrontContentPublicationDTO;

const mapItem = (
  row: typeof storefrontContentPublicationItems.$inferSelect,
): StorefrontContentPublicationItemDTO => ({
  id: row.id,
  publicationId: row.publicationId,
  itemType: row.itemType,
  contentId: row.contentId,
  revisionId: row.revisionId,
});

/** Creates an immutable content revision set for a storefront release. */
export const storefrontContentPublicationDal = {
  async isRevisionReferenced(revisionId: string): Promise<boolean> {
    const db = await getDb();
    const [reference] = await db
      .select({ id: storefrontContentPublicationItems.id })
      .from(storefrontContentPublicationItems)
      .where(eq(storefrontContentPublicationItems.revisionId, revisionId))
      .limit(1);
    return Boolean(reference);
  },

  async assertRevisionCanBeDeleted(revisionId: string): Promise<void> {
    if (await this.isRevisionReferenced(revisionId)) {
      throw new Error(
        `REVISION_RETENTION_CONFLICT: Revision "${revisionId}" is referenced by an immutable ContentPublication and cannot be hard-deleted.`,
      );
    }
  },

  async assertRevisionsCanBeDeleted(revisionIds: string[]): Promise<void> {
    for (const revisionId of revisionIds) {
      await this.assertRevisionCanBeDeleted(revisionId);
    }
  },

  async resolveForTheme(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    templateRevisionId: string;
    createdBy?: string;
  }): Promise<StorefrontContentPublicationDraft> {
    const db = await getDb();
    const [templateRevision] = await db
      .select({
        id: storefrontThemeTemplateRevisions.id,
        templateId: storefrontThemeTemplateRevisions.templateId,
      })
      .from(storefrontThemeTemplateRevisions)
      .innerJoin(
        storefrontThemeTemplates,
        eq(storefrontThemeTemplateRevisions.templateId, storefrontThemeTemplates.id),
      )
      .where(
        and(
          eq(storefrontThemeTemplateRevisions.id, data.templateRevisionId),
          eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
          eq(storefrontThemeTemplates.themeId, data.themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!templateRevision) {
      throw new Error("CONTENT_PUBLICATION_REVISION_NOT_FOUND: Template revision is not valid for this theme.");
    }

    const publishedTemplates = await db
      .select({
        id: storefrontThemeTemplates.id,
        revisionId: storefrontThemeTemplates.publishedRevisionId,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, data.themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      );

    // Capture every currently published content reference. The target
    // template is replaced with the revision being published; all other
    // templates/pages remain exactly as they were in this release.
    const publishedPages = await db
      .select({ id: storefrontPages.id, revisionId: storefrontPages.publishedRevisionId })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.storefrontId, data.storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      );

    const publicationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const items = [
      ...publishedTemplates
        .map((template) => ({
          id: crypto.randomUUID(),
          publicationId,
          itemType: "template" as const,
          contentId: template.id,
          revisionId:
            template.id === data.templateId
              ? templateRevision.id
              : template.revisionId,
          createdAt: now,
          updatedAt: now,
        }))
        .filter(
          (template): template is typeof template & { revisionId: string } =>
            Boolean(template.revisionId),
        ),
      ...publishedPages
        .filter((page): page is { id: string; revisionId: string } => Boolean(page.revisionId))
        .map((page) => ({
          id: crypto.randomUUID(),
          publicationId,
          itemType: "page" as const,
          contentId: page.id,
          revisionId: page.revisionId,
          createdAt: now,
          updatedAt: now,
        })),
    ];

    return {
      id: publicationId,
      storefrontId: data.storefrontId,
      createdBy: data.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      items: items.map((item) => ({
        id: item.id,
        publicationId,
        itemType: item.itemType,
        contentId: item.contentId,
        revisionId: item.revisionId,
      })),
    };
  },

  insertStatements(publication: StorefrontContentPublicationDraft) {
    return [
      env.DATABASE.prepare(`
        INSERT INTO storefront_content_publications
          (id, storefront_id, created_by, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
      `).bind(
        publication.id,
        publication.storefrontId,
        publication.createdBy,
        publication.createdAt,
      ),
      ...publication.items.map((item) =>
        env.DATABASE.prepare(`
          INSERT INTO storefront_content_publication_items
            (id, publication_id, item_type, content_id, revision_id, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        `).bind(
          item.id,
          publication.id,
          item.itemType,
          item.contentId,
          item.revisionId,
          publication.createdAt,
        ),
      ),
    ];
  },

  /** Compatibility helper for callers that explicitly want persistence. */
  async createForTheme(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    templateRevisionId: string;
    createdBy?: string;
  }): Promise<StorefrontContentPublicationDTO> {
    const publication = await this.resolveForTheme(data);
    await env.DATABASE.batch(this.insertStatements(publication));
    return publication;
  },

  async getById(
    storefrontId: string,
    publicationId: string,
  ): Promise<StorefrontContentPublicationDTO | null> {
    const db = await getDb();
    const [publication] = await db
      .select()
      .from(storefrontContentPublications)
      .where(
        and(
          eq(storefrontContentPublications.id, publicationId),
          eq(storefrontContentPublications.storefrontId, storefrontId),
          isNull(storefrontContentPublications.deletedAt),
        ),
      )
      .limit(1);
    if (!publication) return null;
    const items = await db
      .select()
      .from(storefrontContentPublicationItems)
      .where(
        and(
          eq(storefrontContentPublicationItems.publicationId, publicationId),
          isNull(storefrontContentPublicationItems.deletedAt),
        ),
      );
    return {
      id: publication.id,
      storefrontId: publication.storefrontId,
      createdBy: publication.createdBy,
      createdAt: publication.createdAt,
      updatedAt: publication.updatedAt,
      items: items.map(mapItem),
    };
  },
};
