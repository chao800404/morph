// @ts-check
/**
 * Lane B (handoff/2026-11-25/v32-ci-lanes-plan.md): the shipped Starter 32 on
 * the full Start preview and the container transport. The Starter's own home
 * (first load and reload), in-site navigation through `/_serverFn`, a direct
 * load and reload of a non-home page, and the Sandbox publish on SSR read
 * back: the public site carries the author's values, with the hidden
 * newsletter and the hidden footer absent; refused reads (no preview grant,
 * forged content origin or render context); a static (ssg) home publish whose
 * build's prerendered home, read from R2 and held to its manifest, carries
 * the sealed draft, and whose publish is then refused by the deliberate guard
 * (PUBLISH_RENDER_POLICY_NOT_READY) with the serving release left live; and a
 * static route whose read finds no sealed content failing the publish build
 * at sandbox-start-compiler, with no artifact, no publish and the serving
 * release left live. All seven must run, once each, and pass with zero skip
 * and zero retry.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. The editor-e2e-container-starter-publish job
 * runs that check after its own container step (MORPH_E2E_TRANSPORT=
 * cloudflare-sandbox, MORPH_E2E_PREVIEW_RUNTIME=start,
 * MORPH_THEME_PREVIEW_RUNTIME=start), after the Starter upgrade publish
 * target; if its measured time takes that job past about 25 min it moves to
 * a job of its own. Wiring does not count as a CI pass; a candidate still
 * needs a fresh successful run. A renamed case changes this list in the same
 * commit.
 */
export const TARGET = Object.freeze({
  file: "starter-v32-full-start-acceptance.spec.ts",
  titles: Object.freeze([
    "Starter 32 on the full Start runtime › the Starter's own home: first load and reload render its Document on the server, the hidden sections absent",
    "Starter 32 on the full Start runtime › in-site navigation to a non-home page and back reads each Document through /_serverFn",
    "Starter 32 on the full Start runtime › direct load and reload of the non-home page render its Document on the server",
    "Starter 32 on the full Start runtime › publish on SSR, then read back: the released home carries the author's values, the hidden newsletter and footer absent",
    "Starter 32 on the full Start runtime › a read without preview access, or naming a release it may not see, is refused and says why",
    "Starter 32 on the full Start runtime › a static (ssg) home publish prerenders the sealed draft, then is refused before release and the serving release stays live",
    "Starter 32 on the full Start runtime › a static route whose read finds no sealed content fails the publish build, writes no artifact, and leaves the serving release live",
  ]),
});
