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
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { isStorefrontTemplateType } from "../dto/storefront-content-publication.dto";
import { normalizeDocumentRowIds } from "../editor/normalize-row-ids";

export type ThemeContentBuildPreconditions = {
  storefrontId: string;
  themeId: string;
  sourceRevisionId: string;
  templateId: string;
  expectedDraftRevisionId: string;
  expectedDraftGeneration: number;
  expectedSourceGeneration: number;
  expectedReleaseGeneration: number;
  createdBy?: string;
};

export type StorefrontContentPublicationDraft = StorefrontContentPublicationDTO;

const mapItem = (
  row: typeof storefrontContentPublicationItems.$inferSelect,
): StorefrontContentPublicationItemDTO => {
  if (row.itemType !== "template" && row.metadata?.templateType !== undefined)
    throw new Error(
      "CONTENT_PUBLICATION_INVALID: Template type on a non-template item.",
    );
  if (
    row.metadata?.templateType !== undefined &&
    !isStorefrontTemplateType(row.metadata.templateType)
  )
    throw new Error(
      "CONTENT_PUBLICATION_INVALID: Invalid frozen template type.",
    );
  const metadata = {
    ...(isStorefrontTemplateType(row.metadata?.templateType)
      ? { templateType: row.metadata.templateType }
      : {}),
    ...(typeof row.metadata?.handle === "string"
      ? { handle: row.metadata.handle }
      : {}),
    ...(typeof row.metadata?.routePath === "string"
      ? { routePath: row.metadata.routePath }
      : {}),
  };
  return {
    id: row.id,
    publicationId: row.publicationId,
    itemType: row.itemType,
    contentId: row.contentId,
    revisionId: row.revisionId,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
};

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
  /** Seal only build input, never activate a release or change published pointers.
   * Initial drafts must first use the existing explicit Document writer.
   */
  async sealForThemeBuild(
    data: ThemeContentBuildPreconditions,
  ): Promise<StorefrontContentPublicationDTO> {
    const db = await getDb();
    const [shell] = await db
      .select({
        id: storefrontThemeTemplates.id,
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        draftGeneration: storefrontThemeTemplates.draftGeneration,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, data.themeId),
          eq(storefrontThemeTemplates.type, "layout"),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);
    const pendingShell =
      shell?.draftRevisionId &&
      shell.draftRevisionId !== shell.publishedRevisionId
        ? shell
        : null;
    const publication = await this.resolveForTheme({
      ...data,
      templateRevisionId: data.expectedDraftRevisionId,
      alsoPublish: pendingShell
        ? [
            {
              templateId: pendingShell.id,
              revisionId: pendingShell.draftRevisionId!,
            },
          ]
        : undefined,
    });
    const documents = await this.readDocumentsForDraft({
      themeId: data.themeId,
      publication,
    });
    for (const { item, document } of documents) {
      if (
        item.itemType === "template" &&
        (item.contentId === data.templateId ||
          item.contentId === pendingShell?.id) &&
        JSON.stringify(
          normalizeDocumentRowIds(document, item.contentId).value,
        ) !== JSON.stringify(document)
      )
        throw new Error(
          "CONTENT_BUILD_DRAFT_NOT_NORMALIZED: Prepare the draft with the existing Document writer before sealing build content.",
        );
    }
    const guard = env.DATABASE.prepare(
      `SELECT CASE WHEN EXISTS (
      SELECT 1 FROM storefront_theme_templates t
      JOIN storefront_themes th ON th.id = t.theme_id
      JOIN storefronts s ON s.id = th.storefront_id
      JOIN storefront_theme_revisions r ON r.id = ?7 AND r.theme_id = th.id AND r.storefront_id = s.id
      WHERE s.id = ?1 AND th.id = ?2 AND t.id = ?3
      AND t.draft_revision_id = ?4 AND t.draft_generation = ?5
      AND th.source_generation = ?6 AND r.source_generation = ?6
      AND th.release_generation = ?8
      AND s.deleted_at IS NULL AND th.deleted_at IS NULL AND t.deleted_at IS NULL AND r.deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok`,
    ).bind(
      data.storefrontId,
      data.themeId,
      data.templateId,
      data.expectedDraftRevisionId,
      data.expectedDraftGeneration,
      data.expectedSourceGeneration,
      data.sourceRevisionId,
      data.expectedReleaseGeneration,
    );
    const guards = [guard];
    if (pendingShell)
      guards.push(
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
      SELECT 1 FROM storefront_theme_templates WHERE id = ?1 AND theme_id = ?2 AND draft_revision_id = ?3 AND draft_generation = ?4 AND deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok`,
        ).bind(
          pendingShell.id,
          data.themeId,
          pendingShell.draftRevisionId,
          pendingShell.draftGeneration,
        ),
      );
    try {
      await env.DATABASE.batch([
        ...guards,
        ...this.insertStatements(publication),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("malformed JSON"))
        throw new Error(
          "CONTENT_BUILD_PRECONDITION_FAILED: Source, draft or release changed before content was sealed.",
        );
      throw error;
    }
    return publication;
  },
  /**
   * Materializes the exact revision references selected for a publication.
   * Never substitute current draft/published pointers here. The caller must
   * still seal the draft with the existing publish CAS before trusting it as
   * immutable: a selected, unpublished revision can still be edited in place.
   */
  async readDocumentsForDraft(data: {
    themeId: string;
    publication: StorefrontContentPublicationDraft;
  }) {
    const db = await getDb();
    const [theme] = await db
      .select({ id: storefrontThemes.id })
      .from(storefrontThemes)
      .where(
        and(
          eq(storefrontThemes.id, data.themeId),
          eq(storefrontThemes.storefrontId, data.publication.storefrontId),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);
    if (!theme)
      throw new Error("CONTENT_PUBLICATION_INVALID: Theme ownership mismatch.");

    const documents = [];
    for (const item of data.publication.items) {
      if (
        item.itemType !== "template" &&
        item.metadata?.templateType !== undefined
      )
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Template type on a non-template item.",
        );
      if (item.publicationId !== data.publication.id) {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Item belongs to another publication.",
        );
      }
      let document: unknown;
      let isLayout = false;
      if (item.itemType === "template") {
        const [revision] = await db
          .select({
            document: sql<string>`cast(${storefrontThemeTemplateRevisions.document} as text)`,
            type: storefrontThemeTemplates.type,
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
              eq(storefrontThemeTemplateRevisions.id, item.revisionId),
              eq(storefrontThemeTemplateRevisions.templateId, item.contentId),
              eq(storefrontThemeTemplates.themeId, data.themeId),
              isNull(storefrontThemeTemplates.deletedAt),
            ),
          )
          .limit(1);
        document = revision?.document;
        // New snapshots carry their immutable role. Legacy scope validation
        // retains its old behavior, but does not enrich the snapshot from it.
        isLayout =
          item.metadata?.templateType !== undefined
            ? item.metadata.templateType === "layout"
            : revision?.type === "layout";
        if (
          item.metadata?.templateType !== undefined &&
          !isStorefrontTemplateType(item.metadata.templateType)
        )
          throw new Error(
            "CONTENT_PUBLICATION_INVALID: Invalid frozen template type.",
          );
      } else if (item.itemType === "page") {
        const [revision] = await db
          .select({
            document: sql<string>`cast(${storefrontPageRevisions.document} as text)`,
          })
          .from(storefrontPageRevisions)
          .innerJoin(
            storefrontPages,
            eq(storefrontPageRevisions.pageId, storefrontPages.id),
          )
          .where(
            and(
              eq(storefrontPageRevisions.id, item.revisionId),
              eq(storefrontPageRevisions.pageId, item.contentId),
              eq(storefrontPages.storefrontId, data.publication.storefrontId),
            ),
          )
          .limit(1);
        // Retained Page revisions remain valid after the mutable Page is deleted.
        document = revision?.document;
      } else {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Unsupported content reference.",
        );
      }
      if (typeof document === "string") {
        try {
          document = JSON.parse(document) as unknown;
        } catch {
          throw new Error(
            "CONTENT_PUBLICATION_INVALID: Malformed content snapshot.",
          );
        }
      }
      const parsed = storefrontPageDocumentSchema.safeParse(document);
      if (!parsed.success) {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Missing or malformed content snapshot.",
        );
      }
      if (
        (isLayout && parsed.data.renderPolicy !== undefined) ||
        (!isLayout && parsed.data.websiteRenderPolicy !== undefined)
      ) {
        throw new Error(
          "CONTENT_PUBLICATION_INVALID: Rendering policy scope mismatch.",
        );
      }
      documents.push({ item, document: parsed.data });
    }
    return documents;
  },

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
    /**
     * Templates published in the same act as the target.
     *
     * The shell is on every page, so a release that carried a page's new
     * content but the shell's old content would serve a header nobody chose.
     * It has no URL to be opened and published on its own, so it travels with
     * whatever page is being published.
     */
    alsoPublish?: ReadonlyArray<{ templateId: string; revisionId: string }>;
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
        routePath: storefrontThemeTemplates.routePath,
        type: storefrontThemeTemplates.type,
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

    const alsoPublish = new Map(
      (data.alsoPublish ?? []).map(
        (entry) => [entry.templateId, entry.revisionId] as const,
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
              : (alsoPublish.get(template.id) ?? template.revisionId),
          metadata: {
            templateType: template.type,
            ...(template.routePath ? { routePath: template.routePath } : {}),
          },
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
   * The documents a publish of `templateId` would put live, each with the name
   * an author knows it by.
   *
   * Mirrors how a publication is assembled: the template being published and
   * the shell (which travels with every publish) at their drafts, and every
   * other template and page at what is already published. Checked before the
   * publish is confirmed, so it answers about the release the author is about
   * to make rather than the one already out.
   */
  async listDocumentsForPublish(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
  }): Promise<{ label: string; document: unknown }[]> {
    const db = await getDb();
    const templates = await db
      .select({
        id: storefrontThemeTemplates.id,
        type: storefrontThemeTemplates.type,
        name: storefrontThemeTemplates.name,
        routePath: storefrontThemeTemplates.routePath,
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, data.themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      );
    const templateRevisions = new Map<string, string>();
    for (const template of templates) {
      const revisionId =
        template.id === data.templateId || template.type === "layout"
          ? template.draftRevisionId
          : template.publishedRevisionId;
      if (revisionId) {
        templateRevisions.set(revisionId, template.routePath ?? template.name);
      }
    }

    const [revisionRows, pages] = await Promise.all([
      templateRevisions.size > 0
        ? db
            .select({
              id: storefrontThemeTemplateRevisions.id,
              document: storefrontThemeTemplateRevisions.document,
            })
            .from(storefrontThemeTemplateRevisions)
            .where(
              inArray(storefrontThemeTemplateRevisions.id, [
                ...templateRevisions.keys(),
              ]),
            )
        : Promise.resolve([]),
      db
        .select({
          document: storefrontPageRevisions.document,
          handle: storefrontPages.handle,
        })
        .from(storefrontPages)
        .innerJoin(
          storefrontPageRevisions,
          eq(storefrontPageRevisions.id, storefrontPages.publishedRevisionId),
        )
        .where(
          and(
            eq(storefrontPages.storefrontId, data.storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        ),
    ]);
    return [
      ...revisionRows.map((row) => ({
        label: templateRevisions.get(row.id) ?? "",
        document: row.document as unknown,
      })),
      ...pages.map((row) => ({
        label: `/pages/${row.handle}`,
        document: row.document as unknown,
      })),
    ];
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
            // A route's own document is typed too, but it answers for one
            // path only. Returned here it would stand in for the whole type.
            or(
              and(
                sql`json_extract(${storefrontContentPublicationItems.metadata}, '$.templateType') = ${data.templateType}`,
                sql`json_extract(${storefrontContentPublicationItems.metadata}, '$.routePath') IS NULL`,
              ),
              and(
                sql`json_extract(${storefrontContentPublicationItems.metadata}, '$.templateType') IS NULL`,
                eq(storefrontThemeTemplates.type, data.templateType),
                isNull(storefrontThemeTemplates.routePath),
              ),
            ),
            isNull(storefrontContentPublicationItems.deletedAt),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        )
        .limit(1),
    );
    return row?.document ?? null;
  },

  /** The published document one static source route owns, by exact path. */
  async getPublishedRouteDocument(data: {
    publicationId: string;
    routePath: string;
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
            sql`(
              json_extract(${storefrontContentPublicationItems.metadata}, '$.routePath') = ${data.routePath}
              OR (
                json_extract(${storefrontContentPublicationItems.metadata}, '$.routePath') IS NULL
                AND json_extract(${storefrontContentPublicationItems.metadata}, '$.templateType') IS NULL
                AND ${storefrontThemeTemplates.routePath} = ${data.routePath}
              )
            )`,
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
