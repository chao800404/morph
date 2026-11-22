// @ts-check
/**
 * M1 acceptance 1c's revocation timeline of an open Live Preview, which only a
 * container transport can run: on the shards and the full Start job the
 * preview has no `pv-` host, and the spec skips itself at file level (it needs
 * E2E_EXPECT_PREVIEW_TRANSPORT=cloudflare-sandbox and the full Start preview).
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. A
 * passed case means the timeline was measured with no harness error, nothing
 * (draft or not) served to a request sent after revocation was confirmed
 * (the access hand-off page excepted), and the case was complete: no
 * re-login after its preparation, and (after-renewal cases) each case
 * socket's lease renewal seen before the revocation, within the fixed 1 s
 * window. Every case must meet the design limits (32 s data, idle case not
 * applicable; 37 s 4401 close). An incomplete case fails. Its 30 s
 * verdicts (pass = met, uncertain, over = not met) are in the timeline JSON,
 * not in the pass; the 30 s guarantee stays unproven. No CI step runs
 * that check yet; wiring the container step is a separate change. Until then
 * these cases are unproven in CI. A renamed case changes this list in the same
 * commit.
 *
 * Environment the after-renewal cases need, or they are INCOMPLETE (and so
 * fail; they can never pass without it):
 * - MORPH_PREVIEW_LEASE_EVENTS=1 in what Wrangler loads for the run (with the
 *   container transport, `.dev.vars`): the preview Durable Object then writes
 *   a `[preview-lease-verified]` line each time a socket's lease renews
 *   (src/lib/storefront/service/preview-access/preview-socket-lease-events.ts).
 *   Off, no line is written and the case's sockets cannot be identified.
 * - M1_1C_WORKER_LOG: the path of the run's captured dev-server output (the
 *   file the runner's stdout is redirected to), which the spec reads, never
 *   writes. Unset or missing, the cases cannot see a renewal.
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
