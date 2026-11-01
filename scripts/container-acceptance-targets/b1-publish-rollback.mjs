// @ts-check
/**
 * The B1 publish and rollback acceptance on the home (h1) and layout-shared
 * (l1) cases, which only the container job can run: publishing builds in the
 * Sandbox container.
 *
 * The container step runs the whole spec, and check-container-acceptance.mjs
 * then requires exactly these titles, each once, passed with zero skip and
 * zero retry. The tests are serial, so a failed step leaves the later ones
 * skipped, and that fails the check too. A renamed test changes this list in
 * the same commit.
 */
const DESCRIBE = "B1 publish and rollback on the home and layout-shared cases";

export const TARGET = Object.freeze({
  file: "b1-publish-rollback-acceptance.spec.ts",
  titles: Object.freeze(
    [
      "release 1: h1 home route second instance edited in the Inspector through Design",
      "release 1: l1 layout-shared second instance edited on the canvas through Design",
      "release 1: published, the public home and non-home pages show its values with each instance its own",
      "release 2: h1 home route second instance edited on the canvas through Design",
      "release 2: l1 layout-shared second instance edited in the Inspector through Design",
      "release 2: the draft stays off the public site until published, then the public site shows release 2",
      "rollback to release 1: after a reload every case on the public site is back to release 1",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
