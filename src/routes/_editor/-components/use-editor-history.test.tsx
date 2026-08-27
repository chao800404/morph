import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEditorHistory } from "./use-editor-history";

describe("useEditorHistory", () => {
  it("keeps the actions object stable across recorded edits", () => {
    // The editor's write paths list these in their dependency arrays. Handing
    // them an object rebuilt on every recorded edit rebuilds every callback and
    // effect that depends on them, tearing down and re-establishing
    // subscriptions on each pass — which showed up as the structure panel
    // refusing to stay open while editing.
    const { result, rerender } = renderHook(() => useEditorHistory());
    const first = result.current.actions;

    act(() => {
      result.current.actions.record({
        label: "padding",
        undo: () => {},
        redo: () => {},
      });
    });
    rerender();

    expect(result.current.actions).toBe(first);
  });

  it("still reports the state change that the edit produced", () => {
    const { result } = renderHook(() => useEditorHistory());
    expect(result.current.state.canUndo).toBe(false);

    act(() => {
      result.current.actions.record({
        label: "padding",
        undo: () => {},
        redo: () => {},
      });
    });

    expect(result.current.state.canUndo).toBe(true);
    expect(result.current.state.undoLabel).toBe("padding");
  });

  it("reverses through the actions object", async () => {
    const log: string[] = [];
    const { result } = renderHook(() => useEditorHistory());

    act(() => {
      result.current.actions.record({
        label: "padding",
        undo: () => log.push("undo"),
        redo: () => log.push("redo"),
      });
    });
    await act(async () => {
      result.current.actions.undo();
    });

    expect(log).toEqual(["undo"]);
    expect(result.current.state.canRedo).toBe(true);
  });
});
