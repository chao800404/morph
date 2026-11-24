// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  THEME_PREVIEW_BRIDGE_CAPABILITIES,
  themePreviewBridgeEntrySource,
} from "./theme-preview-bridge-entry";

/**
 * The bridge's wiring of the Astro basis ack (option B). The decision itself
 * is `astroBasisAckVerdict` (preview-dom.astro-basis.test.ts); here, only
 * that the bridge reaches it the way the protocol says:
 *
 * - the basis capability and the served-content stamp are reported only by a
 *   page that navigates as documents, so a Start ready is what it was;
 * - a confirm-section-basis message is answered from the verdict, with no
 *   overlay applied and no refresh run.
 */

const BRIDGE = themePreviewBridgeEntrySource();

describe("the bridge's basis ack", () => {
  it("leaves the capabilities every bridge names as they were", () => {
    expect(THEME_PREVIEW_BRIDGE_CAPABILITIES).toEqual([
      "selection-field-section",
      "code-default-selection",
      "astro-identity-v2",
      "section-presentation-ack-v1",
    ]);
  });

  it("adds the basis capability and the stamp for document navigation only", () => {
    expect(BRIDGE).toContain(
      'const READY_CAPABILITIES = documentNavigation\n  ? [...BRIDGE_CAPABILITIES, "astro-basis-ack-v1"]\n  : BRIDGE_CAPABILITIES;',
    );
    expect(BRIDGE).toContain(
      "const servedContent = documentNavigation ? servedContentReport() : null;",
    );
    expect(BRIDGE).toContain("...(servedContent ? { servedContent } : {}),");
  });

  it("answers a basis token from the verdict alone", () => {
    const start = BRIDGE.indexOf(
      'if (message?.type === "morph:storefront-preview-confirm-section-basis") {',
    );
    expect(start).toBeGreaterThan(0);
    const end = BRIDGE.indexOf("return;", start);
    const handler = BRIDGE.slice(start, end);
    expect(handler).toContain("astroBasisAckVerdict({");
    expect(handler).toContain("documentNavigation,");
    expect(handler).not.toContain("updatePreviewContent");
    expect(handler).not.toContain("refreshPreviewContent");
    expect(handler).not.toContain("queuePresentationToken");
  });

  it("reads the stamp from the document's own navigation entry", () => {
    expect(BRIDGE).toContain("function servedContentReport()");
    expect(BRIDGE).toContain("PREVIEW_SERVED_CONTENT_TIMING");
    expect(BRIDGE).toContain("previewServedContentFromEntries");
  });
});
