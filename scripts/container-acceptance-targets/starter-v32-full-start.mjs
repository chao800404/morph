// @ts-check
/**
 * Lane B (handoff/2026-11-25/v32-ci-lanes-plan.md): the shipped Starter 32 on
 * the full Start preview and the container transport. The Starter's own home
 * (first load and reload), in-site navigation through `/_serverFn`, a direct
 * load and reload of a non-home page, and the Sandbox publish read back: the
 * released artifact's prerendered home (built through its sealed pass) and
 * the public site carry the author's values, with the hidden newsletter and
 * the hidden footer absent; refused reads (no preview grant, forged content
 * origin or render context); and a sealed-pass read that still cannot read
 * content failing the publish build (NATIVE_PRERENDER_CONTENT_UNAVAILABLE)
 * with the serving release left live. All six must run, once each, and pass
 * with zero skip and zero retry.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. No CI step runs this check yet: which
 * container job hosts it is decided from measured time. Wiring does not count
 * as a CI pass. A renamed case changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "starter-v32-full-start-acceptance.spec.ts",
  titles: Object.freeze([
    "Starter 32 on the full Start runtime › the Starter's own home: first load and reload render its Document on the server, the hidden sections absent",
    "Starter 32 on the full Start runtime › in-site navigation to a non-home page and back reads each Document through /_serverFn",
    "Starter 32 on the full Start runtime › direct load and reload of the non-home page render its Document on the server",
    "Starter 32 on the full Start runtime › publish, then read back: the released home carries the author's values, the hidden newsletter and footer absent",
    "Starter 32 on the full Start runtime › a read without preview access, or naming a release it may not see, is refused and says why",
    "Starter 32 on the full Start runtime › a sealed-pass read that still cannot read content fails the publish build and leaves the serving release live",
  ]),
});
