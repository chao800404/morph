import { previewRouteFromHostname } from "./preview-proxy-observation";

/**
 * Asking whether the address a Live Preview frame is loading still answers.
 *
 * The Sandbox SDK answers `410 STALE_PREVIEW_URL` for an address that is still
 * authorized but whose port the current container runtime has not exposed
 * again — after a restart, until the next start re-exposes it — and
 * `404 INVALID_TOKEN` for one that was revoked (cloudflare/sandbox-sdk#708).
 * A frame in that window never comes up, and the editor used to learn so only
 * from its load timeout.
 *
 * The question is answered by sending one request to the address through the
 * same proxy the frame's requests go through, so the answer is the one the
 * frame gets — including for the page itself, which the frame's own diagnostic
 * script cannot report because it never runs. It deliberately does not rely on
 * `getExposedPorts()`, whose empty answer was measured to be unreliable here.
 */

export type PreviewAddressState = "serving" | "stale" | "unknown";

/** Platform-owned in both runtimes, under the already-reserved namespace. */
export const PREVIEW_ADDRESS_PROBE_PATH = "/_morph/preview-health";
export const START_PREVIEW_ADDRESS_PROBE_PATH = PREVIEW_ADDRESS_PROBE_PATH;
export const START_PREVIEW_ID_HEADER = "x-morph-preview-id";

export function previewAddressProbePath(_runtime?: string): string {
  // Probe the instance that is running, not the runtime a later request's
  // environment happens to select. Both modes answer the same contract.
  return PREVIEW_ADDRESS_PROBE_PATH;
}

/**
 * Whether an address the editor sent is this author's own preview.
 *
 * The origin comes from the browser, so it is checked before anything is
 * sent to it: the right port, under the configured preview host, and naming
 * the sandbox derived for this author and Theme — never someone else's.
 */
export function previewAddressBelongsTo(args: {
  previewOrigin: string;
  previewId: string;
  previewHostname: string;
  port: number;
}): URL | null {
  let url: URL;
  try {
    url = new URL(args.previewOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const hostname = url.hostname.toLowerCase();
  const previewHostname = args.previewHostname.toLowerCase();
  if (!hostname.endsWith(`.${previewHostname}`)) return null;
  const route = previewRouteFromHostname(hostname);
  if (!route || route.port !== args.port) return null;
  if (route.sandboxId !== args.previewId.toLowerCase()) return null;
  return url;
}

/**
 * What a probe response says about the address.
 *
 * Only the SDK's two refusals count as "stale"; every other failure is
 * "unknown", so a Theme bug, a Vite error or a network hiccup is never taken
 * for a restarted container.
 */
export function classifyPreviewAddressProbe(
  status: number,
  code: string | null,
  identity?: { expected: string; actual: string | null },
): PreviewAddressState {
  if (status < 400 && identity) {
    return status === 204 && identity.actual === identity.expected
      ? "serving"
      : "unknown";
  }
  if (status < 400) return "serving";
  if (status === 410 && code === "STALE_PREVIEW_URL") return "stale";
  if (status === 404 && code === "INVALID_TOKEN") return "stale";
  return "unknown";
}
