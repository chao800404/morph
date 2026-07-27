import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditCard } from "./edit-card";

vi.mock("@views/features/global-edit/use-edit-store", () => ({
  useEditStore: () => ({ setEditData: vi.fn(), setOpen: vi.fn() }),
}));

const FIELDS = [{ key: "handle", label: "Handle", value: "shirts" }];

// Radix opens a dropdown on pointerdown, not click, and jsdom does not
// synthesise the former from the latter.
const openMenu = () => {
  const trigger = screen.getByRole("button");
  fireEvent.pointerDown(
    trigger,
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
};

describe("EditCard", () => {
  it("shows no actions menu on a read-only card", () => {
    // Neither `onSave` nor `onEdit`: nothing to offer, so the trigger would be
    // a dead control.
    render(<EditCard id="c" title="Organize" fields={FIELDS} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses onEdit instead of the built-in dialog when given", () => {
    const onEdit = vi.fn();
    render(
      <EditCard id="c" title="Category" fields={FIELDS} onEdit={onEdit} />,
    );

    openMenu();
    fireEvent.click(screen.getByText("Edit"));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("renders a field's displayValue over its raw value", () => {
    render(
      <EditCard
        id="c"
        title="Category"
        fields={[{ ...FIELDS[0], displayValue: "/shirts" }]}
      />,
    );

    expect(screen.getByText("/shirts")).toBeDefined();
    expect(screen.queryByText("shirts")).toBeNull();
  });
});
