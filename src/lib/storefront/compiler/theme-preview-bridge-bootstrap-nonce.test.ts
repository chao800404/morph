// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GENERATED_PREVIEW_BRIDGE_SOURCES } from "./preview-bridge-sources.generated";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * A document that got its channel from the editor's verified offer says so in
 * its first ready, once: the editor takes that ready only for a nonce it
 * offered (use-live-preview-message-bridge). The bridge reads the nonce
 * before anything else can read the address, and the preview carries the
 * module that does it.
 */
describe("the bridge's ready", () => {
  const BRIDGE = themePreviewBridgeEntrySource();

  it("carries the bootstrap nonce its document was reloaded with", () => {
    expect(BRIDGE).toContain('type: "morph:storefront-preview-ready"');
    expect(BRIDGE).toContain("takeBootstrapNonce");
    expect(BRIDGE).toContain("bootstrapNonce");
  });

  it("is built from the preview copy of the bootstrap module", () => {
    const paths = GENERATED_PREVIEW_BRIDGE_SOURCES.map((file) => file.path);
    expect(paths).toContain("src/morph/preview/preview-channel-bootstrap.ts");
  });
});
