import { fireEvent, render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { CommandBar } from "./command-bar";

describe("CommandBar", () => {
  it("renders shared secondary and primary actions", () => {
    const onClear = vi.fn();
    const onDelete = vi.fn();
    const onEdit = vi.fn();

    render(
      <CommandBar
        open
        value="3 selected"
        onClear={onClear}
        actions={[
          {
            label: "Delete",
            icon: <Trash2 />,
            destructive: true,
            iconOnly: true,
            onAction: onDelete,
          },
        ]}
        primaryAction={{ label: "Edit", onAction: onEdit }}
      />,
    );

    expect(
      screen.getByRole("toolbar", { name: "Selection actions" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "3 selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("runs a displayed shortcut unless focus is in an editable control", () => {
    const onRemove = vi.fn();

    render(
      <>
        <input aria-label="Search" />
        <CommandBar
          open
          value="2 selected"
          actions={[
            {
              label: "Remove",
              shortcut: "R",
              onAction: onRemove,
            },
          ]}
        />
      </>,
    );

    fireEvent.keyDown(window, { key: "r" });
    expect(onRemove).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), {
      key: "r",
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does not mount a toolbar when closed", () => {
    render(<CommandBar open={false} value="0 selected" />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
