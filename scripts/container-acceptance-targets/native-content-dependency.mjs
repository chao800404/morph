// @ts-check
/**
 * Content-only publishing on a native Start build that proved its artifact
 * holds no CMS content (docs/start-native-import-plan.md, content
 * dependency): a content edit published without a build, that release rolled
 * back, and a build of unknown dependency held to its seal. It needs the
 * container transport and the native build switched on
 * (`MORPH_NATIVE_START_BUILD=1`), so on the editor shards it skips itself;
 * this target is the container run, where it may not skip.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly this title, once, passed with zero skip and zero retry.
 * The editor-e2e-container-preview job runs that check after its own
 * container step. A renamed test changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "native-content-dependency.spec.ts",
  titles: Object.freeze([
    "content-only publishing on a build proven independent of content › publishes content without a build only where the build proved it holds none",
  ]),
});
