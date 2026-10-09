import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  storefrontPages,
  storefrontThemePreviewContentTickets,
  storefrontThemeTemplates,
} from "@/db/storefront.schema";

/**
 * Tickets that order the draft content snapshots written into one Live
 * Preview (storefront.schema.ts, `storefrontThemePreviewContentTickets`).
 */
export const storefrontPreviewContentTicketDal = {
  /**
   * The next ticket for `previewId`, taken in one statement so two callers
   * never share one. Take it before reading the drafts the snapshot is built
   * from: the order of tickets is then the order of what they saw.
   */
  async next(input: {
    previewId: string;
    storefrontId: string;
    themeId: string;
  }): Promise<number> {
    const db = await getDb();
    const now = new Date().toISOString();
    const [row] = await db
      .insert(storefrontThemePreviewContentTickets)
      .values({
        previewId: input.previewId,
        storefrontId: input.storefrontId,
        themeId: input.themeId,
        ticket: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: storefrontThemePreviewContentTickets.previewId,
        set: {
          ticket: sql`${storefrontThemePreviewContentTickets.ticket} + 1`,
          updatedAt: now,
        },
      })
      .returning({ ticket: storefrontThemePreviewContentTickets.ticket });
    if (!row || !Number.isSafeInteger(row.ticket) || row.ticket < 1) {
      throw new Error("PREVIEW_CONTENT_TICKET_UNAVAILABLE");
    }
    return row.ticket;
  },

  /**
   * Every draft a preview snapshot is built from, by the version it is now:
   * each template's draft generation and draft revision, each page's draft
   * revision. Every content write moves one of them (a template write
   * advances its generation; a page write points at a new revision). Read
   * before and after the snapshot's own reads, the two agree only when no
   * write landed between them (docs/astro-theme-plan.md 6.6).
   */
  async readDraftVersions(input: {
    storefrontId: string;
    themeId: string;
  }): Promise<string> {
    const db = await getDb();
    const [templates, pages] = await Promise.all([
      db
        .select({
          id: storefrontThemeTemplates.id,
          generation: storefrontThemeTemplates.draftGeneration,
          revision: storefrontThemeTemplates.draftRevisionId,
        })
        .from(storefrontThemeTemplates)
        .where(
          and(
            eq(storefrontThemeTemplates.themeId, input.themeId),
            isNull(storefrontThemeTemplates.deletedAt),
          ),
        )
        .orderBy(asc(storefrontThemeTemplates.id)),
      db
        .select({
          handle: storefrontPages.handle,
          revision: storefrontPages.draftRevisionId,
          updatedAt: storefrontPages.updatedAt,
        })
        .from(storefrontPages)
        .where(
          and(
            eq(storefrontPages.storefrontId, input.storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        )
        .orderBy(asc(storefrontPages.handle)),
    ]);
    return JSON.stringify({ templates, pages });
  },
};
