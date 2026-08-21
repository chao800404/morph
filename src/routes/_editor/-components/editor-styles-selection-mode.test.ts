import { describe, expect, it } from "vitest";
import { resolveStylesSelectionTransition } from "./editor-styles-selection-mode";

describe("resolveStylesSelectionTransition", () => {
  it("auto-enables selection when entering Styles and restores it on exit", () => {
    const entered = resolveStylesSelectionTransition({
      previousTab: "chat",
      nextTab: "styles",
      selectionMode: false,
      commentMode: false,
      autoEnabled: false,
    });

    expect(entered).toEqual({ selectionMode: true, autoEnabled: true });
    expect(
      resolveStylesSelectionTransition({
        previousTab: "styles",
        nextTab: "chat",
        selectionMode: entered.selectionMode,
        commentMode: false,
        autoEnabled: entered.autoEnabled,
      }),
    ).toEqual({ selectionMode: false, autoEnabled: false });
  });

  it("preserves a selection mode that was already active", () => {
    const entered = resolveStylesSelectionTransition({
      previousTab: "chat",
      nextTab: "styles",
      selectionMode: true,
      commentMode: false,
      autoEnabled: false,
    });

    expect(entered).toEqual({ selectionMode: true, autoEnabled: false });
    expect(
      resolveStylesSelectionTransition({
        previousTab: "styles",
        nextTab: "chat",
        selectionMode: true,
        commentMode: false,
        autoEnabled: entered.autoEnabled,
      }),
    ).toEqual({ selectionMode: true, autoEnabled: false });
  });

  it("does not override a toolbar choice after the automatic flag is cleared", () => {
    expect(
      resolveStylesSelectionTransition({
        previousTab: "styles",
        nextTab: "chat",
        selectionMode: true,
        commentMode: false,
        autoEnabled: false,
      }),
    ).toEqual({ selectionMode: true, autoEnabled: false });
  });

  it("does not enable selection while comment mode owns the canvas", () => {
    expect(
      resolveStylesSelectionTransition({
        previousTab: "comments",
        nextTab: "styles",
        selectionMode: false,
        commentMode: true,
        autoEnabled: false,
      }),
    ).toEqual({ selectionMode: false, autoEnabled: false });
  });
});
