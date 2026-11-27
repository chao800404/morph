// @ts-check
/**
 * Astro M2 D3 rows 21-23 and row 24's page isolation:
 * `e2e/astro-design-release-acceptance.spec.ts` on the container transport,
 * with Astro on (`MORPH_ASTRO_THEMES=1`) and Core's `ASTRO_PARSER` bound
 * (`MORPH_E2E_ASTRO_PARSER=1`). Design edits on a native `.astro` site:
 * release 1 published from the editor and served; a sibling page's draft
 * left unpublished and the home edited again, off the public site until
 * published, then release 2 served with the sibling's draft still off; a
 * rollback naming a stale active release refused, the real one serving
 * release 1 again; and the editor reloading after it with every draft
 * intact. All four must run, once each, and pass with zero skip and zero
 * retry.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. No CI step runs it yet (owner decision D4,
 * 2026-11-26), so it is listed as deferred in scripts/ci-workflow.test.mjs.
 * A renamed case changes this list in the same commit.
 */
const DESCRIBE = "Astro Design edits published and rolled back (D3 rows 21-24)";

export const TARGET = Object.freeze({
  file: "astro-design-release-acceptance.spec.ts",
  titles: Object.freeze(
    [
      "release 1: the home title edited in the Inspector through Design and published, and the public home shows it",
      "release 2: a sibling page's draft stays unpublished, the home's draft stays off the public site until published, then the public home shows release 2",
      "rollback to release 1: a stale expectedActiveReleaseId is refused, then the public site is back to release 1",
      "after the rollback the editor reloads with its drafts on both pages",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
