import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Command, CommandInput } from "./command";

describe("CommandInput", () => {
  it("notifies a controlled input when Clear is selected", () => {
    const onValueChange = vi.fn();
    render(
      <Command>
        <CommandInput value="asset" onValueChange={onValueChange} />
      </Command>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("shows a spinner beside Clear while loading", () => {
    render(
      <Command>
        <CommandInput value="asset" loading />
      </Command>,
    );

    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });
});
