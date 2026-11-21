// @ts-check
/**
 * #214 P2's and P3's Live Preview private access acceptance, which only a container
 * transport can run: on the shards and the full Start job the preview has no
 * `pv-` host, and the spec skips itself.
 *
 * The editor-e2e-container job runs this spec after the lifecycle handover and
 * checks this module's exact title set. The checker requires each title once,
 * passed, with zero skip and zero retry. Wiring does not count as a CI pass; a
 * candidate still needs a fresh successful run. A renamed case changes this
 * list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "preview-access-container.spec.ts",
  titles: Object.freeze([
    "Live Preview private access on the pv- host › verifies every request, and a copied address alone never gets the draft",
    "Live Preview private access on the pv- host › opens in its own tab from the editor with this run's draft; before that tab grant, a pasted address gets no draft",
  ]),
});
