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
import { and, eq, isNull, or, sql } from "drizzle-orm";
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
  ...(typeof row.metadata?.handle === "string"
    ? { metadata: { handle: row.metadata.handle } }
    : {}),
});

/** Creates an immutable content revision set for a storefront release. */
/**
 * Collects each published media reference as `assetId -> storage key`.
 *
 * The key comes from the URL stored in the document, which is the one the
 * asset had when the release was published. Reading the asset's current URL
 * instead let an edit in the library change a live storefront with no publish,
 * and left a rollback with no way to reach the bytes it needed.
 *
 * Walks the document rather than reading known field names: media can sit at
 * any depth, including inside array rows, and a walker cannot fall out of step
 * with the field types a Theme declares.
 */
function collectAssetKeys(
  document: unknown,
  into: Map<string, Set<string>>,
): void {
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
      const url = typeof record.url === "string" ? record.url : "";
      const key = url.replace(/^\/+/, "");
      // Only a CMS delivery path names an object this may serve.
      if (assetId && key.startsWith("assets/") && !key.includes("..")) {
        const versions = into.get(assetId) ?? new Set<string>();
        versions.add(key);
        into.set(assetId, versions);
      }
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
      .where(
        eq(storefrontContentPublicationItems.publicationId, data.publicationId),
      );
    for (const item of items) {
      if (
        item.deletedAt !== null ||
        !item.contentId.trim() ||
        !item.revisionId.trim()
      ) {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Publication contains an invalid or deleted content reference.",
        );
      }

      let document: unknown;
      if (item.itemType === "template") {
        const [revision] = await db
          .select({ document: storefrontThemeTemplateRevisions.document })
          .from(storefrontThemeTemplateRevisions)
          .innerJoin(
            storefrontThemeTemplates,
            eq(
              storefrontThemeTemplateRevisions.templateId,
              storefrontThemeTemplates.id,
            ),
          )
          .innerJoin(
            storefrontThemes,
            eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
          )
          .where(
            and(
              eq(storefrontThemeTemplateRevisions.id, item.revisionId),
              eq(storefrontThemeTemplateRevisions.templateId, item.contentId),
              eq(storefrontThemes.storefrontId, data.storefrontId),
              isNull(storefrontThemeTemplates.deletedAt),
              isNull(storefrontThemes.deletedAt),
            ),
          )
          .limit(1);
        document = revision?.document;
      } else if (item.itemType === "page") {
        const [revision] = await db
          .select({ document: storefrontPageRevisions.document })
          .from(storefrontPageRevisions)
          .innerJoin(
            storefrontPages,
            eq(storefrontPageRevisions.pageId, storefrontPages.id),
          )
          .where(
            and(
              eq(storefrontPageRevisions.id, item.revisionId),
              eq(storefrontPageRevisions.pageId, item.contentId),
              eq(storefrontPages.storefrontId, data.storefrontId),
            ),
          )
          .limit(1);
        document = revision?.document;
      } else {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Navigation publication items are not supported.",
        );
      }

      let parsedDocument = document;
      if (typeof parsedDocument === "string") {
        try {
          parsedDocument = JSON.parse(parsedDocument) as unknown;
        } catch {
          throw new Error(
            "CONTENT_PUBLICATION_INVALID: Publication contains a missing or malformed content snapshot.",
          );
        }
      }
      if (
        parsedDocument === undefined ||
        !storefrontPageDocumentSchema.safeParse(parsedDocument).success
      ) {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Publication contains a missing or malformed content snapshot.",
        );
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
        eq(
          storefrontThemeTemplateRevisions.templateId,
          storefrontThemeTemplates.id,
        ),
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
      throw new Error(
        "CONTENT_PUBLICATION_REVISION_NOT_FOUND: Template revision is not valid for this theme.",
      );
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
      .select({
        id: storefrontPages.id,
        revisionId: storefrontPages.publishedRevisionId,
        handle: storefrontPages.handle,
        draftRevisionId: storefrontPages.draftRevisionId,
        document: storefrontPageRevisions.document,
      })
      .from(storefrontPages)
      .innerJoin(
        storefrontPageRevisions,
        and(
          eq(storefrontPageRevisions.id, storefrontPages.publishedRevisionId),
          eq(storefrontPageRevisions.pageId, storefrontPages.id),
        ),
      )
      .where(
        and(
          eq(storefrontPages.storefrontId, data.storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      );

    const pageHandles = new Map<string, string>();
    for (const page of publishedPages) {
      let handle = page.document.handle;
      if (!handle) {
        // Legacy revisions can only reuse an actual immutable route snapshot.
        // Conflicting history is not evidence for either URL.
        const snapshots = await db
          .select({ metadata: storefrontContentPublicationItems.metadata })
          .from(storefrontContentPublicationItems)
          .where(
            and(
              eq(storefrontContentPublicationItems.itemType, "page"),
              eq(storefrontContentPublicationItems.contentId, page.id),
              eq(
                storefrontContentPublicationItems.revisionId,
                page.revisionId!,
              ),
              isNull(storefrontContentPublicationItems.deletedAt),
            ),
          );
        const handles = new Set(
          snapshots.flatMap((row) =>
            typeof row.metadata?.handle === "string"
              ? [row.metadata.handle]
              : [],
          ),
        );
        if (handles.size === 1) handle = [...handles][0];
        // No intervening draft exists: the original legacy handle is provable.
        if (
          !handle &&
          handles.size === 0 &&
          page.draftRevisionId === page.revisionId
        )
          handle = page.handle;
      }
      if (!handle)
        throw new Error(
          "CONTENT_PUBLICATION_PAGE_ROUTE_UNAVAILABLE: Republish this Page to capture its route before publishing the Theme.",
        );
      pageHandles.set(page.id, handle);
    }

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
        .filter((page): page is typeof page & { revisionId: string } =>
          Boolean(page.revisionId),
        )
        .map((page) => ({
          id: crypto.randomUUID(),
          publicationId,
          itemType: "page" as const,
          contentId: page.id,
          revisionId: page.revisionId,
          // The handle at publish time. A Page's handle is editable, and the
          // public runtime resolved a URL against the *current* one, so
          // renaming a draft silently changed which content an already
          // published release served at that address.
          metadata: { handle: pageHandles.get(page.id)! },
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
        ...("metadata" in item ? { metadata: item.metadata } : {}),
      })),
    };
  },

  insertStatements(publication: StorefrontContentPublicationDraft) {
    return [
      env.DATABASE.prepare(
        `
        INSERT INTO storefront_content_publications
          (id, storefront_id, created_by, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
      `,
      ).bind(
        publication.id,
        publication.storefrontId,
        publication.createdBy,
        publication.createdAt,
      ),
      ...publication.items.map((item) =>
        env.DATABASE.prepare(
          `
          INSERT INTO storefront_content_publication_items
            (id, publication_id, item_type, content_id, revision_id, created_at, updated_at, metadata)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)
        `,
        ).bind(
          item.id,
          publication.id,
          item.itemType,
          item.contentId,
          item.revisionId,
          publication.createdAt,
          JSON.stringify(item.metadata ?? {}),
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
   * Every published document in a publication, template and Page alike.
   *
   * Scanning only template revisions left media that a Page referenced outside
   * the published set: those images 404'd for visitors and were not protected
   * from deletion, even though a live page was serving them.
   *
   * Omitting `publicationId` scans every live publication, which is what a
   * deletion check needs.
   */
  async listPublishedDocuments(publicationId?: string): Promise<unknown[]> {
    const db = await getDb();
    const scope = publicationId
      ? and(
          eq(storefrontContentPublicationItems.publicationId, publicationId),
          isNull(storefrontContentPublicationItems.deletedAt),
        )
      : isNull(storefrontContentPublicationItems.deletedAt);

    const [templates, pages] = await Promise.all([
      db
        .select({ document: storefrontThemeTemplateRevisions.document })
        .from(storefrontContentPublicationItems)
        .innerJoin(
          storefrontThemeTemplateRevisions,
          eq(
            storefrontContentPublicationItems.revisionId,
            storefrontThemeTemplateRevisions.id,
          ),
        )
        .where(scope),
      db
        .select({ document: storefrontPageRevisions.document })
        .from(storefrontContentPublicationItems)
        .innerJoin(
          storefrontPageRevisions,
          eq(
            storefrontContentPublicationItems.revisionId,
            storefrontPageRevisions.id,
          ),
        )
        .where(scope),
    ]);

    return [...templates, ...pages].map((row) => row.document);
  },

  /**
   * Asset id to the storage key it had when this publication was made.
   *
   * The key is both the authorisation and the bytes: a visitor may read exactly
   * what the live release published, at the version it published.
   */
  async listPublishedAssetKeys(
    publicationId: string,
  ): Promise<Map<string, Set<string>>> {
    const keys = new Map<string, Set<string>>();
    for (const document of await this.listPublishedDocuments(publicationId)) {
      collectAssetKeys(document, keys);
    }
    return keys;
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

    const wanted = new Set(assetIds);
    for (const document of await this.listPublishedDocuments()) {
      const found = new Map<string, Set<string>>();
      collectAssetKeys(document, found);
      for (const id of found.keys()) if (wanted.has(id)) referenced.add(id);
    }
    return referenced;
  },

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
            isNull(storefrontContentPublicationItems.deletedAt),
            or(
              // The handle this release was published under.
              sql`json_extract(${storefrontContentPublicationItems.metadata}, '$.handle') = ${data.handle}`,
              // Legacy items may use the immutable revision's route, never
              // the mutable Page handle or deletion flag.
              and(
                sql`json_extract(${storefrontContentPublicationItems.metadata}, '$.handle') IS NULL`,
                sql`json_extract(${storefrontPageRevisions.document}, '$.handle') = ${data.handle}`,
              ),
            ),
          ),
        )
        .limit(1),
    );
    return row?.document ?? null;
  },

  /**
   * Published document for one template type inside a ContentPublication.
   *
   * Scoped to the publication the active release points at, so a draft revision
   * can never reach the public runtime. Returns `null` when the release
   * publishes nothing for that template, which the caller treats as "no
   * authored content" rather than an error.
   */
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
