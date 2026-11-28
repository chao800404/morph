// @ts-check
/**
 * A hidden layout section (the Starter's Header and Footer) stays hidden on
 * every load and in the published release: the hide survives a reload, and a
 * publish with both hidden serves neither and leaks none of their values,
 * shown again and republished brings both back with the author's values.
 * The publish test builds in the Sandbox container, so it needs the container
 * transport; on the client lane's shards (editor shard 6) it skips itself, and
 * the hide-and-reload test runs on both. This target is the container run,
 * where neither may skip.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. The editor-e2e-container-publish job runs that check after its own
 * container step. Wiring does not count as a CI pass; a candidate still needs
 * a fresh successful run. A renamed test changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "section-visibility-layout.spec.ts",
  titles: Object.freeze([
    "a hidden layout section › hide the Header, reload: still hidden",
    "a hidden layout section › publish: hidden stays hidden, shown again comes back",
  ]),
});
