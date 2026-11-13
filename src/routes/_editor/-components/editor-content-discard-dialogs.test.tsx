import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ListDiscardDialog,
  SectionDiscardDialog,
} from "./editor-content-discard-dialogs";

/**
 * Task 41 31-E: the confirmation the shell opens for a list-only discard.
 * The shell decides whether an unanswered write touches the same list
 * (`hasUnconfirmedContentForList`); this is what the author can press then.
 */
describe("the list-only discard confirmation", () => {
  const target = { sectionLabel: "Featured", fieldPath: "items" };

  it("cannot be confirmed while the same list has an unanswered write", () => {
    const onConfirm = vi.fn();
    render(
      <ListDiscardDialog
        target={target}
        hasUnconfirmedWrite
        hasSavedChange={false}
        discarding={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", {
      name: "Discard list changes and load latest",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "this list has an unconfirmed write",
    );
  });

  it("can be confirmed once nothing of that list is unanswered", () => {
    const onConfirm = vi.fn();
    render(
      <ListDiscardDialog
        target={target}
        hasUnconfirmedWrite={false}
        hasSavedChange
        discarding={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", {
      name: "Discard list changes and load latest",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("Someone else changed items in Featured");
    expect(text).toContain("A saved change is not undone.");
    expect(text).not.toContain("unconfirmed write");
  });

  it("cannot be confirmed twice while the latest version loads", () => {
    render(
      <ListDiscardDialog
        target={target}
        hasUnconfirmedWrite={false}
        hasSavedChange={false}
        discarding
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Discard list changes and load latest",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("the section discard confirmation (Discard mine)", () => {
  it("states every section and field it discards, and nothing else", () => {
    const onConfirm = vi.fn();
    render(
      <SectionDiscardDialog
        open
        sections={[
          {
            sectionLabel: "hero",
            lists: ["items"],
            fields: ["heading", "items"],
          },
        ]}
        hasUnconfirmedWrite={false}
        hasSavedChange={false}
        discarding={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("Someone else changed items in hero");
    expect(text).toContain(
      "all of your unsaved changes to hero (heading, items)",
    );
    expect(text).toContain("Other sections keep their changes");
    fireEvent.click(
      screen.getByRole("button", { name: "Discard and load latest" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cannot be confirmed while one of those sections has an unanswered write", () => {
    const onConfirm = vi.fn();
    render(
      <SectionDiscardDialog
        open
        sections={[
          { sectionLabel: "hero", lists: ["items"], fields: ["items"] },
        ]}
        hasUnconfirmedWrite
        hasSavedChange={false}
        discarding={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", {
      name: "Discard and load latest",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
