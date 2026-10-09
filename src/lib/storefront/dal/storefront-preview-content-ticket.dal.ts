import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storefrontThemePreviewContentTickets } from "@/db/storefront.schema";

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
};
