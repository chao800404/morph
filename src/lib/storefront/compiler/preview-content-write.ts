/**
 * What writing a draft content snapshot into a Live Preview did
 * (docs/astro-theme-plan.md 6.5). Pure, so the Worker, the sidecar and
 * both transports name the same outcomes.
 *
 * - applied: the snapshot was written, and the preview's Worker has since
 *   read it or a later one; a page may reload now and expect it.
 * - PREVIEW_CONTENT_SUPERSEDED: the preview already holds a snapshot with a
 *   higher ticket; nothing was written, and that newer one is what shows.
 * - PREVIEW_CONTENT_TICKET_CONFLICT: the preview holds this ticket with other
 *   content. One ticket names one content; nothing was written.
 *   The same ticket with the same content is not a conflict: it is the same
 *   write, confirmed again (a sync whose answer was lost).
 * - PREVIEW_CONTENT_NOT_CONFIRMED: written, but the Worker of the dev server
 *   it was written for had not read it by the deadline; the page must not
 *   reload expecting it.
 * - PREVIEW_CONTENT_UNCONFIRMABLE: written to a preview with no Worker that
 *   names the snapshot it reads (the client-only preview).
 */
export type PreviewContentWriteResult =
  | Readonly<{ applied: true; ticket: number }>
  | Readonly<{
      applied: false;
      reason:
        | "PREVIEW_CONTENT_SUPERSEDED"
        | "PREVIEW_CONTENT_TICKET_CONFLICT"
        | "PREVIEW_CONTENT_NOT_CONFIRMED"
        | "PREVIEW_CONTENT_UNCONFIRMABLE";
      /** The ticket the preview holds or reads. */
      ticket: number;
    }>;
