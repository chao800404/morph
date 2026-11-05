// @ts-check
/**
 * #214 A7's relayed Theme WebSocket acceptance, which only a container
 * transport can run: on the shards and the full Start job the preview has no
 * `pv-` host, and the spec skips itself (it needs
 * E2E_EXPECT_PREVIEW_TRANSPORT=cloudflare-sandbox).
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. No CI
 * step runs that check yet; wiring the container step is a separate change
 * (stage 3). Until then these cases are unproven in CI. A renamed case changes
 * this list in the same commit.
 */
const DESCRIBE = "A7: a Theme WebSocket relayed under its preview grant";

export const TARGET = Object.freeze({
  file: "preview-socket-acceptance.spec.ts",
  titles: Object.freeze([
    `${DESCRIBE} › setup: the Theme's test-only socket fixture`,
    `${DESCRIBE} › mixed text and binary frames keep their order and bytes, both ways`,
    `${DESCRIBE} › frame, pushed: the socket stops and closes 4401 within the lease`,
    `${DESCRIBE} › frame, notice-lost: the socket stops and closes 4401 within the lease`,
    `${DESCRIBE} › tab, pushed: the socket stops and closes 4401 within the lease`,
    `${DESCRIBE} › tab, notice-lost: the socket stops and closes 4401 within the lease`,
  ]),
});
