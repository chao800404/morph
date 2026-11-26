// @ts-check
/**
 * Astro M2 PR 1, the basis acknowledgement (option B,
 * handoff/2026-11-24/astro-presentation-ack-options.md):
 * `e2e/astro-basis-ack.spec.ts` on the real container Live Preview, with
 * Astro on (`MORPH_ASTRO_THEMES=1` in the Worker's `.dev.vars` and in the
 * runner's shell) and Core's `ASTRO_PARSER` bound
 * (`MORPH_E2E_ASTRO_PARSER=1`; the runner makes one real parse through that
 * binding before any test, records it beside the report and refuses the run
 * otherwise). The page served from the one snapshot it stamps, through
 * `import()` and the streamed body; a clicked section's basis acknowledged
 * only on Core's confirmed pair, with a stale document refused; and a Start
 * frame that names no `astro-basis-ack-v1`. All three must run, once each,
 * and pass with zero skip and zero retry: the spec's gates skip the whole
 * file where Astro or the parser is off, and this check then fails for the
 * missing cases instead of passing.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. No CI step runs it yet: Astro container E2E
 * is local only for M2 (owner decision D4, 2026-11-26), so it is listed as
 * deferred in scripts/ci-workflow.test.mjs. A renamed case changes this list
 * in the same commit.
 */
export const TARGET = Object.freeze({
  file: "astro-basis-ack.spec.ts",
  titles: Object.freeze([
    "Astro basis acknowledgement on the container Live Preview (option B) › serves each page from the one snapshot it stamps, through import() and the streamed body",
    "Astro basis acknowledgement on the container Live Preview (option B) › acknowledges a clicked section's basis only on Core's confirmed pair, and refuses a stale document",
    "a Start frame on the container Live Preview › never names astro-basis-ack-v1 and carries no morph-content stamp",
  ]),
});
