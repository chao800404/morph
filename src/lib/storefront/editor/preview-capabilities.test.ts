import { describe, expect, it } from "vitest";
import { themePreviewBridgeEntrySource } from "../compiler/theme-preview-bridge-entry";
import { CLIENT_ONLY_PREVIEW_CAPABILITIES } from "./preview-capabilities";

describe("what each built-in preview page advertises", () => {
  it("the client-only preview does not claim the code-default capability", () => {
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).toEqual([
      "selection-field-section",
    ]);
    expect(CLIENT_ONLY_PREVIEW_CAPABILITIES).not.toContain(
      "code-default-selection",
    );
  });

  it("the Theme bridge advertises it only because it handles the message", () => {
    const source = themePreviewBridgeEntrySource();
    expect(source).toContain('"code-default-selection"');
    expect(source).toContain("acceptedEditorCapabilities(");
    expect(source).toContain("documentPreviewIdentity()");
    expect(source).toContain("selectionForEditor(");
  });
});
