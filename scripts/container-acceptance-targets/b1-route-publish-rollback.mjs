// @ts-check
/**
 * M1 1a, A3 and A4: the B1 route cases (p1, p2, p5 edited; p3, p4a, p6 as
 * code) on non-home pages with their own route Documents, published, served,
 * rolled back and reloaded, with the publish scope cases between release 2
 * and the rollback (S-a: another page's unpublished draft stays out of a
 * single-page publish; S-b: a pending shared layout is sealed by it). Only
 * the container transport can run it:
 * publishing builds in the Sandbox container, and the spec skips itself at
 * file level elsewhere (the shards and the full Start job use local-sidecar).
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. The tests are serial, so a failed step leaves the later ones skipped,
 * and that fails the check too. No CI step runs that check yet; wiring the
 * container step is a separate change, and until then these cases are proven
 * by local container runs only. A renamed test changes this list in the same
 * commit.
 *
 * The 1a run plan also lists A7 (preview navigation): navigation-matrix.spec.ts,
 * already run by the full Start job (editor-e2e-start.mjs, shard 3); it has no
 * container target of its own.
 */
const DESCRIBE = "B1 non-home route Documents publish and rollback (A3, A4)";

export const TARGET = Object.freeze({
  file: "b1-route-publish-rollback-acceptance.spec.ts",
  titles: Object.freeze(
    [
      "release 1: p1 per-field route desc edited in the Inspector through Design",
      "release 1: p2 cross-name alias route heading edited on the canvas through Design",
      "release 1: p5 second same-text instance title edited in the Inspector through Design",
      "release 1: p4a literal before the spread is shown as code and Design writes nothing",
      "release 1: p6 untraced value is refused on the canvas and Design writes nothing",
      "release 1: published, the public home and each route page show its values, code values unchanged",
      "release 2: p1 per-field route desc edited on the canvas through Design",
      "release 2: p2 cross-name alias route heading edited in the Inspector through Design",
      "release 2: p5 second same-text instance title edited on the canvas through Design",
      "release 2: the draft stays off the public site until published, then the public site shows release 2",
      "publish scope: p1 per-field route desc edited in the Inspector and left unpublished",
      "publish scope: p2 cross-name alias route heading edited on the canvas, to be published on its own",
      "publish scope: publishing p2 from its own editor seals p2 only, p1's unpublished draft stays off the public site",
      "publish scope: l1 layout-shared second instance edited on the canvas and left pending",
      "publish scope: publishing p2 with a pending layout seals the layout too, p1's page shows the new shared block over its published body",
      "rollback to release 1 with expectedActiveReleaseId: a stale expectation is refused, then the public site is back to release 1 after a reload",
      "after the rollback the editor reloads with the pre-rollback drafts on every route under full Start",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
