// @ts-check
/**
 * M1 item 1b, cases B1 and B2, on the container transport and the full Start
 * preview: each T1 Starter version (v11, v15, v20, v26, v28) on a storefront
 * of its own, read back before and after the reviewed upgrade; v20 and v28
 * then built, published and rolled back; and the author-edited content.ts on
 * v26 kept, read and published.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. The tests are independent (not serial), so one failure does not
 * skip the others. Not wired into CI yet. A renamed test changes this list
 * in the same commit.
 */
const DESCRIBE = "M1 1b Starter upgrade and compatibility on full Start";

export const TARGET = Object.freeze({
  file: "starter-upgrade-t1-acceptance.spec.ts",
  titles: Object.freeze(
    [
      "B1 v11: read back before and after the reviewed upgrade",
      "B1 v15: read back before and after the reviewed upgrade",
      "B1 v26: read back before and after the reviewed upgrade",
      "B1 v20: read back, refused build, reviewed upgrade, published, rolled back to the release serving before the upgrade",
      "B1 v28: read back, published from its own bytes, reviewed upgrade, published, rolled back",
      "B2 v26: content.ts the author edited is kept byte for byte, the review says why, its read result is unchanged, then published",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
