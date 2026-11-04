// @ts-check
/**
 * #214 P2's Live Preview private access acceptance, which only a container
 * transport can run: on the shards and the full Start job the preview has no
 * `pv-` host, and the spec skips itself.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. No CI
 * step runs that check yet; wiring the container step is a separate change.
 * Until then these cases are unproven in CI. A renamed case changes this list
 * in the same commit.
 */
export const TARGET = Object.freeze({
  file: "preview-access-container.spec.ts",
  titles: Object.freeze([
    "Live Preview private access on the pv- host › verifies every request, and a copied address alone never gets the draft",
  ]),
});
