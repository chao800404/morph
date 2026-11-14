// @ts-check
/**
 * Required functional tests for `e2e/presentation-ack-refresh.spec.ts` when run
 * against the real Cloudflare container preview in CI (`editor-e2e-container`).
 *
 * All six cases must execute, pass, and have zero skips and zero retries.
 */
export const TARGET = {
  file: "presentation-ack-refresh.spec.ts",
  titles: [
    "presentation ack and unsupported bridge refresh › normal edit receives accepted section-presentation-ack without validation rejection",
    "presentation ack and unsupported bridge refresh › simulated swap: unsupported bridge auto-refreshes once to new bridge and ack takes effect",
    "presentation ack and unsupported bridge refresh › still-unsupported service stops without looping and shows Reload preview button",
    "presentation ack and unsupported bridge refresh › auth or server failure during background bridge check does not auto-refresh",
    "presentation ack and unsupported bridge refresh › IME composing defers unsupported bridge refresh while preserving focus, caret, and text",
    "presentation ack and unsupported bridge refresh › late or unknown presentation ack is ignored and real write + reload succeeds",
  ],
};
