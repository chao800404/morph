import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorSourceConflictNotice } from "./editor-source-conflict-notice";

describe("EditorSourceConflictNotice", () => {
  it("renders nothing while every save has gone through", () => {
    const { container } = render(
      <EditorSourceConflictNotice paths={[]} saving={false} onSave={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("says the edits are still here and not saved, and offers to save them", () => {
    const onSave = vi.fn();
    render(
      <EditorSourceConflictNotice
        paths={["src/components/Hero.tsx"]}
        saving={false}
        onSave={onSave}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(
      "Remote source changes detected in this theme",
    );
    expect(notice.textContent).toContain(
      "Your changes to Hero.tsx are still here in this tab, but not saved yet.",
    );
    // No button that reads as throwing the local edits away.
    expect(screen.queryByRole("button", { name: /accept remote/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save my changes" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("names a few files and counts the rest", () => {
    render(
      <EditorSourceConflictNotice
        paths={[
          "src/a.tsx",
          "src/b.tsx",
          "src/c.tsx",
          "src/d.tsx",
          "src/e.tsx",
        ]}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Your changes to a.tsx, b.tsx, c.tsx and 2 more",
    );
  });

  it("cannot be pressed again while saving", () => {
    render(
      <EditorSourceConflictNotice
        paths={["src/a.tsx"]}
        saving
        onSave={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
