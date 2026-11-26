/**
 * Codes a CMS Page draft write can come back with, beside the Theme
 * template's own (`theme-write-errors.ts`).
 *
 * Every Page draft write — save, publish, restore, metadata, Show again —
 * names the draft revision `version` its caller read, and refuses when the
 * draft is no longer that revision. The DAL raises the mismatch inside its
 * error message (the only part of an error that survives the RPC hop); the
 * server function answers it as `PAGE_DRAFT_CONFLICT`, and the Dashboard
 * loads the latest Page and keeps what the author typed.
 *
 * A code of its own rather than `TEMPLATE_DRAFT_CONFLICT`: the editor's
 * handlers for that code adopt the latest *template* document, which a Page
 * conflict has none of, so sharing it would send a Page conflict down a
 * template recovery path.
 */
export const PAGE_DRAFT_CONFLICT = "PAGE_DRAFT_CONFLICT";

/** What a Page DAL write raises when its expected draft version is stale. */
export const PAGE_DRAFT_VERSION_MISMATCH = "CONFLICT_PAGE_DRAFT_VERSION_MISMATCH";

/** The message every Page draft conflict is raised with. */
export const PAGE_DRAFT_CONFLICT_MESSAGE =
  "This page was changed elsewhere. The latest version is loaded; save again to apply your changes.";
