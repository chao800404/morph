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
      [
        "  return documentNavigation",
        '    ? [...BRIDGE_CAPABILITIES, "astro-basis-ack-v1"]',
        "    : BRIDGE_CAPABILITIES;",
      ].join("\n"),
    );
    // A function of its own, so `reportReady` still runs where tests cut it
    // out alone (theme-preview-bridge-selection-field / -presentation-trace).
    expect(BRIDGE).toContain(
      "return documentNavigation ? servedContentReport() : null;",
    );
    expect(BRIDGE).toContain("...(servedContent ? { servedContent } : {}),");
  });

  it("posts the stamp and the basis capability on a document-navigation ready, and neither on a Start one", () => {
    const cutFunction = (name: string) => {
      const start = BRIDGE.indexOf(`function ${name}(`);
      expect(start, name).toBeGreaterThan(0);
      return BRIDGE.slice(start, BRIDGE.indexOf("\n}\n", start) + 2);
    };
    const stamp = {
      ticket: 7,
      instance: "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11",
    };
    for (const documentNavigation of [true, false]) {
      const posted: unknown[] = [];
      new Function(
        "channel",
        "servedInstanceReport",
        "postPreviewToEditorMessage",
        "reportStructure",
        "window",
        "BRIDGE_CAPABILITIES",
        "documentNavigation",
        "servedContentReport",
        `let editorSupportsCodeDefault = false; let editorSupportsAstroIdentity = false; let bootstrapNonce = null;
        ${cutFunction("readyCapabilities")}
${cutFunction("readyServedContent")}\n${cutFunction("reportReady")}\nreportReady();`,
      )(
        { previewSession: "s" },
        () => null,
        (message: unknown) => posted.push(message),
        () => {},
        { dispatchEvent: () => true },
        ["section-presentation-ack-v1"],
        documentNavigation,
        () => stamp,
      );
      expect(posted, String(documentNavigation)).toEqual([
        documentNavigation
          ? {
              type: "morph:storefront-preview-ready",
              capabilities: ["section-presentation-ack-v1", "astro-basis-ack-v1"],
              servedContent: stamp,
            }
          : {
              type: "morph:storefront-preview-ready",
              capabilities: ["section-presentation-ack-v1"],
            },
      ]);
    }
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
