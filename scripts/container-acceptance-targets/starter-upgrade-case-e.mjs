// @ts-check
/**
 * Case E of the Starter upgrade: a toolchain pin an earlier Starter wrote is
 * refused by the build and builds once the reviewed upgrade is applied. It
 * needs a container build, so it skips on the shards and the full Start job;
 * its container step runs it alone (it saves its own probe route), and only
 * this test may be in that step's report for the file.
 */
export const TARGET = Object.freeze({
  file: "starter-upgrade.spec.ts",
  titles: Object.freeze([
    "Starter upgrade, reviewed by the author › E. a toolchain pin an earlier Starter wrote: refused by the build, built once the reviewed upgrade is applied",
  ]),
});
