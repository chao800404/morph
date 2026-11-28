// @ts-check
/**
 * Astro M2 D3 batch 2 (rows 14, 18 and row 24's layout half):
 * `e2e/astro-layout-inline-acceptance.spec.ts` on the container transport,
 * with Astro on (`MORPH_ASTRO_THEMES=1`) and Core's `ASTRO_PARSER` bound
 * (`MORPH_E2E_ASTRO_PARSER=1`): an editor address naming a route's own
 * Document opens that route and its section edits; a double click on an
 * Astro field enters no canvas edit and writes nothing, while the Inspector
 * still edits it; a layout's section shows the layout Document on every page
 * that uses the layout and Design refuses it, writing nothing; a page publish
 * seals the pending layout draft and a later one stays off until the next
 * publish. All four must run, once each, and pass with zero skip and zero
 * retry.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. No CI step runs it yet (owner decision D4,
 * 2026-11-26), so it is listed as deferred in scripts/ci-workflow.test.mjs.
 * A renamed case changes this list in the same commit.
 */
const DESCRIBE =
  "Astro layout-shared sections and canvas editing (D3 rows 14, 18, 24)";

export const TARGET = Object.freeze({
  file: "astro-layout-inline-acceptance.spec.ts",
  titles: Object.freeze(
    [
      "an editor address naming /about's own Document opens /about, and its section edits",
      "row 14: a double click on an Astro field does not edit on the canvas and writes nothing; the Inspector still edits it",
      "row 18: the layout's section shows the layout Document on every page that uses it, and Design refuses it and the slot's section, writing nothing",
      "row 24, layout: a page publish seals the pending layout draft, and every page using the layout shows it; a later draft stays off until the next publish",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
