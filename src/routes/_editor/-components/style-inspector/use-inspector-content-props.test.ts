import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

  describe("held input", () => {
    const held: Record<string, Record<string, unknown> | undefined> = {};
    const render = (initial: { sectionId: string; props: unknown }) =>
      renderHook(
        ({ sectionId, props }) =>
          useInspectorContentProps({
            resourceKey: "store:theme:doc",
            sectionId,
            sectionProps: props,
            heldProps: () => held[sectionId],
          }),
        { initialProps: initial },
      );

    it("is shown over the stored props on mount, key by key", () => {
      held.hero = { title: "Kept" };
      const { result } = render({
        sectionId: "hero",
        props: { title: "Stored", body: "Body" },
      });
      expect(result.current.props).toEqual({ title: "Kept", body: "Body" });
      delete held.hero;
    });

    it("is shown when the section opened is switched to, and only that section's", () => {
      held.hero = { title: "Kept" };
      const { result, rerender } = render({
        sectionId: "footer",
        props: { title: "Footer" },
      });
      expect(result.current.props).toEqual({ title: "Footer" });
      rerender({ sectionId: "hero", props: { title: "Stored", body: "Body" } });
      expect(result.current.props).toEqual({ title: "Kept", body: "Body" });
      delete held.hero;
    });

    it("stays over a newer stored copy, while untouched keys take it and are counted", () => {
      held.hero = { title: "Kept" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Stored", body: "Body" },
      });
      rerender({
        sectionId: "hero",
        props: { title: "Stored", body: "Their body" },
      });
      expect(result.current.props).toEqual({
        title: "Kept",
        body: "Their body",
      });
      expect(result.current.externalEpochs).toEqual({ body: 1 });
      delete held.hero;
    });

    it("none held: the stored props as they are", () => {
      const { result } = render({
        sectionId: "hero",
        props: { title: "Stored", body: "Body" },
      });
      expect(result.current.props).toEqual({ title: "Stored", body: "Body" });
    });
  });

  describe("held input opened on an accepted copy newer than the one shown (M1)", () => {
    // W1 wrote title "Edited" and was answered; the panel is handed the copy
    // from before it ("Original") until the next render. The author typed
    // "Original" back, which the editor holds (staged on the accepted copy).
    const held: Record<string, Record<string, unknown> | undefined> = {};
    const accepted: Record<string, Record<string, unknown> | undefined> = {};
    const render = (initial: { sectionId: string; props: unknown }) =>
      renderHook(
        ({ sectionId, props }) =>
          useInspectorContentProps({
            resourceKey: "store:theme:doc",
            sectionId,
            sectionProps: props,
            heldProps: () => held[sectionId],
            acceptedProps: () => accepted[sectionId],
          }),
        { initialProps: initial },
      );
    afterEach(() => {
      for (const key of Object.keys(held)) delete held[key];
      for (const key of Object.keys(accepted)) delete accepted[key];
    });

    it("on mount: the rendered answer does not replace the held value", () => {
      held.hero = { title: "Original" };
      accepted.hero = { title: "Edited", body: "Body" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Original", body: "Body" },
      });
      expect(result.current.props).toEqual({ title: "Original", body: "Body" });

      rerender({ sectionId: "hero", props: { title: "Edited", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Original", body: "Body" });
      expect(result.current.externalEpochs).toEqual({});
    });

    it("on a section switch back: the rendered answer does not replace the held value", () => {
      held.hero = { title: "Original" };
      accepted.hero = { title: "Edited", body: "Body" };
      const { result, rerender } = render({
        sectionId: "footer",
        props: { title: "Footer" },
      });
      rerender({
        sectionId: "hero",
        props: { title: "Original", body: "Body" },
      });
      expect(result.current.props).toEqual({ title: "Original", body: "Body" });

      rerender({ sectionId: "hero", props: { title: "Edited", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Original", body: "Body" });
      expect(result.current.externalEpochs).toEqual({});
    });

    it("moves only held keys: another key still takes a newer stored value", () => {
      held.hero = { title: "Original" };
      accepted.hero = { title: "Edited", body: "Body" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Original", body: "Body" },
      });

      rerender({
        sectionId: "hero",
        props: { title: "Edited", body: "Their body" },
      });

      expect(result.current.props).toEqual({
        title: "Original",
        body: "Their body",
      });
      expect(result.current.externalEpochs).toEqual({ body: 1 });
    });

    it("without an accepted copy named, rebases on the stored props as before", () => {
      held.hero = { title: "Original" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Original", body: "Body" },
      });

      rerender({ sectionId: "hero", props: { title: "Edited", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Edited", body: "Body" });
      expect(result.current.externalEpochs).toEqual({ title: 1 });
    });

    it("a held value equal to the accepted copy is not kept over a later change", () => {
      held.hero = { title: "Edited" };
      accepted.hero = { title: "Edited", body: "Body" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Original", body: "Body" },
      });
      expect(result.current.props).toEqual({ title: "Edited", body: "Body" });

      rerender({ sectionId: "hero", props: { title: "Theirs", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Theirs", body: "Body" });
      expect(result.current.externalEpochs).toEqual({ title: 1 });
    });
  });

  describe("an input made on an accepted copy newer than the one shown", () => {
    const render = () =>
      renderHook(
        ({ props }) =>
          useInspectorContentProps({
            resourceKey: "store:theme",
            sectionId: "hero",
            sectionProps: props,
          }),
        {
          initialProps: {
            props: { title: "Original", body: "Body" } as Record<
              string,
              unknown
            >,
          },
        },
      );
    /** The author leaves `title` as `value`, as `handleFieldChange` does. */
    const authorSets = (
      result: ReturnType<typeof render>["result"],
      value: string,
      accepted: Record<string, unknown> | undefined,
    ) =>
      act(() => {
        result.current.noteLocalInput("title", accepted);
        const next = { ...result.current.localPropsRef.current, title: value };
        result.current.localPropsRef.current = next;
        result.current.setLocalProps(next);
      });

    it("keeps the earlier value typed back when the answered write renders", () => {
      const { result, rerender } = render();
      // W1 ("Edited") was answered; the shown copy is still "Original".
      authorSets(result, "Edited", { title: "Original", body: "Body" });
      authorSets(result, "Original", { title: "Edited", body: "Body" });
      rerender({ props: { title: "Edited", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Original", body: "Body" });
      expect(result.current.externalEpochs).toEqual({});
    });

    it("without an accepted copy, rebases as before", () => {
      const { result, rerender } = render();
      authorSets(result, "Edited", undefined);
      authorSets(result, "Original", undefined);
      rerender({ props: { title: "Edited", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Edited", body: "Body" });
      expect(result.current.externalEpochs).toEqual({ title: 1 });
    });

    it("moves only the changed key: another key still takes a newer server value", () => {
      const { result, rerender } = render();
      authorSets(result, "Original", {
        title: "Edited",
        body: "Accepted body",
      });
      rerender({ props: { title: "Edited", body: "Their body" } });

      expect(result.current.props).toEqual({
        title: "Original",
        body: "Their body",
      });
      expect(result.current.externalEpochs).toEqual({ body: 1 });
    });

    it("a value equal to the accepted copy is not kept over a later change", () => {
      const { result, rerender } = render();
      // No change against the accepted copy: someone else's later value wins.
      authorSets(result, "Original", { title: "Original", body: "Body" });
      rerender({ props: { title: "Theirs", body: "Body" } });

      expect(result.current.props).toEqual({ title: "Theirs", body: "Body" });
      expect(result.current.externalEpochs).toEqual({ title: 1 });
    });
  });

  // H1 (review of the M1/M2 follow-up to #399). In production `heldProps` is
  // the section's pending entry's `props`, and for an Inspector input that is
  // the Inspector's whole copy of the section (`{ ...pending.props, ...next }`
  // with `next` the whole `localProps`), not only the field the author held.
  // These tests hand the hook that shape: `title` is the field really held,
  // `body` is an untouched key carried along at its older value.
  describe("H1: held props are the Inspector's whole copy, only one key really held", () => {
    const held: Record<string, Record<string, unknown> | undefined> = {};
    const accepted: Record<string, Record<string, unknown> | undefined> = {};
    const render = (initial: { sectionId: string; props: unknown }) =>
      renderHook(
        ({ sectionId, props }) =>
          useInspectorContentProps({
            resourceKey: "store:theme:doc",
            sectionId,
            sectionProps: props,
            heldProps: () => held[sectionId],
            acceptedProps: () => accepted[sectionId],
          }),
        { initialProps: initial },
      );
    afterEach(() => {
      for (const key of Object.keys(held)) delete held[key];
      for (const key of Object.keys(accepted)) delete accepted[key];
    });

    it("H1 (M1 openedBaseline): an untouched key carried in the held copy takes the accepted value when the context renders it", () => {
      // W1 changed body to "New body" and was answered; the context the panel
      // opens from is still the copy before it. The author typed a title,
      // which is held; the held copy carries body at the old value.
      held.hero = { title: "Typed", body: "Old body" };
      accepted.hero = { title: "Original", body: "New body" };
      const { result, rerender } = render({
        sectionId: "hero",
        props: { title: "Original", body: "Old body" },
      });
      expect(result.current.props).toEqual({
        title: "Typed",
        body: "Old body",
      });

      // The context renders W1's copy.
      rerender({
        sectionId: "hero",
        props: { title: "Original", body: "New body" },
      });

      expect(
        result.current.props,
        "body was never changed in this panel: it must adopt W1's value",
      ).toEqual({ title: "Typed", body: "New body" });
    });

    it("H1 (withHeld, pre-existing): an untouched key carried in the held copy does not hide a newer stored value on open", () => {
      // The author typed a title, which is held with the whole copy (body at
      // "Old body"). Another writer then changed body, and that copy was read
      // in. The panel opens the section on it; no accepted copy is named, so
      // only `withHeld` is in play.
      held.hero = { title: "Typed", body: "Old body" };
      const { result } = render({
        sectionId: "hero",
        props: { title: "Original", body: "New body" },
      });

      expect(
        result.current.props,
        "only the held title goes over the stored props",
      ).toEqual({ title: "Typed", body: "New body" });
    });
  });
});

describe("adoptAcceptedValue", () => {
  it("shows the accepted value as unchanged, remounts that key only, and keeps other drafts", () => {
    const stale = { heading: "Hi", items: [{ id: "a" }, { id: "b" }] };
    const { result, rerender } = renderHook(
      ({ sectionProps }) =>
        useInspectorContentProps({
          resourceKey: "page",
          sectionId: "hero",
          sectionProps,
        }),
      { initialProps: { sectionProps: stale as unknown } },
    );
    act(() => {
      result.current.setLocalProps({ ...stale, heading: "Draft" });
      result.current.localPropsRef.current = { ...stale, heading: "Draft" };
    });
    act(() => result.current.adoptAcceptedValue("items", [{ id: "a" }]));
    expect(result.current.props).toEqual({
      heading: "Draft",
      items: [{ id: "a" }],
    });
    expect(result.current.externalEpochs).toEqual({ items: 1 });

    // The copy with that list renders: nothing moves, the draft stays.
    rerender({ sectionProps: { heading: "Hi", items: [{ id: "a" }] } });
    expect(result.current.props).toEqual({
      heading: "Draft",
      items: [{ id: "a" }],
    });
    // A later copy with another list is adopted: the list counts as unchanged.
    rerender({
      sectionProps: { heading: "Hi", items: [{ id: "a" }, { id: "x" }] },
    });
    expect(result.current.props.items).toEqual([{ id: "a" }, { id: "x" }]);
  });

  it("an accepted value of undefined removes the key", () => {
    // One object across renders, as the editor passes it.
    const sectionProps = { items: [{ id: "a" }] };
    const { result } = renderHook(() =>
      useInspectorContentProps({
        resourceKey: "page",
        sectionId: "hero",
        sectionProps,
      }),
    );
    act(() => result.current.adoptAcceptedValue("items", undefined));
    expect(result.current.props).toEqual({});
  });
});
