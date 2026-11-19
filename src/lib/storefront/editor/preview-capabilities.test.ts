import { describe, expect, it } from "vitest";
import { themePreviewBridgeEntrySource } from "../compiler/theme-preview-bridge-entry";
import { CLIENT_ONLY_PREVIEW_CAPABILITIES } from "./preview-capabilities";

describe("what each built-in preview page advertises", () => {
  it("the client-only preview does not claim the code-default capability", () => {
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).toEqual([
      "selection-field-section",
      "section-presentation-ack-v1",
    ]);
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).not.toContain(
      "code-default-selection",
    );
  });

  it("the client-only preview advertises presentation ack only when its route handles it", () => {
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).toContain(
      "section-presentation-ack-v1",
    );
  });

  it("the Theme bridge advertises it only because it handles the message", () => {
    const source = themePreviewBridgeEntrySource();
    expect(source).toContain('"code-default-selection"');
    expect(source).toContain("acceptedEditorCapabilities(");
    expect(source).toContain("documentPreviewIdentity()");
    expect(source).toContain("selectionForEditor(");
  });

  it("the client-only preview does not claim the Astro identity either", () => {
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).not.toContain("astro-identity-v2");
  });

  it("the Theme bridge sends the v2 identity only after its editor names the token, per document", () => {
    const source = themePreviewBridgeEntrySource();
    expect(source).toContain('"astro-identity-v2"');
    expect(source).toContain(
      'editorSupportsAstroIdentity = accepted.includes("astro-identity-v2");',
    );
    expect(source).toContain(
      "previewSourceIdentityReport(item.element, editorSupportsAstroIdentity)",
    );
    // A new ready forgets it, like code-default-selection.
    const ready = source.slice(source.indexOf("function reportReady()"));
    expect(
      ready.slice(0, ready.indexOf("postPreviewToEditorMessage(")),
    ).toContain("editorSupportsAstroIdentity = false;");
    // The boundary is reported through that one helper, nowhere else.
    expect(source).not.toContain("previewBoundary: previewSourceBoundaryOf(");
  });
});
