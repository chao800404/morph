import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("keeps the content ref stable across updates while open", () => {
    // React 19 ref cleanup must not turn each content update into a repeated
    // null/node state update inside Radix FocusScope. Publish media checks
    // update this content after the confirmation popover has opened.
    const contentRef = vi.fn();
    const panel = (label: string) => (
      <Popover defaultOpen>
        <PopoverTrigger>Publish</PopoverTrigger>
        <PopoverContent ref={contentRef}>
          <button>{label}</button>
        </PopoverContent>
      </Popover>
    );
    const view = render(panel("Checking media"));
    const original = screen.getByRole("dialog");
    contentRef.mockClear();
    for (let index = 0; index < 20; index += 1) {
      view.rerender(panel(`Publish revision ${index}`));
    }
    expect(screen.getByRole("dialog")).toBe(original);
    expect(contentRef).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Publish revision 19" }),
    ).toBeTruthy();
    fireEvent.keyDown(original, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
