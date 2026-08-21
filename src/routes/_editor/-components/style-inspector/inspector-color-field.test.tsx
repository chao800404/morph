import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InspectorColorField } from "./inspector-color-field";

describe("InspectorColorField", () => {
  it("previews while editing and commits only when editing finishes", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "#d8d0c3" } });
    expect(onPreview).toHaveBeenLastCalledWith("#d8d0c3");
    expect(onCommit).not.toHaveBeenCalled();

    rerender(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    expect((input as HTMLInputElement).value).toBe("#d8d0c3");

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#d8d0c3");
  });

  it("restores the confirmed value when an invalid color is finished", () => {
    const onCommit = vi.fn();
    render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={vi.fn()}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.input(input, { target: { value: "not-a-color" } });
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe("#fafaf9");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels a text edit without committing on Escape", () => {
    const onCommit = vi.fn();
    render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={vi.fn()}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.input(input, { target: { value: "#d8d0c3" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect((input as HTMLInputElement).value).toBe("#fafaf9");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
