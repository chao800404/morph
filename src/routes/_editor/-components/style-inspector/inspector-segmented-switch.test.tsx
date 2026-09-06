import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorSegmentedSwitch } from "./inspector-segmented-switch";

describe("InspectorSegmentedSwitch", () => {
  const options = [
    { id: "one", label: "One" },
    { id: "two", label: "Two" },
  ] as const;

  it("renders options and highlights the active one", () => {
    render(
      <InspectorSegmentedSwitch
        value="one"
        options={options}
        onChange={() => {}}
      />,
    );

    const btnOne = screen.getByRole("button", { name: "One" });
    const btnTwo = screen.getByRole("button", { name: "Two" });

    expect(btnOne.hasAttribute("disabled")).toBe(true);
    expect(btnTwo.hasAttribute("disabled")).toBe(false);
  });

  it("calls onChange when an inactive option is clicked", () => {
    const onChange = vi.fn();
    render(
      <InspectorSegmentedSwitch
        value="one"
        options={options}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(onChange).toHaveBeenCalledWith("two");
  });
});
