// @ts-check
/**
 * The full Start preview's content sync on the container transport, which
 * only a container transport can run: on the shards and the full Start job
 * the preview is served by the local sidecar, and the spec skips itself.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. The
 * editor-e2e-container-preview job runs that check after its own container
 * step. Wiring does not count as a CI pass; a candidate still needs a fresh
 * successful run. A renamed case changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "start-container-content-sync.spec.ts",
  titles: Object.freeze([
    "Start preview content sync on the container transport › a saved edit reaches the running preview's server without a restart",
  ]),
});
