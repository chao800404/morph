/**
 * The M3 Hide guard transform's version (`theme-hide-guard.ts`), folded into
 * a Start build's compiler identity (`withThemeStartBuildIdentity`), so a
 * build records whether, and which, guard it carries. Change it whenever what
 * the guard emits, or which shapes the classifier supports, changes.
 *
 * hide-2 (2026-11-26, M3 PR-1): the whole-Theme proof. Which shapes are
 * supported changed (a reader anywhere in the Theme, an inexact import, a
 * raw content reader or the route context now refuse; another route's
 * guarded call site of the same slot id is accepted), so a hide-1 artifact
 * was planned by other rules and is never reused or published as current.
 *
 * hide-3 (same day, second re-review): the hidden state itself is part of
 * the proof (`_hidden` writes and reads, non-guard `isSectionHidden`), the
 * content module and root are confirmed as code, and computed router or
 * route-object access refuses.
 *
 * Kept apart from the transform so the identity can be read without loading
 * the analysis.
 */
export const THEME_HIDE_GUARD_VERSION = "hide-3";
