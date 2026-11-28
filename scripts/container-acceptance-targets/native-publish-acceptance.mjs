// @ts-check
/**
 * A native Start build that prerenders (docs/start-native-import-plan.md,
 * step 1b-2 item 3): built from the Theme's own configuration in the Sandbox
 * container, its build and the CMS content it was sealed with stay paired
 * through Build Preview and a refused stale publish, and its static HTML is
 * refused at publish (`NATIVE_HTML_ASSET_UNAVAILABLE`). It needs the
 * container transport and the native build switched on
 * (`MORPH_NATIVE_START_BUILD=1`), so on the editor shards it skips itself;
 * this target is the container run, where it may not skip.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly this title, once, passed with zero skip and zero retry.
 * The editor-e2e-container-publish job runs that check after its own
 * container step. A renamed test changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "native-publish-acceptance.spec.ts",
  titles: Object.freeze([
    "a native Start build that prerenders, from Code to a refused publish › keeps the build paired with its sealed content in Build Preview, and refuses to publish its static HTML",
  ]),
});
