// @ts-check
/**
 * M1 acceptance 1c's revocation timeline of an open Live Preview, which only a
 * container transport can run: on the shards and the full Start job the
 * preview has no `pv-` host, and the spec skips itself at file level (it needs
 * E2E_EXPECT_PREVIEW_TRANSPORT=cloudflare-sandbox and the full Start preview).
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. A
 * passed case means the timeline was measured with no harness error and no
 * draft served after revocation was confirmed; its 30 s verdicts (pass,
 * uncertain, over) are in the timeline JSON, not in the pass. No CI step runs
 * that check yet; wiring the container step is a separate change. Until then
 * these cases are unproven in CI. A renamed case changes this list in the same
 * commit.
 */
const DESCRIBE = "1c: the revocation timeline of an open Live Preview";

export const TARGET = Object.freeze({
  file: "preview-revocation-timeline.spec.ts",
  titles: Object.freeze([
    `${DESCRIBE} › setup: the Theme's test-only socket and server-function fixtures, and this run's draft`,
    `${DESCRIBE} › sign-out: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › revoke-other-session: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › ban: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › role-downgrade: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › remove-user: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › notice-lost: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › notice-lost-after-renewal: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › notice-lost-after-renewal-idle: HTTP and WebSocket timeline of an open frame and tab`,
    `${DESCRIBE} › grant-expiry (listed separately): HTTP and WebSocket timeline of an open frame and tab`,
  ]),
});
