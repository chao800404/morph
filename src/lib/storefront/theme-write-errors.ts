/**
 * Codes a theme content write can come back with.
 *
 * The DAL raises one inside its error message, the server function turns the
 * one it recognises into a structured `error`, and the editor decides what to
 * offer the author from that. Defined once because a code that drifts from the
 * one being matched degrades silently: the server stops recognising its own
 * conflict and the editor is handed a plain "save failed" with no way to tell
 * that the author's edit is still valid against a document that has moved.
 */
export const TEMPLATE_DRAFT_CONFLICT = "TEMPLATE_DRAFT_CONFLICT";

/**
 * What the document write raises when the draft generation it was given is
 * no longer the document's. A server function that writes a document turns it
 * into `TEMPLATE_DRAFT_CONFLICT`.
 */
export const TEMPLATE_DRAFT_GENERATION_MISMATCH =
  "CONFLICT_DRAFT_GENERATION_MISMATCH";

/**
 * A content write the saved source cannot vouch for.
 *
 * The section's route (or layout) decides its structure through `content(...)`,
 * yet the source does not confirm this section renders there — the route has
 * diagnostics, does not declare the slot, or is not the route the editor named.
 * Refused rather than checked against the component the Document last stored:
 * that ref describes what rendered then, not what renders now.
 */
export const SECTION_SOURCE_UNCONFIRMED = "SECTION_SOURCE_UNCONFIRMED";

/**
 * A hide the saved source cannot carry out (M3 Hide).
 *
 * The section would stay visible, show its component's defaults, or crash the
 * page while hidden, because something reads its content where Morph cannot
 * omit it. Refused before anything is written; showing a section is never
 * refused with it. See `theme-hide-capability.ts`.
 */
export const SECTION_HIDE_UNSUPPORTED = "SECTION_HIDE_UNSUPPORTED";

/**
 * A publish refused because a hidden section in it cannot be hidden by the
 * build's source revision (M3 Hide); the message lists each with its reason.
 */
export const PUBLISH_HIDDEN_SECTION_UNSUPPORTED =
  "PUBLISH_HIDDEN_SECTION_UNSUPPORTED";

/**
 * A publish whose build was made before Morph's hide guard, with a hidden
 * section that guard would hide: it needs a rebuild, which only the author's
 * explicit "Rebuild and publish" starts.
 */
export const PUBLISH_HIDE_REBUILD_REQUIRED = "PUBLISH_HIDE_REBUILD_REQUIRED";

/** The source used for a visual selection is no longer the saved source. */
export const SELECTION_SOURCE_CONFLICT = "SELECTION_SOURCE_CONFLICT";
export const SELECTION_SOURCE_CONFLICT_MESSAGE =
  "The source code has changed. Select the field again. Your changes are kept.";
