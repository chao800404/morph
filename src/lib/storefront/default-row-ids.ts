/**
 * The ids the shell's own rows are born with.
 *
 * A row's id is platform metadata: the editor assigns it, instance styles are
 * addressed by it, and a Theme's only use for it is as a React key. The rows a
 * Store starts life with are the one set nobody assigns — they are written into
 * the starter Header and Footer as default props, and into the layout document
 * seeded beside them — so they are written down here instead, once, and both
 * places quote these exact strings.
 *
 * Fixed rather than generated, because the two must agree: the document seeds
 * the same rows the component would have defaulted to, and a Store adopting the
 * document must not have its rows silently re-identified. `starter-theme-files`
 * has a test that the starter source still spells them the same way.
 *
 * Never reuse one of these for a row created later. `createMorphItemId` is for
 * that, and a collision would move instance styles onto the wrong row.
 */

export const DEFAULT_HEADER_NAV_ITEM_IDS = [
  "morph-nav-shop",
  "morph-nav-about",
  "morph-nav-journal",
] as const;

export const DEFAULT_FOOTER_EXPLORE_ITEM_IDS = [
  "morph-explore-shop-all",
  "morph-explore-our-story",
  "morph-explore-journal",
] as const;

export const DEFAULT_FOOTER_HELP_ITEM_IDS = [
  "morph-help-contact",
  "morph-help-shipping",
  "morph-help-returns",
] as const;
