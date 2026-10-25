/**
 * The page stand-in: a selection named by the page's route path rather than
 * by a section.
 *
 * The preview reports a field a Theme component renders outside every
 * section under the route the editor asked for (`resolvePageStandIn`), so the
 * Inspector can say what state that field is in. A route path is never a
 * slot id (`isValidThemeContentSlotId` refuses a leading `/`), and it is never
 * a place a Document value is written: the page stand-in carries a status,
 * and at most the component's own proven source default
 * (`source-default-control.ts`), which is a Theme source write, not content.
 */

/** Whether a section id is a page stand-in: a route path, never a slot id. */
export function isPageStandInId(sectionId: string | null | undefined): boolean {
  return typeof sectionId === "string" && sectionId.startsWith("/");
}

/**
 * Whether the editor takes a page stand-in selection from the frame.
 *
 * Every condition is the editor's own knowledge, never the frame's say-so:
 * the message came from the document the editor confirmed as current (C5),
 * that frame answered the editor's latest route request in this ready round
 * (#270), and the id is exactly the route the editor asked for. A frame on an
 * older bridge, an unconfirmed candidate, another document, or a frame behind
 * a newer request gets no stand-in.
 */
export function acceptsPageStandIn(
  input: Readonly<{
    sectionId: string;
    /** The route the editor asked the frame for; null asks for the root. */
    requestedRoutePath: string | null | undefined;
    /** The message named the confirmed current document. */
    fromConfirmedDocument: boolean;
    /** The frame answered the editor's latest route request in this round. */
    routeRequestAnswered: boolean;
  }>,
): boolean {
  return (
    isPageStandInId(input.sectionId) &&
    input.fromConfirmedDocument &&
    input.routeRequestAnswered &&
    input.sectionId === (input.requestedRoutePath ?? "/")
  );
}

/**
 * Whether a section id names a place this page's content is stored: a
 * section a template owns, and never a page stand-in. Asked before any
 * write, preview post or history entry a content change makes.
 */
export function isDocumentWriteTarget(
  sectionId: string | null | undefined,
  templateIdForSection: (sectionId: string) => string | null,
): sectionId is string {
  return (
    typeof sectionId === "string" &&
    sectionId.length > 0 &&
    !isPageStandInId(sectionId) &&
    templateIdForSection(sectionId) !== null
  );
}
