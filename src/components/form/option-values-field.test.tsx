import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionValuesField } from "./option-values-field";

/**
 * Creatable choices, used by the product Organize step for types and tags.
 *
 * In that mode the caller identifies a choice by its own value, so a value the
 * author just typed is selected before it exists in `choices`. The selection
 * has to survive that gap — rebuilding it from `choices` alone silently drops
 * the new value the moment anything else is toggled.
 */
const CHOICES = [
  { id: "shirt", value: "shirt" },
  { id: "trousers", value: "trousers" },
];

// cmdk's search box is also a combobox, so the trigger is found by the
// attribute only it carries.
const openDropdown = (container: HTMLElement) => {
  const trigger = container.querySelector("[aria-expanded]");
  if (!trigger) throw new Error("trigger not found");
  fireEvent.click(trigger);
};

describe("OptionValuesField, creatable choices", () => {
  it("keeps a just-created value when another choice is picked", () => {
    const onSelectionChange = vi.fn();

    const { container } = render(
      <OptionValuesField
        name="tags"
        choices={CHOICES}
        // "summer" exists only in the selection, as it would right after the
        // author created it and before the list refetches.
        selectedIds={["summer"]}
        onSelectionChange={onSelectionChange}
        allowCreate
      />,
    );

    openDropdown(container);
    fireEvent.click(screen.getByText("shirt"));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0][0]).toEqual(["shirt", "summer"]);
  });

  it("shows a chip for a value that is not among the choices", () => {
    render(
      <OptionValuesField
        name="tags"
        choices={CHOICES}
        selectedIds={["summer"]}
        onSelectionChange={vi.fn()}
        allowCreate
      />,
    );

    // Asserted through the chip's remove control: its label is unique, while
    // the value itself also appears in the hidden field the form submits.
    expect(
      screen.getByRole("button", { name: "Remove summer" }),
    ).toBeDefined();
  });

  it("does not offer to create a value that already exists", () => {
    const { container } = render(
      <OptionValuesField
        name="tags"
        choices={CHOICES}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
        allowCreate
      />,
    );

    openDropdown(container);
    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "shirt" },
    });

    expect(screen.queryByText(/^Create/)).toBeNull();
  });
});

describe("OptionValuesField without a selection handler", () => {
  const hiddenValue = (container: HTMLElement) =>
    (container.querySelector('input[name="tags"]') as HTMLInputElement).value;

  it("still records a pick", () => {
    // `RouteFormPage` renders fields declaratively and submits natively, so it
    // passes no handler. Purely controlled meant clicking a choice on the Add
    // Options and Organization pages did nothing at all.
    const { container } = render(
      <OptionValuesField name="tags" choices={CHOICES} selectedIds={[]} />,
    );

    openDropdown(container);
    fireEvent.click(screen.getByText("shirt"));

    expect(JSON.parse(hiddenValue(container))).toEqual(["shirt"]);
  });

  it("follows the caller when it owns the value", () => {
    // The create wizard seeds an option after its values load, so the field has
    // to accept a value arriving later.
    const { container, rerender } = render(
      <OptionValuesField
        name="tags"
        choices={CHOICES}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
      />,
    );

    rerender(
      <OptionValuesField
        name="tags"
        choices={CHOICES}
        selectedIds={["trousers"]}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(JSON.parse(hiddenValue(container))).toEqual(["trousers"]);
  });
});
