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
 * hide-4 (approach E, step 1): every supported site is mounted through the
 * platform's section gate (`@morph/sdk/section-gate`, theme-section-gate.ts),
 * which reads the hidden list from the root route's snapshot and fails
 * closed; only the Starter 32 content module and root are admitted. The
 * gate's source is covered by this version: change it with the gate. Past
 * hide-2 and hide-3 too, which the allowlist and PR-1 branches built with.
 *
 * hide-5 (the review of f1bcc7a): the gate reports each commit of a slot's
 * visibility for the Live Preview's Hide ack, a loader site's gate honours
 * the root's hidden list too, the Starter's whole check is wrapped rather
 * than the element inside it, and a list item's key is repeated on its gate.
 *
 * hide-6 (the review of b4e81b2): the gate also records every slot it has
 * committed in the document, and a JSX string key is repeated as its value.
 *
 * Kept apart from the transform so the identity can be read without loading
 * the analysis.
 */
export const THEME_HIDE_GUARD_VERSION = "hide-6";
