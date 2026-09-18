import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScrubbableNumberInput } from "./scrubbable-number-input";

describe("ScrubbableNumberInput", () => {
  it("uses a surface-free input inside compact toolbars", () => {
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        suffix="%"
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });

    const classNames = input.className.split(/\s+/);
    expect(classNames).toEqual(
      expect.arrayContaining(["bg-transparent", "shadow-none", "border-0"]),
    );
    expect(classNames).not.toContain("focus-visible:ring-[3px]");
    expect(classNames).not.toContain("focus-visible:ring-ring/50");
    expect(classNames).not.toContain("bg-background");
    expect(classNames).not.toContain("shadow-xs");
    expect(classNames).not.toContain("dark:bg-input/30");
  });

  it("accepts typed values and clamps them to its boundary", () => {
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        suffix="%"
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input);

    expect(onValueChange).toHaveBeenLastCalledWith(200);
  });

  it("accepts typed values between scrub increments without native step mismatch", () => {
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={28}
        min={0}
        max={10_000}
        step={4}
        ariaLabel="Section padding"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Section padding",
    }) as HTMLInputElement;
    expect(input.getAttribute("step")).toBe("any");
    input.focus();
    fireEvent.change(input, { target: { value: "30" } });
    expect(input.validity.stepMismatch).toBe(false);
    fireEvent.submit(input.closest("form")!);

    expect(onValueChange).toHaveBeenLastCalledWith(30);
  });

  it("uses the control increment for arrow keys without snapping typed decimals", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={1}
        min={0}
        max={100}
        step={0.25}
        ariaLabel="Spacing in rem"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Spacing in rem",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.3" } });
    expect(onValuePreview).toHaveBeenLastCalledWith(1.3);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("1.55");
    expect(onValuePreview).toHaveBeenLastCalledWith(1.55);
    fireEvent.blur(input);

    expect(onValueChange).toHaveBeenLastCalledWith(1.55);
  });

  it("previews typed values without committing until editing completes", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "125" } });

    expect((input as HTMLInputElement).value).toBe("125");
    expect(onValuePreview).toHaveBeenLastCalledWith(125);
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith(125);
  });

  it("commits a typed value exactly once when the form is submitted", () => {
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    input.focus();
    fireEvent.change(input, { target: { value: "125" } });
    fireEvent.submit(input.closest("form")!);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith(125);
  });

  it("restores the live preview without committing when Escape is pressed", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "125" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect((input as HTMLInputElement).value).toBe("100");
    expect(onValuePreview).toHaveBeenLastCalledWith(100);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("previews horizontal scrubbing and commits the final value", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        step={1}
        scrubPixelsPerStep={2}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    Object.defineProperty(input, "setPointerCapture", {
      value: vi.fn(),
    });

    fireEvent.pointerDown(input, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 120 });
    fireEvent.pointerUp(input, { pointerId: 1, clientX: 120 });

    expect(onValuePreview).toHaveBeenLastCalledWith(110);
    expect(onValueChange).toHaveBeenLastCalledWith(110);
  });

  /**
   * The count, not the value.
   *
   * The test above already asserted what a scrub ends up committing, with
   * `toHaveBeenLastCalledWith` and a single move — which passes just as well if
   * every step of the drag commits. That is the failure this control exists to
   * avoid: `onValueChange` is wired to the Inspector's write path, so one call
   * per pointer event is a persistent write per pointer event.
   *
   * Twenty steps, because one cannot tell "once at the end" from "once per
   * move".
   */
  it("commits nothing while a drag is in flight, and exactly once when it ends", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        step={1}
        scrubPixelsPerStep={2}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    Object.defineProperty(input, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 100 });
    for (let step = 1; step <= 20; step += 1) {
      fireEvent.pointerMove(input, { pointerId: 1, clientX: 100 + step * 2 });
    }

    expect(
      onValueChange,
      "a drag committed before the pointer was released",
    ).toHaveBeenCalledTimes(0);
    // The preview is the thing that is allowed to be continuous: it is what
    // makes the canvas follow the pointer.
    expect(onValuePreview.mock.calls.length).toBeGreaterThan(1);

    fireEvent.pointerUp(input, { pointerId: 1, clientX: 140 });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(120);
  });

  /**
   * A press that never moved is a focus, not an edit. Without this, "commits
   * exactly once" could be satisfied by committing on every release.
   */
  it("commits nothing when a press never became a drag", () => {
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        step={1}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    Object.defineProperty(input, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(input, { pointerId: 1, clientX: 100 });

    expect(onValueChange).toHaveBeenCalledTimes(0);
  });

  it("keeps accumulating movement while the pointer is locked at a screen edge", () => {
    const onValuePreview = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        step={1}
        scrubPixelsPerStep={2}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={onValuePreview}
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    Object.defineProperty(input, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(input, "requestPointerLock", {
      value: vi.fn(() => {
        Object.defineProperty(document, "pointerLockElement", {
          configurable: true,
          value: input,
        });
      }),
    });
    Object.defineProperty(document, "exitPointerLock", {
      configurable: true,
      value: vi.fn(() => {
        Object.defineProperty(document, "pointerLockElement", {
          configurable: true,
          value: null,
        });
      }),
    });

    fireEvent.pointerDown(input, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(input, {
      pointerId: 1,
      clientX: 100,
      movementX: 10,
    });
    fireEvent.pointerMove(input, {
      pointerId: 1,
      clientX: 100,
      movementX: 10,
    });
    fireEvent.pointerUp(input, { pointerId: 1, clientX: 100 });

    expect(onValuePreview).toHaveBeenLastCalledWith(110);
    expect(onValueChange).toHaveBeenLastCalledWith(110);
    expect(document.pointerLockElement).toBeNull();
  });

  it("does not overwrite an active typed draft when value props update", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole("spinbutton", {
      name: "Canvas zoom percentage",
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "125" } });
    rerender(
      <ScrubbableNumberInput
        value={100}
        min={25}
        max={200}
        ariaLabel="Canvas zoom percentage"
        onValuePreview={vi.fn()}
        onValueChange={onValueChange}
      />,
    );
    expect((input as HTMLInputElement).value).toBe("125");
  });
});
