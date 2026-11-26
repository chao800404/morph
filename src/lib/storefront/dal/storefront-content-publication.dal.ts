import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import {
  storefrontContentPublicationItems,
  storefrontContentPublications,
  storefrontPages,
  storefrontPageRevisions,
  storefrontReleases,
  storefrontThemeTemplateRevisions,
  storefrontThemeTemplates,
  storefrontThemes,
  storefronts,
} from "@/db/storefront.schema";
import type {
  StorefrontPageDocument,
  StorefrontTemplateType,
} from "@/db/storefront.schema";
import type {
  StorefrontContentPublicationDTO,
  StorefrontContentPublicationItemDTO,
} from "@/lib/storefront/dto/storefront-content-publication.dto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { isStorefrontTemplateType } from "../dto/storefront-content-publication.dto";
import { normalizeDocumentRowIds } from "../editor/normalize-row-ids";
import { DEPLOYED_THEME_BUILD_METADATA_KEY } from "../service/theme-worker-deployment-state";

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
  visitAssetKeys(parseStoredDocument(document), into);
}

/** A stored document as an object, whether the driver parsed it or not. */
function parseStoredDocument(document: unknown): unknown {
  if (typeof document !== "string") return document;
  try {
    return JSON.parse(document);
  } catch {
    return null;
  }
}

/** Ids of the sections a document hides (`enabled: false`). */
function hiddenSectionIds(document: unknown): Set<string> {
  const ids = new Set<string>();
  const sections = (document as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return ids;
  for (const section of sections) {
    const record = section as { id?: unknown; enabled?: unknown } | null;
    if (record?.enabled === false && typeof record.id === "string")
      ids.add(record.id);
  }
  return ids;
}

/**
 * Collects the media references a visitor can be shown: those inside a
 * section that renders.
 *
 * A hidden section (`enabled: false`) is gone from the published site, and
 * so is everything in it, at any depth. Its values stay in the stored
 * document (Show again and rollback restore them), which is why the walk
 * filters here rather than the document being rewritten. `alsoHidden` is the
 * shared layout's hidden ids: layout and route share one slot namespace and
 * the runtime lets a hidden flag in either win (`resolveStorefrontContent`),
 * and the layout is on every route.
 *
 * Only `sections` is walked. The runtime renders nothing else of a document,
 * so a reference anywhere else is not one a visitor can reach, and is left
 * out rather than assumed to be safe.
 */
function collectRenderedAssetKeys(
  document: unknown,
  into: Map<string, Set<string>>,
  alsoHidden: ReadonlySet<string>,
): void {
  const parsed = parseStoredDocument(document) as { sections?: unknown } | null;
  const sections = parsed?.sections;
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    const record = section as { id?: unknown; enabled?: unknown } | null;
    if (!record || typeof record !== "object") continue;
    if (record.enabled === false) continue;
    if (typeof record.id === "string" && alsoHidden.has(record.id)) continue;
    visitAssetKeys(record, into);
  }
}

function visitAssetKeys(root: unknown, into: Map<string, Set<string>>): void {
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

  visit(root);
}

type CarriedItemType = "template" | "page";

/**
 * The revision each item a publish does not ship goes into the new release at.
 *
 * A template's or Page's `published_revision_id` records the revision its own
 * last publish chose. It is not what visitors see: that is the active
 * release's publication. The two part when a rollback moves the live pointer
 * back, which it does without touching any row. Reading the rows for every
 * item a publish carries over then put back each page's rolled-away content
 * the moment any one page was published.
 *
 * So an item starts from what the active release pins. A row revision the
 * active release does not serve still wins when no deployed release ever
 * served it: that is a publish waiting for its first release (a Page published
 * from the Dashboard goes live with the next Theme publish), or a revision a
 * manifest migration rewrote in place of the published one. A row revision
 * that a deployed release served and the active one does not is one a
 * rollback took off the storefront, and stays off.
 *
 * "Deployed" is the release's own deployment record, written only after its
 * artifact reached the Worker: a publish whose deploy failed is restored, and
 * the content it sealed never went live, so it was not rolled away either.
 *
 * With no active release of this Theme there is nothing to start from, and
 * the rows are what an initial publish has always carried.
 *
 * Returns `type:contentId` to revision id; an absent key is not carried.
 */
export async function resolveCarriedRevisions(data: {
  storefrontId: string;
  themeId: string;
  items: ReadonlyArray<{
    itemType: CarriedItemType;
    contentId: string;
    rowRevisionId: string | null;
  }>;
}): Promise<Map<string, string>> {
  const db = await getDb();
  const keyOf = (itemType: CarriedItemType, contentId: string) =>
    `${itemType}:${contentId}`;
  const carried = new Map<string, string>();

  const [live] = await db
    .select({ publicationId: storefrontReleases.contentPublicationId })
    .from(storefronts)
    .innerJoin(
      storefrontReleases,
      eq(storefrontReleases.id, storefronts.activeReleaseId),
    )
    .where(
      and(
        eq(storefronts.id, data.storefrontId),
        eq(storefrontReleases.storefrontId, data.storefrontId),
        eq(storefrontReleases.themeId, data.themeId),
        isNull(storefronts.deletedAt),
        isNull(storefrontReleases.deletedAt),
      ),
    )
    .limit(1);
  if (!live?.publicationId) {
    for (const item of data.items)
      if (item.rowRevisionId)
        carried.set(keyOf(item.itemType, item.contentId), item.rowRevisionId);
    return carried;
  }

  const pinned = new Map(
    (
      await db
        .select({
          itemType: storefrontContentPublicationItems.itemType,
          contentId: storefrontContentPublicationItems.contentId,
          revisionId: storefrontContentPublicationItems.revisionId,
        })
        .from(storefrontContentPublicationItems)
        .where(
          and(
            eq(
              storefrontContentPublicationItems.publicationId,
              live.publicationId,
            ),
            isNull(storefrontContentPublicationItems.deletedAt),
          ),
        )
    ).map((item) => [
      keyOf(item.itemType as CarriedItemType, item.contentId),
      item.revisionId,
    ]),
  );

  // Only rows that disagree with the live release need their history read;
  // without a rollback (or a pending publish) there are none.
  const disagreeing = data.items.filter(
    (item): item is typeof item & { rowRevisionId: string } =>
      item.rowRevisionId !== null &&
      pinned.get(keyOf(item.itemType, item.contentId)) !== item.rowRevisionId,
  );
  const servedBefore = new Set<string>();
  // D1 caps bound parameters per statement.
  for (let start = 0; start < disagreeing.length; start += 50) {
    const chunk = disagreeing.slice(start, start + 50);
    const rows = await db
      .select({
        itemType: storefrontContentPublicationItems.itemType,
        contentId: storefrontContentPublicationItems.contentId,
        revisionId: storefrontContentPublicationItems.revisionId,
      })
      .from(storefrontContentPublicationItems)
      .innerJoin(
        storefrontReleases,
        eq(
          storefrontReleases.contentPublicationId,
          storefrontContentPublicationItems.publicationId,
        ),
      )
      .where(
        and(
          eq(storefrontReleases.storefrontId, data.storefrontId),
          sql`json_extract(${storefrontReleases.metadata}, ${`$.${DEPLOYED_THEME_BUILD_METADATA_KEY}`}) IS NOT NULL`,
          inArray(
            storefrontContentPublicationItems.revisionId,
            chunk.map((item) => item.rowRevisionId),
          ),
          isNull(storefrontContentPublicationItems.deletedAt),
        ),
      );
    for (const row of rows)
      servedBefore.add(
        `${keyOf(row.itemType as CarriedItemType, row.contentId)}:${row.revisionId}`,
      );
  }

  for (const item of data.items) {
    const key = keyOf(item.itemType, item.contentId);
    const pin = pinned.get(key);
    const rolledAway =
      item.rowRevisionId !== null &&
      servedBefore.has(`${key}:${item.rowRevisionId}`);
    const revisionId =
      item.rowRevisionId && !rolledAway ? item.rowRevisionId : pin;
    if (revisionId) carried.set(key, revisionId);
  }
  return carried;
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

    const templateRows = await db
      .select({
        id: storefrontThemeTemplates.id,
        rowRevisionId: storefrontThemeTemplates.publishedRevisionId,
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
    const pageRows = await db
      .select({
        id: storefrontPages.id,
        rowRevisionId: storefrontPages.publishedRevisionId,
        handle: storefrontPages.handle,
        draftRevisionId: storefrontPages.draftRevisionId,
      })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.storefrontId, data.storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      );

    // The target template is replaced with the revision being published (and
    // a pending shell with its draft); all other templates/pages remain
    // exactly as they are in the active release (`resolveCarriedRevisions`).
    const carried = await resolveCarriedRevisions({
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      items: [
        ...templateRows.map((row) => ({
          itemType: "template" as const,
          contentId: row.id,
          rowRevisionId: row.rowRevisionId,
        })),
        ...pageRows.map((row) => ({
          itemType: "page" as const,
          contentId: row.id,
          rowRevisionId: row.rowRevisionId,
        })),
      ],
    });
    const publishedTemplates = templateRows.map((row) => ({
      ...row,
      revisionId: carried.get(`template:${row.id}`) ?? null,
    }));

    const pageRevisionIds = pageRows.flatMap((page) => {
      const revisionId = carried.get(`page:${page.id}`);
      return revisionId ? [revisionId] : [];
    });
    const pageRevisions = new Map<
      string,
      { pageId: string; document: StorefrontPageDocument }
    >();
    // D1 caps bound parameters per statement.
    for (let start = 0; start < pageRevisionIds.length; start += 50) {
      for (const revision of await db
        .select({
          id: storefrontPageRevisions.id,
          pageId: storefrontPageRevisions.pageId,
          document: storefrontPageRevisions.document,
        })
        .from(storefrontPageRevisions)
        .where(
          inArray(
            storefrontPageRevisions.id,
            pageRevisionIds.slice(start, start + 50),
          ),
        ))
        pageRevisions.set(revision.id, revision);
    }
    // A Page whose revision is gone is left out, as the join used to.
    const publishedPages = pageRows.flatMap((page) => {
      const revisionId = carried.get(`page:${page.id}`);
      const revision = revisionId ? pageRevisions.get(revisionId) : undefined;
      return revisionId && revision?.pageId === page.id
        ? [{ ...page, revisionId, document: revision.document }]
        : [];
    });

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
   * a pending shell (which travels with every publish) at their drafts, and
   * every other template and page as `resolveForTheme` carries them. Checked
   * before the publish is confirmed, so it answers about the release the
   * author is about to make rather than the one already out.
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
    const pageRows = await db
      .select({
        id: storefrontPages.id,
        handle: storefrontPages.handle,
        publishedRevisionId: storefrontPages.publishedRevisionId,
      })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.storefrontId, data.storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      );
    const carried = await resolveCarriedRevisions({
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      items: [
        ...templates.map((template) => ({
          itemType: "template" as const,
          contentId: template.id,
          rowRevisionId: template.publishedRevisionId,
        })),
        ...pageRows.map((page) => ({
          itemType: "page" as const,
          contentId: page.id,
          rowRevisionId: page.publishedRevisionId,
        })),
      ],
    });

    const templateRevisions = new Map<string, string>();
    for (const template of templates) {
      // The same pending-shell test `publishTemplate` applies.
      const shipsDraft =
        template.id === data.templateId ||
        (template.type === "layout" &&
          Boolean(template.draftRevisionId) &&
          template.draftRevisionId !== template.publishedRevisionId);
      const revisionId = shipsDraft
        ? template.draftRevisionId
        : carried.get(`template:${template.id}`);
      if (revisionId) {
        templateRevisions.set(revisionId, template.routePath ?? template.name);
      }
    }
    const pageRevisions = new Map<string, string>();
    for (const page of pageRows) {
      const revisionId = carried.get(`page:${page.id}`);
      if (revisionId) pageRevisions.set(revisionId, page.handle);
    }

    const readChunked = async <T>(
      ids: string[],
      read: (chunk: string[]) => Promise<T[]>,
    ): Promise<T[]> => {
      const rows: T[] = [];
      // D1 caps bound parameters per statement.
      for (let start = 0; start < ids.length; start += 50)
        rows.push(...(await read(ids.slice(start, start + 50))));
      return rows;
    };
    const [revisionRows, pages] = await Promise.all([
      readChunked([...templateRevisions.keys()], (chunk) =>
        db
          .select({
            id: storefrontThemeTemplateRevisions.id,
            document: storefrontThemeTemplateRevisions.document,
          })
          .from(storefrontThemeTemplateRevisions)
          .where(inArray(storefrontThemeTemplateRevisions.id, chunk)),
      ),
      readChunked([...pageRevisions.keys()], (chunk) =>
        db
          .select({
            id: storefrontPageRevisions.id,
            document: storefrontPageRevisions.document,
          })
          .from(storefrontPageRevisions)
          .where(inArray(storefrontPageRevisions.id, chunk)),
      ),
    ]);
    return [
      ...revisionRows.map((row) => ({
        label: templateRevisions.get(row.id) ?? "",
        document: row.document as unknown,
      })),
      ...pages.map((row) => ({
        label: `/pages/${pageRevisions.get(row.id) ?? ""}`,
        document: row.document as unknown,
      })),
    ];
  },

  /**
   * Asset id to the storage key it had when this publication was made.
   *
   * The key is both the authorisation and the bytes: a visitor may read exactly
   * what the live release published, at the version it published.
   *
   * Only media a visitor can be shown counts: a reference inside a hidden
   * section, or inside a section whose slot the shared layout hides, is left
   * out (`collectRenderedAssetKeys`). Computed from the publication's stored
   * documents on every read and keyed by the publication the live release
   * names, so a rollback authorises by the restored release's own content,
   * and publications sealed before this rule follow it too, with no stored
   * list to migrate. The stored documents are not changed.
   */
  async listPublishedAssetKeys(
    publicationId: string,
  ): Promise<Map<string, Set<string>>> {
    const [documents, layout] = await Promise.all([
      this.listPublishedDocuments(publicationId),
      // The same layout resolution the public runtime renders with.
      this.getPublishedTemplateDocument({
        publicationId,
        templateType: "layout",
      }),
    ]);
    const layoutHidden = hiddenSectionIds(parseStoredDocument(layout));
    const keys = new Map<string, Set<string>>();
    for (const document of documents) {
      collectRenderedAssetKeys(document, keys, layoutHidden);
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
   *
   * Hidden sections count here, unlike in `listPublishedAssetKeys`: their
   * values are kept so Show again and a rollback can bring them back, and
   * that needs the bytes.
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
