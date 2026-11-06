import type {
  PreviewCapability,
  PreviewSelectionMessage,
} from "./preview-protocol";
import { parseAstroInstanceIdentity } from "../theme-framework/astro-preview-locate";

/**
 * What an Astro canvas click may ask Core to confirm as a Design selection
 * (M2 PR-I, P3). The editor shell does not call this yet: the Astro Design
 * selection state is PR-F's, and every Astro click still only locates
 * (L1.5a, `resolveSourceLocatedTarget`), which this never replaces.
 *
 * - `needs-reload`: the frame on screen did not announce `astro-identity-v2`
 *   in this ready (an older preview). No Design selection; reload the
 *   preview to get one.
 * - `unavailable`: a v2 frame, but this click names no identity Core could
 *   verify (outside every boundary, a range the bridge refused, no v2 id, no
 *   `sourceDigest`).
 * - `pending-core`: an identity to hand to Core. It is a claim from a page
 *   that runs author code, not a selection: Core's verification
 *   (`verifyAstroInstanceIdentity`) decides, and the capability plays no
 *   part in that.
 */
export type AstroDesignSelectionRequest =
  | Readonly<{ status: "needs-reload" }>
  | Readonly<{
      status: "unavailable";
      reason: "outside" | "not-selectable" | "no-identity" | "no-source-digest";
    }>
  | Readonly<{
      status: "pending-core";
      marker: string;
      sourceLocation: string;
      sourceDigest: string;
    }>;

export function astroDesignSelectionRequest(
  message: PreviewSelectionMessage,
  frameCapabilities: ReadonlySet<PreviewCapability>,
): AstroDesignSelectionRequest {
  if (!frameCapabilities.has("astro-identity-v2")) {
    return { status: "needs-reload" };
  }
  const boundary = message.previewBoundary;
  if (!boundary || boundary.reason === "outside") {
    return { status: "unavailable", reason: "outside" };
  }
  if (!boundary.selectable) {
    return { status: "unavailable", reason: "not-selectable" };
  }
  if (!boundary.marker || !parseAstroInstanceIdentity(boundary.marker)) {
    return { status: "unavailable", reason: "no-identity" };
  }
  if (!message.sourceDigest || !message.sourceLocation) {
    return { status: "unavailable", reason: "no-source-digest" };
  }
  return {
    status: "pending-core",
    marker: boundary.marker,
    sourceLocation: message.sourceLocation,
    sourceDigest: message.sourceDigest,
  };
}
