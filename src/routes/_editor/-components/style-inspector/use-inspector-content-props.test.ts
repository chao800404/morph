import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  sameInspectorContentValue,
  useInspectorContentProps,
} from "./use-inspector-content-props";

describe("sameInspectorContentValue", () => {
  it("compares nested arrays and objects by value", () => {
    expect(
      sameInspectorContentValue(
        { items: [{ title: "A" }, { title: "B" }] },
        { items: [{ title: "A" }, { title: "B" }] },
      ),
    ).toBe(true);
    expect(
      sameInspectorContentValue(
        { items: [{ title: "A" }] },
        { items: [{ title: "B" }] },
      ),
    ).toBe(false);
  });
});

describe("useInspectorContentProps", () => {
  it("rebases untouched keys while preserving a local edit", () => {
    const { result, rerender } = renderHook(
      ({ props }) =>
        useInspectorContentProps({
          resourceKey: "store:theme",
          sectionId: "hero",
          sectionProps: props,
        }),
      { initialProps: { props: { title: "Original", color: "black" } } },
    );

    act(() => {
      result.current.localPropsRef.current = {
        title: "Typing",
        color: "black",
      };
      result.current.setLocalProps({ title: "Typing", color: "black" });
    });
    rerender({ props: { title: "Original", color: "white" } });

    expect(result.current.props).toEqual({ title: "Typing", color: "white" });
  });

  it("replaces the snapshot when the section changes", () => {
    const { result, rerender } = renderHook(
      ({ sectionId, props }) =>
        useInspectorContentProps({
          resourceKey: "store:theme",
          sectionId,
          sectionProps: props,
        }),
      {
        initialProps: {
          sectionId: "hero",
          props: { title: "Hero" },
        },
      },
    );

    rerender({ sectionId: "footer", props: { title: "Footer" } });

    expect(result.current.props).toEqual({ title: "Footer" });
  });
});
