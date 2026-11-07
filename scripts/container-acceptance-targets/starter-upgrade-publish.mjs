// @ts-check
/**
 * T1: Themes from old Starter versions (v28, v20), upgraded through the
 * editor's review, then built, published and rolled back on the container
 * transport. Both tests must run, once each, and pass with zero skip and zero
 * retry.
 */
export const TARGET = Object.freeze({
  file: "starter-upgrade-publish-acceptance.spec.ts",
  titles: Object.freeze([
    "Starter upgrade from history, built, published and rolled back › v28: published from its own bytes, upgraded by review, published again, rolled back",
    "Starter upgrade from history, built, published and rolled back › v20: refused until upgraded by review, then published; the site can return to the release serving before the upgrade",
  ]),
});
