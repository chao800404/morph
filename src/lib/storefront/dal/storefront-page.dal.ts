import { getDb } from "@/db";
import {
  storefrontPageRevisions,
  storefrontPages,
  storefronts,
  type StorefrontPageDocument,
  type StorefrontPageStatus,
} from "@/db/storefront.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import { and, asc, count, desc, eq, isNull, like, max, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  toStorefrontPageDTO,
  toStorefrontPageRevisionDTO,
  toStorefrontPageSummaryDTO,
} from "../mapper/storefront-page.mapper";

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
      const pattern = containsPattern(options.query.trim());
      conditions.push(
        or(
          like(storefrontPages.title, pattern),
          like(storefrontPages.handle, pattern),
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
    const document: StorefrontPageDocument = { version: 1, sections: [] };
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
  }) {
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
    await db.batch([
      db.insert(storefrontPageRevisions).values({
        id: revisionId,
        pageId: data.id,
        version,
        document: data.document,
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
  async updateMetadata(
    id: string,
    storefrontId: string,
    metadata: Record<string, string>,
  ) {
    const db = await getDb();
    await db
      .update(storefrontPages)
      .set({ metadata, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(storefrontPages.id, id),
          eq(storefrontPages.storefrontId, storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      );
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
  }) {
    const db = await getDb();
    const [record] = await db
      .select({ id: storefrontPages.id })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.id, data.id),
          eq(storefrontPages.storefrontId, data.storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      )
      .limit(1);
    if (!record) return null;
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
    await db.batch([
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
          ),
        ),
    ]);
    return { version };
  },
};
