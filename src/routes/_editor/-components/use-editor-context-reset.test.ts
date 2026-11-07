import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorContextReset } from "./use-editor-context-reset";

describe("useEditorContextReset", () => {
  it("does not reset on mount or template resolution", () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ templateId, routePath }) =>
        useEditorContextReset({ templateId, routePath, onReset }),
      {
        initialProps: {
          templateId: undefined,
          routePath: "/",
        } as { templateId: string | undefined; routePath: string | undefined },
      },
    );

    rerender({ templateId: "template-a", routePath: "/" });

    expect(onReset).not.toHaveBeenCalled();
  });

  it("resets once when route and template change together", () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ templateId, routePath }) =>
        useEditorContextReset({ templateId, routePath, onReset }),
      {
        initialProps: { templateId: "template-a", routePath: "/" },
      },
    );

    act(() => {
      rerender({ templateId: "template-b", routePath: "/products" });
    });
    rerender({ templateId: "template-b", routePath: "/products" });

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("resets when only the authored route changes", () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ templateId, routePath }) =>
        useEditorContextReset({ templateId, routePath, onReset }),
      {
        initialProps: { templateId: "template-a", routePath: "/" },
      },
    );

    rerender({ templateId: "template-a", routePath: "/contact" });

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does not reset for a change the shell names the same page, and judges the next change from it", () => {
    const onReset = vi.fn();
    const judged: Array<[unknown, unknown]> = [];
    const isSamePage = (
      previous: { templateId?: string; routePath?: string },
      next: { templateId?: string; routePath?: string },
    ) => {
      judged.push([previous, next]);
      return (
        previous.routePath === next.routePath &&
        previous.templateId === "index" &&
        next.templateId === "route-doc"
      );
    };
    const { rerender } = renderHook(
      ({ templateId, routePath }) =>
        useEditorContextReset({ templateId, routePath, onReset, isSamePage }),
      { initialProps: { templateId: "index", routePath: "/about" } },
    );

    rerender({ templateId: "route-doc", routePath: "/about" });
    expect(onReset).not.toHaveBeenCalled();

    // Back to the index is a real change, judged from the route document.
    rerender({ templateId: "index", routePath: "/about" });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(judged.at(-1)).toEqual([
      { templateId: "route-doc", routePath: "/about" },
      { templateId: "index", routePath: "/about" },
    ]);

    // A route change is reset whatever the template.
    rerender({ templateId: "route-doc", routePath: "/contact" });
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
