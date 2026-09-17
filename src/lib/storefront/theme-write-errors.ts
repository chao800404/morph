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
