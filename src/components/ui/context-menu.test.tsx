import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "./context-menu";

// Radix selects an item on a `pointerup` with no matching `pointerdown`.
// Chromium opens the menu on the right button's press, so that button's
// release over a (collision-flipped) item must not select it.
function releasePointer(target: Element, button: number) {
  fireEvent(
    target,
    new MouseEvent("pointerup", { bubbles: true, cancelable: true, button }),
  );
}

function renderMenu() {
  const onSelect = vi.fn();
  const onClick = vi.fn();
  const onPointerUp = vi.fn();
  const onCheckedChange = vi.fn();
  const onValueChange = vi.fn();
  render(
    <ContextMenu>
      <ContextMenuTrigger>Row</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={onClick}>Delete</ContextMenuItem>
        <ContextMenuItem onSelect={onSelect} onPointerUp={onPointerUp}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuCheckboxItem onCheckedChange={onCheckedChange}>
          Pinned
        </ContextMenuCheckboxItem>
        <ContextMenuRadioGroup value="a" onValueChange={onValueChange}>
          <ContextMenuRadioItem value="a">Alpha</ContextMenuRadioItem>
          <ContextMenuRadioItem value="b">Beta</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Row"));
  return { onSelect, onClick, onPointerUp, onCheckedChange, onValueChange };
}

const item = (name: string) => screen.getByRole("menuitem", { name });

describe("ContextMenu", () => {
  it("ignores the secondary button's release over every item kind", () => {
    const calls = renderMenu();
    releasePointer(item("Rename"), 2);
    releasePointer(item("Delete"), 2);
    releasePointer(screen.getByRole("menuitemcheckbox", { name: "Pinned" }), 2);
    releasePointer(screen.getByRole("menuitemradio", { name: "Beta" }), 2);
    expect(calls.onSelect).not.toHaveBeenCalled();
    expect(calls.onClick).not.toHaveBeenCalled();
    expect(calls.onCheckedChange).not.toHaveBeenCalled();
    expect(calls.onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("keeps the guard when the caller passes its own onPointerUp", () => {
    const calls = renderMenu();
    releasePointer(item("Duplicate"), 2);
    expect(calls.onPointerUp).toHaveBeenCalledTimes(1);
    expect(calls.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();

    releasePointer(item("Duplicate"), 0);
    expect(calls.onPointerUp).toHaveBeenCalledTimes(2);
    expect(calls.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still selects on a primary-button release", () => {
    const { onSelect } = renderMenu();
    releasePointer(item("Rename"), 0);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still toggles checkbox and radio items with the primary button", () => {
    const calls = renderMenu();
    releasePointer(screen.getByRole("menuitemcheckbox", { name: "Pinned" }), 0);
    expect(calls.onCheckedChange).toHaveBeenCalledWith(true);

    fireEvent.contextMenu(screen.getByText("Row"));
    releasePointer(screen.getByRole("menuitemradio", { name: "Beta" }), 0);
    expect(calls.onValueChange).toHaveBeenCalledWith("b");
  });

  it.each(["Enter", " "])("still selects with the %j key", (key) => {
    const calls = renderMenu();
    fireEvent.keyDown(item("Rename"), { key });
    expect(calls.onSelect).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(screen.getByText("Row"));
    fireEvent.keyDown(
      screen.getByRole("menuitemcheckbox", { name: "Pinned" }),
      { key },
    );
    expect(calls.onCheckedChange).toHaveBeenCalledWith(true);

    fireEvent.contextMenu(screen.getByText("Row"));
    fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "Beta" }), {
      key,
    });
    expect(calls.onValueChange).toHaveBeenCalledWith("b");
  });
});
