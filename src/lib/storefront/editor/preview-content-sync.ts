/**
 * Carries saved draft content into a Live Preview that reads its content on
 * the server (docs/astro-theme-plan.md 6.5–6.7, "A6b-2").
 *
 * The client-only preview renders from the snapshot inside the page, which the
 * editor updates as the author types. A preview served by Start's own server,
 * or by a framework's dev server (Astro), reads the snapshot the server holds,
 * and that one changes only when `syncThemePreviewContent` writes it. So once
 * a content write is saved, the drafts are synced; the canvas is refreshed
 * only after the preview confirms it reads them, never before and never on a
 * refusal.
 *
 * - One sync at a time per tab. A save landing while one runs asks for one
 *   more afterwards, and any number of them collapse into that one: its
 *   ticket is taken after they were all saved (6.5), so it carries them all.
 * - Only the newest confirmed ticket refreshes, once. A confirmation older
 *   than one already shown is ignored, and none is shown while a newer sync
 *   is still to come.
 * - Nothing is sent again on its own. A refused or unanswered sync loses
 *   nothing — the drafts are saved — and the next save syncs again. A sync
 *   that was written but not yet read is asked about once
 *   (`confirmThemePreviewContent`), which writes nothing.
 * - A refresh waits while an edit is open on the canvas: reloading the
 *   content under it would end it (see `syncPreviewRoute` in the shell).
 */

/**
 * A sync's or a confirmation's answer, as the server function gave it.
 *
 * `ticket` on a refusal is the one the preview holds or reads; `sentTicket`
 * is the one this sync was written under, which is what a later confirmation
 * asks about.
 */
export type PreviewContentSyncAnswer =
  | Readonly<{ success: true; data: Readonly<{ ticket: number }> }>
  | Readonly<{
      success: false;
      error?: string;
      ticket?: number;
      sentTicket?: number;
    }>;

/** Why the canvas may not show the latest saved content. */
export type PreviewContentBehindReason =
  /** The server refused the sync or could not confirm it. */
  | Readonly<{ kind: "refused"; error: string }>
  /** No answer came back; whether it was written is not known. */
  | Readonly<{ kind: "unanswered" }>;

/** Refusals worth one confirmation: the preview may read this content yet. */
const CONFIRMABLE_REFUSALS: ReadonlySet<string> = new Set([
  // Written; its Worker had not read it by the deadline.
  "PREVIEW_CONTENT_NOT_CONFIRMED",
  // A newer snapshot is held, taken after this save, so it includes it.
  "PREVIEW_CONTENT_SUPERSEDED",
]);

export type PreviewContentSyncDeps = Readonly<{
  sync: () => Promise<PreviewContentSyncAnswer>;
  confirm: (ticket: number) => Promise<PreviewContentSyncAnswer>;
  /** Show the content the preview confirmed it reads. */
  refresh: (ticket: number) => void;
  /** False while an edit is open on the canvas. */
  canRefresh: () => boolean;
  /** A non-blocking notice; the author's work is never interrupted. */
  onBehind: (reason: PreviewContentBehindReason) => void;
}>;

export type PreviewContentSync = Readonly<{
  /** A content write was saved. */
  requestSync(): void;
  /** An edit that held a refresh back has ended. */
  editEnded(): void;
  /** Answers arriving after this change nothing. */
  dispose(): void;
}>;

export function createPreviewContentSync(
  deps: PreviewContentSyncDeps,
): PreviewContentSync {
  let running = false;
  let queued = false;
  let disposed = false;
  /** The highest ticket the preview confirmed it reads. */
  let confirmed = 0;
  /** The highest ticket the canvas was refreshed for. */
  let refreshed = 0;

  const noteConfirmed = (ticket: number) => {
    if (ticket > confirmed) confirmed = ticket;
  };

  const refreshIfDue = () => {
    if (disposed || running || queued) return;
    if (confirmed <= refreshed || !deps.canRefresh()) return;
    refreshed = confirmed;
    deps.refresh(confirmed);
  };

  const syncOnce = async () => {
    let answer: PreviewContentSyncAnswer;
    try {
      answer = await deps.sync();
    } catch {
      if (!disposed) deps.onBehind({ kind: "unanswered" });
      return;
    }
    if (disposed) return;
    if (answer.success) {
      noteConfirmed(answer.data.ticket);
      return;
    }
    const error = answer.error ?? "PREVIEW_CONTENT_SYNC_FAILED";
    const sentTicket = answer.sentTicket;
    if (CONFIRMABLE_REFUSALS.has(error) && sentTicket !== undefined) {
      let confirmation: PreviewContentSyncAnswer;
      try {
        confirmation = await deps.confirm(sentTicket);
      } catch {
        if (!disposed) deps.onBehind({ kind: "unanswered" });
        return;
      }
      if (disposed) return;
      if (confirmation.success) {
        noteConfirmed(confirmation.data.ticket);
        return;
      }
      deps.onBehind({
        kind: "refused",
        error: confirmation.error ?? error,
      });
      return;
    }
    deps.onBehind({ kind: "refused", error });
  };

  const run = async () => {
    running = true;
    try {
      do {
        queued = false;
        await syncOnce();
      } while (queued && !disposed);
    } finally {
      running = false;
    }
    refreshIfDue();
  };

  return {
    requestSync() {
      if (disposed) return;
      if (running) {
        queued = true;
        return;
      }
      void run();
    },
    editEnded() {
      refreshIfDue();
    },
    dispose() {
      disposed = true;
    },
  };
}
