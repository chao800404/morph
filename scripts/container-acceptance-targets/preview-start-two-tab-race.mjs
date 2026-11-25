// @ts-check
/**
 * Auto-retry v2's two-tab race on a real container (user, 2026-11-24: proven
 * before the M1 round 4 candidate is frozen). Only the container transport
 * has the current-start guard and the fence ledger the race meets in, and
 * the candidate is the full Start preview, so the spec skips itself
 * anywhere else.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. The editor-e2e-container-preview job runs that check after its own
 * container step (MORPH_E2E_TRANSPORT=cloudflare-sandbox,
 * MORPH_E2E_PREVIEW_RUNTIME=start, MORPH_THEME_PREVIEW_RUNTIME=start).
 * Wiring does not count as a CI pass; a candidate still needs a fresh
 * successful run. A renamed case changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "preview-start-two-tab-race.spec.ts",
  titles: Object.freeze([
    "two tabs start one Live Preview on the container › the newer tab's start owns the workspace: the older tab's late answer is superseded and changes nothing the newer tab serves",
  ]),
});
