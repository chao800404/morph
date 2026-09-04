import { describe, expect, it } from "vitest";

import { resolveInlineRename } from "./inline-rename";

describe("resolveInlineRename", () => {
  it("saves an edited value", () => {
    expect(
      resolveInlineRename({
        settled: false,
        draft: "Reworded the hero",
        current: null,
      }),
    ).toEqual({ action: "save", note: "Reworded the hero" });
  });

  it("saves a replacement for an existing description", () => {
    expect(
      resolveInlineRename({ settled: false, draft: "v2", current: "v1" }),
    ).toEqual({ action: "save", note: "v2" });
  });

  it("trims before deciding, so padding alone is not an edit", () => {
    expect(
      resolveInlineRename({ settled: false, draft: "  v1  ", current: "v1" }),
    ).toEqual({ action: "close" });
  });

  it("does not write a value that did not change", () => {
    // Leaving a field you only looked at should cost nothing — no request, and
    // no toast reporting that nothing happened.
    expect(
      resolveInlineRename({ settled: false, draft: "v1", current: "v1" }),
    ).toEqual({ action: "close" });
    expect(
      resolveInlineRename({ settled: false, draft: "   ", current: null }),
    ).toEqual({ action: "close" });
  });

  it("clears a description by emptying the field", () => {
    expect(
      resolveInlineRename({ settled: false, draft: "", current: "v1" }),
    ).toEqual({ action: "save", note: "" });
  });

  it("ignores the blur that follows an Enter or an Escape", () => {
    // Closing the field also blurs it. Without this the second run would
    // commit a value Escape rejected, or send the same rename twice.
    expect(
      resolveInlineRename({
        settled: true,
        draft: "Discard me",
        current: null,
      }),
    ).toEqual({ action: "ignore" });
  });
});
