// @ts-check
/**
 * An SSR-only native Start build (render plan v2 step 1), end to end: built
 * from the Theme's own configuration in the Sandbox container, published,
 * published again with new code and content, refused when its draft changes
 * before it reaches Core, and rolled back, each checked on the public
 * storefront. It needs the container transport and the native build switched
 * on (`MORPH_NATIVE_START_BUILD=1`), so on the editor shards it skips itself;
 * this target is the container run, where it may not skip.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly this title, once, passed with zero skip and zero retry.
 * The editor-e2e-container-publish job runs that check after its own
 * container step. A renamed test changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "native-ssr-publish-acceptance.spec.ts",
  titles: Object.freeze([
    "an SSR-only native Start build, from Code to a rolled-back storefront › publishes, publishes again, refuses a publish whose draft changed, and rolls back, on the public storefront",
  ]),
});
