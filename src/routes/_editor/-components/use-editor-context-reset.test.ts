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
});
