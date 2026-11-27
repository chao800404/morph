// @ts-check
/**
 * Astro M2 PR 3, the first Astro Inspector write:
 * `e2e/astro-inspector-write.spec.ts` on the real container Live Preview,
 * with Astro on (`MORPH_ASTRO_THEMES=1` in the Worker's `.dev.vars` and in
 * the runner's shell) and Core's `ASTRO_PARSER` bound
 * (`MORPH_E2E_ASTRO_PARSER=1`; the runner makes one real parse through that
 * binding before any test and refuses the run otherwise). A click in Design
 * selects the hero and opens its declared fields (owner decision D2); an
 * Inspector edit, gated on the section's acknowledged basis and sent with
 * Core's identity and digest, is stored at exactly that field of the D1
 * draft; a second field is sent only on the reloaded page's own ack; after
 * an editor reload the page, the Inspector and D1 agree. The one case must
 * run once and pass with zero skip and zero retry: the spec's gates skip the
 * whole file where Astro or the parser is off, and this check then fails for
 * the missing case instead of passing.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly this title. No CI step runs it yet: Astro container E2E
 * is local only for M2 (owner decision D4, 2026-11-26), so it is listed as
 * deferred in scripts/ci-workflow.test.mjs. A renamed case changes this list
 * in the same commit.
 */
export const TARGET = Object.freeze({
  file: "astro-inspector-write.spec.ts",
  titles: Object.freeze([
    "Astro Inspector write on the container Live Preview (M2 PR 3) › a click selects the hero, an Inspector edit is stored in the Document, and page, Inspector and Document agree after a reload",
  ]),
});
