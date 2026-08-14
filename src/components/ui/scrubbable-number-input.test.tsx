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
});
