import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TailwindClassTokenInput } from "./tailwind-class-token-input";

describe("TailwindClassTokenInput", () => {
  it("shows each applied class as a removable badge", () => {
    const onValueChange = vi.fn();
    render(
      <TailwindClassTokenInput
        value="grid lg:hover:bg-red-500 w-[calc(100%_-_2rem)]"
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getByText("grid")).toBeTruthy();
    expect(screen.getByText("lg:hover:bg-red-500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove grid" }));
    expect(onValueChange).toHaveBeenLastCalledWith(
      "lg:hover:bg-red-500 w-[calc(100%_-_2rem)]",
    );
  });

  it("suggests and adds a class with the keyboard", () => {
    const onValueChange = vi.fn();
    render(<TailwindClassTokenInput value="flex" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "Add Tailwind CSS class" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bg-red-5" } });
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("bg-red-50");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith("flex bg-red-50");
  });

  it("supports free-form classes, backspace removal, and multi-class paste", () => {
    const onValueChange = vi.fn();
    render(<TailwindClassTokenInput value="flex gap-4" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "Add Tailwind CSS class" });

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onValueChange).toHaveBeenLastCalledWith("flex");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "hover:custom-card px-6" },
    });
    expect(onValueChange).toHaveBeenLastCalledWith("flex hover:custom-card px-6");
  });

  it("prevents editing while disabled", () => {
    const onValueChange = vi.fn();
    render(
      <TailwindClassTokenInput value="flex" onValueChange={onValueChange} disabled />,
    );
    expect(
      (screen.getByRole("textbox", { name: "Add Tailwind CSS class" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Remove flex" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
