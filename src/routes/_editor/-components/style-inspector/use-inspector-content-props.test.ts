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

  it("settles for a section that has no props", () => {
    // Bounded on purpose: the loop this guards against never ends by itself,
    // so an unbounded count would hang the test instead of failing it.
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      if (renders > 20) throw new Error("render loop: 20 renders and counting");
      return useInspectorContentProps({
        resourceKey: "store:theme",
        sectionId: "hero",
        sectionProps: undefined,
      });
    });

    expect(result.current.props).toEqual({});
    expect(renders).toBeLessThanOrEqual(3);
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

  it("counts a newer server value only for the keys the author had not changed", () => {
    const { result, rerender } = renderHook(
      ({ props }) =>
        useInspectorContentProps({
          resourceKey: "store:theme",
          sectionId: "hero",
          sectionProps: props,
        }),
      {
        initialProps: {
          props: { title: "Original", body: "Body", color: "black" } as Record<
            string,
            unknown
          >,
        },
      },
    );
    expect(result.current.externalEpochs).toEqual({});

    act(() => {
      const typing = { title: "Typing", body: "Body", color: "black" };
      result.current.localPropsRef.current = typing;
      result.current.setLocalProps(typing);
    });
    // Someone else changes title and body; color is unchanged.
    rerender({
      props: { title: "Theirs", body: "Their body", color: "black" },
    });

    expect(result.current.props).toEqual({
      title: "Typing",
      body: "Their body",
      color: "black",
    });
    expect(result.current.externalEpochs).toEqual({ body: 1 });

    // The same read again changes nothing shown.
    rerender({
      props: { title: "Theirs", body: "Their body", color: "black" },
    });
    expect(result.current.externalEpochs).toEqual({ body: 1 });
  });
});
