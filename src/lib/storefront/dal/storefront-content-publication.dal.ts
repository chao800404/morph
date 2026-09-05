import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import {
  storefrontContentPublicationItems,
  storefrontContentPublications,
  storefrontPages,
  storefrontPageRevisions,
  storefrontThemeTemplateRevisions,
  storefrontThemeTemplates,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontTemplateType } from "@/db/storefront.schema";
import type {
  StorefrontContentPublicationDTO,
  StorefrontContentPublicationItemDTO,
} from "@/lib/storefront/dto/storefront-content-publication.dto";
import { and, eq, isNull } from "drizzle-orm";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";

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
/**
 * Collects `assetId` from every media reference in a published document.
 *
 * Walks the document rather than reading known field names: media can sit at
 * any depth, including inside array rows, and a walker cannot fall out of step
 * with the field types a Theme declares.
 */
function collectAssetIds(document: unknown, into: Set<string>): void {
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = node as Record<string, unknown>;
    if (record.source === "asset" && typeof record.assetId === "string") {
      const assetId = record.assetId.trim();
      if (assetId) into.add(assetId);
    }
    for (const value of Object.values(record)) visit(value);
  };

  visit(
    typeof document === "string"
      ? (() => {
          try {
            return JSON.parse(document);
          } catch {
            return null;
          }
        })()
      : document,
  );
}

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

  /**
   * Validates the immutable content set before a release can become active.
   * Polymorphic revision references are checked here because SQLite cannot
   * express a conditional foreign key for template/page/navigation rows.
   */
  async assertValidForRelease(data: {
    storefrontId: string;
    publicationId: string;
  }): Promise<void> {
    const db = await getDb();
    const [publication] = await db
      .select({ id: storefrontContentPublications.id })
      .from(storefrontContentPublications)
      .where(
        and(
          eq(storefrontContentPublications.id, data.publicationId),
          eq(storefrontContentPublications.storefrontId, data.storefrontId),
          isNull(storefrontContentPublications.deletedAt),
        ),
      )
      .limit(1);
    if (!publication) {
      throw new Error(
        "CONTENT_PUBLICATION_INVALID: Publication is missing, deleted, or belongs to another storefront.",
      );
    }

    const items = await db
      .select({
        id: storefrontContentPublicationItems.id,
        itemType: storefrontContentPublicationItems.itemType,
        contentId: storefrontContentPublicationItems.contentId,
        revisionId: storefrontContentPublicationItems.revisionId,
        deletedAt: storefrontContentPublicationItems.deletedAt,
      })
      .from(storefrontContentPublicationItems)
      .where(eq(storefrontContentPublicationItems.publicationId, data.publicationId));
    for (const item of items) {
      if (item.deletedAt !== null || !item.contentId.trim() || !item.revisionId.trim()) {
        throw new Error("CONTENT_PUBLICATION_INVALID: Publication contains an invalid or deleted content reference.");
      }

      let document: unknown;
      if (item.itemType === "template") {
        const [revision] = await db
          .select({ document: storefrontThemeTemplateRevisions.document })
          .from(storefrontThemeTemplateRevisions)
          .innerJoin(storefrontThemeTemplates, eq(storefrontThemeTemplateRevisions.templateId, storefrontThemeTemplates.id))
          .innerJoin(storefrontThemes, eq(storefrontThemeTemplates.themeId, storefrontThemes.id))
          .where(and(
            eq(storefrontThemeTemplateRevisions.id, item.revisionId),
            eq(storefrontThemeTemplateRevisions.templateId, item.contentId),
            eq(storefrontThemes.storefrontId, data.storefrontId),
            isNull(storefrontThemeTemplates.deletedAt),
            isNull(storefrontThemes.deletedAt),
          ))
          .limit(1);
        document = revision?.document;
      } else if (item.itemType === "page") {
        const [revision] = await db
          .select({ document: storefrontPageRevisions.document })
          .from(storefrontPageRevisions)
          .innerJoin(storefrontPages, eq(storefrontPageRevisions.pageId, storefrontPages.id))
          .where(and(
            eq(storefrontPageRevisions.id, item.revisionId),
            eq(storefrontPageRevisions.pageId, item.contentId),
            eq(storefrontPages.storefrontId, data.storefrontId),
            isNull(storefrontPages.deletedAt),
          ))
          .limit(1);
        document = revision?.document;
      } else {
        throw new Error("CONTENT_PUBLICATION_INVALID: Navigation publication items are not supported.");
      }

      let parsedDocument = document;
      if (typeof parsedDocument === "string") {
        try {
          parsedDocument = JSON.parse(parsedDocument) as unknown;
        } catch {
          throw new Error("CONTENT_PUBLICATION_INVALID: Publication contains a missing or malformed content snapshot.");
        }
      }
      if (parsedDocument === undefined || !storefrontPageDocumentSchema.safeParse(parsedDocument).success) {
        throw new Error("CONTENT_PUBLICATION_INVALID: Publication contains a missing or malformed content snapshot.");
      }
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

  /**
   * Published document for one template type inside a ContentPublication.
   *
   * Scoped to the publication the active release points at, so a draft revision
   * can never reach the public runtime. Returns `null` when the release
   * publishes nothing for that template, which the caller treats as "no
   * authored content" rather than an error.
   */
  /**
   * Asset ids the given publication's documents refer to.
   *
   * This is the authorisation set for public media delivery: a visitor may
   * read the media a release actually published, and nothing else in the
   * library. Derived from the published documents rather than a side table so
   * it cannot drift from what is being served — a reference that is not in the
   * content is not published, whatever any index says.
   */
  async listPublishedAssetIds(publicationId: string): Promise<Set<string>> {
    const db = await getDb();
    const rows = await db
      .select({ document: storefrontThemeTemplateRevisions.document })
      .from(storefrontContentPublicationItems)
      .innerJoin(
        storefrontThemeTemplateRevisions,
        eq(
          storefrontContentPublicationItems.revisionId,
          storefrontThemeTemplateRevisions.id,
        ),
      )
      .where(
        and(
          eq(storefrontContentPublicationItems.publicationId, publicationId),
          isNull(storefrontContentPublicationItems.deletedAt),
        ),
      );

    const assetIds = new Set<string>();
    for (const row of rows) {
      collectAssetIds(row.document, assetIds);
    }
    return assetIds;
  },

  /**
   * Which of these assets are referenced by published content.
   *
   * Deletion treats product and variant usage as detachable, but a publication
   * is immutable: its bytes are what a live storefront serves and what a
   * rollback restores. Removing them does not detach a reference, it breaks a
   * page that is already public, so this is a refusal rather than a warning.
   */
  async findPublishedAssetReferences(
    assetIds: readonly string[],
  ): Promise<Set<string>> {
    const referenced = new Set<string>();
    if (assetIds.length === 0) return referenced;

    const db = await getDb();
    const rows = await db
      .select({ document: storefrontThemeTemplateRevisions.document })
      .from(storefrontContentPublicationItems)
      .innerJoin(
        storefrontThemeTemplateRevisions,
        eq(
          storefrontContentPublicationItems.revisionId,
          storefrontThemeTemplateRevisions.id,
        ),
      )
      .where(isNull(storefrontContentPublicationItems.deletedAt));

    const wanted = new Set(assetIds);
    for (const row of rows) {
      const found = new Set<string>();
      collectAssetIds(row.document, found);
      for (const id of found) if (wanted.has(id)) referenced.add(id);
    }
    return referenced;
  },

  /**
   * The published document for one Page, found by its handle.
   *
   * Publications already carry page items, but the content endpoint could only
   * ask for a *template type*, so a published Page was unreachable and every
   * request for it fell through to empty slots. Two different pages resolved
   * identically, which is the same answer as "no content" and therefore
   * indistinguishable from a route the Document never described.
   */
  async getPublishedPageDocument(data: {
    publicationId: string;
    handle: string;
  }): Promise<unknown | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({ document: storefrontPageRevisions.document })
        .from(storefrontContentPublicationItems)
        .innerJoin(
          storefrontPageRevisions,
          eq(
            storefrontContentPublicationItems.revisionId,
            storefrontPageRevisions.id,
          ),
        )
        .innerJoin(
          storefrontPages,
          eq(storefrontPageRevisions.pageId, storefrontPages.id),
        )
        .where(
          and(
            eq(
              storefrontContentPublicationItems.publicationId,
              data.publicationId,
            ),
            eq(storefrontContentPublicationItems.itemType, "page"),
            eq(storefrontPages.handle, data.handle),
            isNull(storefrontPages.deletedAt),
            isNull(storefrontContentPublicationItems.deletedAt),
          ),
        )
        .limit(1),
    );
    return row?.document ?? null;
  },

  async getPublishedTemplateDocument(data: {
    publicationId: string;
    templateType: StorefrontTemplateType;
  }): Promise<unknown | null> {
    const db = await getDb();
    const row = firstOrNull(
      await db
        .select({ document: storefrontThemeTemplateRevisions.document })
        .from(storefrontContentPublicationItems)
        .innerJoin(
          storefrontThemeTemplateRevisions,
          eq(
            storefrontContentPublicationItems.revisionId,
            storefrontThemeTemplateRevisions.id,
          ),
        )
        .innerJoin(
          storefrontThemeTemplates,
          eq(
            storefrontThemeTemplateRevisions.templateId,
            storefrontThemeTemplates.id,
          ),
        )
        .where(
          and(
            eq(
              storefrontContentPublicationItems.publicationId,
              data.publicationId,
            ),
            eq(storefrontContentPublicationItems.itemType, "template"),
            eq(storefrontThemeTemplates.type, data.templateType),
            isNull(storefrontContentPublicationItems.deletedAt),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        )
        .limit(1),
    );
    return row?.document ?? null;
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
