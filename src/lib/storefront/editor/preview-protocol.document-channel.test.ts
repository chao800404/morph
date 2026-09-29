// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The editor channel is read from the URL the preview document was loaded
 * with, and kept: a Theme that navigates with browser history (a Start
 * preview) drops the query, and the page must go on answering the editor.
 */
describe("documentPreviewRuntimeChannel", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.resetModules();
  });

  const SESSION = "0f5c8a52-7c3a-4d1e-9b1a-2f7d6b3c4e5f";

  it("keeps the channel after the page's own navigation drops the query", async () => {
    window.history.replaceState(
      null,
      "",
      `/?editorOrigin=${encodeURIComponent("http://localhost:3000")}&previewSession=${SESSION}`,
    );
    const { documentPreviewRuntimeChannel, readPreviewRuntimeChannel } =
      await import("./preview-protocol");
    const first = documentPreviewRuntimeChannel();
    expect(first).toEqual(readPreviewRuntimeChannel(window.location.href));
    expect(first).not.toBeNull();

    window.history.pushState(null, "", "/compat-other");
    expect(readPreviewRuntimeChannel(window.location.href)).toBeNull();
    expect(documentPreviewRuntimeChannel()).toEqual(first);
  });

  it("has none for a page opened without an editor", async () => {
    const { documentPreviewRuntimeChannel } = await import("./preview-protocol");
    expect(documentPreviewRuntimeChannel()).toBeNull();
  });
});
