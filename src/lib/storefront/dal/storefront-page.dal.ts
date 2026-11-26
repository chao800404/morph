import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefrontPageRevisions,
  storefrontPages,
  storefronts,
  type StorefrontPageDocument,
  type StorefrontPageStatus,
} from "@/db/storefront.schema";
import { likeContains } from "@/lib/db/like-query";
import { and, asc, count, desc, eq, isNull, max, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  toStorefrontPageDTO,
  toStorefrontPageRevisionDTO,
  toStorefrontPageSummaryDTO,
} from "../mapper/storefront-page.mapper";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import {
  PAGE_SECTION_HIDE_UNSUPPORTED_MESSAGE,
  sectionHideRefusal,
  sectionsNewlyHidden,
} from "../content/section-hide-check";
import { showSectionAgainInDocument } from "../content/show-section-again";
import { PAGE_DRAFT_VERSION_MISMATCH } from "../page-write-errors";
import { batchGuard } from "@/lib/db/batch-guard";
import type { BatchItem } from "drizzle-orm/batch";

type Db = Awaited<ReturnType<typeof getDb>>;

const pageDraftConflict = () =>
  new Error(`${PAGE_DRAFT_VERSION_MISMATCH}: Page draft was modified concurrently.`);

/**
 * The first statement of every Page draft write's batch: the page is this
 * storefront's, not deleted, and its draft is still the revision `version`
 * the caller read. Versions are unique per page, so this pins the draft
 * pointer exactly; a batch is one transaction, so a failed guard writes
 * nothing (`batchGuard`).
 */
function pageDraftGuard(
  db: Db,
  args: { id: string; storefrontId: string; expectedDraftVersion: number },
) {
  return batchGuard(
    db,
    sql`EXISTS ${db
      .select({ one: sql`1` })
      .from(storefrontPages)
      .innerJoin(
        storefrontPageRevisions,
        and(
          eq(storefrontPageRevisions.id, storefrontPages.draftRevisionId),
          eq(storefrontPageRevisions.pageId, storefrontPages.id),
        ),
      )
      .where(
        and(
          eq(storefrontPages.id, args.id),
          eq(storefrontPages.storefrontId, args.storefrontId),
          isNull(storefrontPages.deletedAt),
          eq(storefrontPageRevisions.version, args.expectedDraftVersion),
        ),
      )}`,
  );
}

/**
 * Only the failures a Page draft write owns are a conflict: its guard
 * (`json('')`, "malformed JSON") and the (page, version) unique index two
 * writers allocating the same next version meet. Any other failure — another
 * constraint included — stays the failure it is.
 */
function isPageDraftBatchConflict(error: unknown): boolean {
  const messages: string[] = [];
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 4;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    messages.push(current.message);
  }
  return messages.some(
    (message) =>
      message.includes("malformed JSON") ||
      message.includes(
        "UNIQUE constraint failed: storefront_page_revisions.page_id, storefront_page_revisions.version",
      ),
  );
}

async function runPageDraftBatch(
  db: Db,
  statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
) {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isPageDraftBatchConflict(error)) throw pageDraftConflict();
    throw error;
  }
}

const activeStorefront = async () => {
  const db = await getDb();
  const [row] = await db
    .select({ id: storefronts.id })
    .from(storefronts)
    .where(isNull(storefronts.deletedAt))
    .orderBy(asc(storefronts.createdAt))
    .limit(1);
  return row ?? null;
};

export const storefrontPageDal = {
  activeStorefront,
  async listDraftDocuments(storefrontId: string) {
    const db = await getDb();
    const rows = await db
      .select({
        handle: storefrontPages.handle,
        document: storefrontPageRevisions.document,
      })
      .from(storefrontPages)
      .innerJoin(
        storefrontPageRevisions,
        and(
          eq(storefrontPageRevisions.id, storefrontPages.draftRevisionId),
          eq(storefrontPageRevisions.pageId, storefrontPages.id),
        ),
      )
      .where(
        and(
          eq(storefrontPages.storefrontId, storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      )
      .orderBy(asc(storefrontPages.handle));

    return rows.map((row) => ({
      handle: row.handle,
      document: storefrontPageDocumentSchema.parse(row.document),
    }));
  },
  async listPage(options: {
    query?: string | null;
    sortBy: "title" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const storefront = await activeStorefront();
    if (!storefront) return { pages: [], total: 0 };
    const db = await getDb();
    const conditions: SQL[] = [
      eq(storefrontPages.storefrontId, storefront.id),
      isNull(storefrontPages.deletedAt),
    ];
    if (options.query?.trim()) {
      const term = options.query.trim();
      conditions.push(
        or(
          likeContains(storefrontPages.title, term),
          likeContains(storefrontPages.handle, term),
        )!,
      );
    }
    const condition = and(...conditions);
    const column = {
      title: storefrontPages.title,
      createdAt: storefrontPages.createdAt,
      updatedAt: storefrontPages.updatedAt,
    }[options.sortBy];
    const [counts, rows] = await Promise.all([
      db.select({ value: count() }).from(storefrontPages).where(condition),
      db
        .select()
        .from(storefrontPages)
        .where(condition)
        .orderBy(options.sortOrder === "asc" ? asc(column) : desc(column))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    return {
      pages: rows.map(toStorefrontPageSummaryDTO),
      total: Number(counts[0]?.value ?? 0),
    };
  },
  async handleExists(storefrontId: string, handle: string, excludeId?: string) {
    const db = await getDb();
    const conditions = [
      eq(storefrontPages.storefrontId, storefrontId),
      eq(storefrontPages.handle, handle),
      isNull(storefrontPages.deletedAt),
    ];
    const rows = await db
      .select({ id: storefrontPages.id })
      .from(storefrontPages)
      .where(and(...conditions))
      .limit(1);
    return Boolean(rows[0] && rows[0].id !== excludeId);
  },
  async findDetail(id: string, storefrontId: string) {
    const db = await getDb();
    const [page] = await db
      .select()
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.id, id),
          eq(storefrontPages.storefrontId, storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      )
      .limit(1);
    if (!page?.draftRevisionId) return null;
    const [revision] = await db
      .select()
      .from(storefrontPageRevisions)
      .where(eq(storefrontPageRevisions.id, page.draftRevisionId))
      .limit(1);
    return revision ? toStorefrontPageDTO(page, revision) : null;
  },
  async create(data: {
    id: string;
    storefrontId: string;
    title: string;
    handle: string;
    publish: boolean;
    createdBy: string;
  }) {
    const db = await getDb();
    const revisionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const document: StorefrontPageDocument = {
      version: 1,
      handle: data.handle,
      sections: [],
    };
    await db.batch([
      db.insert(storefrontPages).values({
        id: data.id,
        storefrontId: data.storefrontId,
        title: data.title,
        handle: data.handle,
        status: data.publish ? "published" : "draft",
        draftRevisionId: revisionId,
        publishedRevisionId: data.publish ? revisionId : null,
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(storefrontPageRevisions).values({
        id: revisionId,
        pageId: data.id,
        version: 1,
        document,
        createdBy: data.createdBy,
        createdAt: now,
        publishedAt: data.publish ? now : null,
      }),
    ]);
  },
  async update(data: {
    id: string;
    title: string;
    handle: string;
    document: StorefrontPageDocument;
    publish: boolean;
    hasPublishedVersion: boolean;
    createdBy: string;
    storefrontId: string;
    expectedDraftVersion: number;
  }) {
    // M3 Hide: a Page section is not hidden until Morph can prove where its
    // route renders it (`section-hide-check.ts`). Judged against the draft
    // this write replaces; showing a section is always allowed. Restoring a
    // revision does not come through here and is never refused.
    //
    // The draft judged is the one the caller read (`expectedDraftVersion`),
    // and the batch below refuses the write unless it is still the draft, so
    // the verdict belongs to the revision this save replaces: a Show again
    // or another tab's save in between makes this a conflict, never a write
    // of a document judged against a draft that is gone.
    const current = await storefrontPageDal.findDetail(
      data.id,
      data.storefrontId,
    );
    if (!current || current.version !== data.expectedDraftVersion) {
      throw pageDraftConflict();
    }
    if (sectionsNewlyHidden(current.document, data.document).length) {
      throw sectionHideRefusal(
        "no-call-site",
        PAGE_SECTION_HIDE_UNSUPPORTED_MESSAGE,
      );
    }
    const db = await getDb();
    const [versionRow] = await db
      .select({ value: max(storefrontPageRevisions.version) })
      .from(storefrontPageRevisions)
      .where(eq(storefrontPageRevisions.pageId, data.id));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date().toISOString();
    const status: StorefrontPageStatus =
      data.publish || data.hasPublishedVersion ? "published" : "draft";
    await runPageDraftBatch(db, [
      pageDraftGuard(db, data),
      db.insert(storefrontPageRevisions).values({
        id: revisionId,
        pageId: data.id,
        version,
        document: { ...data.document, handle: data.handle },
        createdBy: data.createdBy,
        createdAt: now,
        publishedAt: data.publish ? now : null,
      }),
      db
        .update(storefrontPages)
        .set({
          title: data.title,
          handle: data.handle,
          status,
          draftRevisionId: revisionId,
          publishedRevisionId: data.publish ? revisionId : undefined,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontPages.id, data.id),
            eq(storefrontPages.storefrontId, data.storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        ),
    ]);
    return version;
  },
  /**
   * The metadata lives on the page row, not in a revision, but is written
   * under the same draft guard as every other Page write: the form that
   * sends it was loaded with that draft, and a Page changed elsewhere is
   * reloaded before anything of it is saved. Null when the page is gone.
   */
  async updateMetadata(
    id: string,
    storefrontId: string,
    metadata: Record<string, string>,
    expectedDraftVersion: number,
  ) {
    const current = await storefrontPageDal.findDetail(id, storefrontId);
    if (!current) return null;
    if (current.version !== expectedDraftVersion) throw pageDraftConflict();
    const db = await getDb();
    await runPageDraftBatch(db, [
      pageDraftGuard(db, { id, storefrontId, expectedDraftVersion }),
      db
        .update(storefrontPages)
        .set({ metadata, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(storefrontPages.id, id),
            eq(storefrontPages.storefrontId, storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        ),
    ]);
    return { id };
  },
  async listRevisions(
    id: string,
    storefrontId: string,
    page: number,
    limit: number,
  ) {
    const db = await getDb();
    const [record] = await db
      .select({
        id: storefrontPages.id,
        draftRevisionId: storefrontPages.draftRevisionId,
        publishedRevisionId: storefrontPages.publishedRevisionId,
      })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.id, id),
          eq(storefrontPages.storefrontId, storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      )
      .limit(1);
    if (!record) return null;
    const condition = eq(storefrontPageRevisions.pageId, id);
    const [counts, revisions] = await Promise.all([
      db
        .select({ value: count() })
        .from(storefrontPageRevisions)
        .where(condition),
      db
        .select()
        .from(storefrontPageRevisions)
        .where(condition)
        .orderBy(desc(storefrontPageRevisions.version))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);
    return {
      revisions: revisions.map((revision) =>
        toStorefrontPageRevisionDTO(revision, record),
      ),
      total: Number(counts[0]?.value ?? 0),
    };
  },
  async restoreRevision(data: {
    id: string;
    revisionId: string;
    storefrontId: string;
    createdBy: string;
    expectedDraftVersion: number;
  }) {
    const current = await storefrontPageDal.findDetail(
      data.id,
      data.storefrontId,
    );
    if (!current) return null;
    if (current.version !== data.expectedDraftVersion) {
      throw pageDraftConflict();
    }
    const db = await getDb();
    const [source] = await db
      .select()
      .from(storefrontPageRevisions)
      .where(
        and(
          eq(storefrontPageRevisions.id, data.revisionId),
          eq(storefrontPageRevisions.pageId, data.id),
        ),
      )
      .limit(1);
    if (!source) return null;
    const [versionRow] = await db
      .select({ value: max(storefrontPageRevisions.version) })
      .from(storefrontPageRevisions)
      .where(eq(storefrontPageRevisions.pageId, data.id));
    const revisionId = crypto.randomUUID();
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date().toISOString();
    await runPageDraftBatch(db, [
      pageDraftGuard(db, data),
      db.insert(storefrontPageRevisions).values({
        id: revisionId,
        pageId: data.id,
        version,
        document: source.document,
        createdBy: data.createdBy,
        createdAt: now,
        publishedAt: null,
      }),
      db
        .update(storefrontPages)
        .set({ draftRevisionId: revisionId, updatedAt: now })
        .where(
          and(
            eq(storefrontPages.id, data.id),
            eq(storefrontPages.storefrontId, data.storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        ),
    ]);
    return { version };
  },
  /**
   * "Show again" (M3 stage 1): one hidden section of the Page's draft back to
   * shown, and nothing else (`showSectionAgainInDocument`).
   *
   * Like every Page draft write, this compares the draft the caller saw:
   * its revision `version` must still be the draft's, both when read here
   * and again inside the write's batch, where a compare-and-set over the
   * draft revision id refuses a save that landed in between. The unique
   * (page, version) index refuses a concurrent insert of the same version.
   * Either way the batch writes nothing and the caller gets the Page draft
   * conflict (`PAGE_DRAFT_VERSION_MISMATCH`).
   *
   * Writes a new draft revision, as every Page draft save does; the
   * published revision, status, title and handle stay. Never publishes.
   *
   * Null when the page is not this storefront's or is deleted. A section
   * not held exactly once, or one already shown, writes nothing; the latter
   * answers the draft's version so a retried call reads as done.
   */
  async showSectionAgain(data: {
    id: string;
    storefrontId: string;
    sectionId: string;
    expectedDraftVersion: number;
    createdBy: string;
  }): Promise<
    | null
    | Readonly<{ kind: "section-not-found"; reason: "missing" | "ambiguous" }>
    | Readonly<{ kind: "unchanged" | "shown"; version: number }>
  > {
    const draft = await env.DATABASE.prepare(
      `SELECT r.id AS revisionId, r.version AS version, r.document AS document
         FROM storefront_pages p
         INNER JOIN storefronts s ON s.id = p.storefront_id
         INNER JOIN storefront_page_revisions r
           ON r.id = p.draft_revision_id AND r.page_id = p.id
        WHERE p.id = ?1 AND p.storefront_id = ?2
          AND p.deleted_at IS NULL AND s.deleted_at IS NULL
        LIMIT 1`,
    )
      .bind(data.id, data.storefrontId)
      .first<{ revisionId: string; version: number; document: string }>();
    if (!draft) return null;

    const outcome = showSectionAgainInDocument(draft.document, data.sectionId);
    if (outcome.kind === "not-found") {
      return { kind: "section-not-found", reason: outcome.reason };
    }
    if (outcome.kind === "already-shown") {
      return { kind: "unchanged", version: draft.version };
    }
    if (draft.version !== data.expectedDraftVersion) throw pageDraftConflict();

    const next = await env.DATABASE.prepare(
      "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM storefront_page_revisions WHERE page_id = ?1",
    )
      .bind(data.id)
      .first<{ version: number }>();
    const version = Number(next?.version ?? draft.version + 1);
    const revisionId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        // The compare-and-set: the draft is still the revision read above.
        env.DATABASE.prepare(
          `SELECT CASE WHEN EXISTS (
             SELECT 1 FROM storefront_pages p
             INNER JOIN storefronts s ON s.id = p.storefront_id
             WHERE p.id = ?1 AND p.storefront_id = ?2
               AND p.draft_revision_id = ?3
               AND p.deleted_at IS NULL AND s.deleted_at IS NULL
           ) THEN 1 ELSE json('') END AS ok`,
        ).bind(data.id, data.storefrontId, draft.revisionId),
        env.DATABASE.prepare(
          `INSERT INTO storefront_page_revisions
             (id, page_id, version, document, created_by, created_at, published_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
        ).bind(
          revisionId,
          data.id,
          version,
          JSON.stringify(outcome.document),
          data.createdBy,
          now,
        ),
        env.DATABASE.prepare(
          `UPDATE storefront_pages
              SET draft_revision_id = ?1, updated_at = ?2
            WHERE id = ?3 AND storefront_id = ?4
              AND draft_revision_id = ?5 AND deleted_at IS NULL`,
        ).bind(revisionId, now, data.id, data.storefrontId, draft.revisionId),
      ]);
    } catch (error) {
      if (isPageDraftBatchConflict(error)) throw pageDraftConflict();
      throw error;
    }
    return { kind: "shown", version };
  },
};
