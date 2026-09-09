/**
 * Restoring a version is a destructive act presented as a recovery one.
 *
 * Rollback replaces every file rather than merging, so the panel's job is to
 * make the cost visible before it is agreed to: which files come back, and
 * which are deleted to get there. These cover the parts a mistake would be
 * silent in — an unsaved edit destroyed without a trace, or a deletion the
 * author never saw coming.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ThemeRollbackPlan } from "@/lib/storefront/editor/theme-rollback-plan";
import {
  EditorCodeHistoryPanel,
  type EditorCodeRevision,
} from "./editor-code-history-panel";

const revisions: EditorCodeRevision[] = [
  {
    id: "r2",
    revisionNumber: 2,
    message: "Rewrote the header",
    source: "manual",
    createdAt: "2026-09-08T15:00:00.000Z",
  },
  {
    id: "r1",
    revisionNumber: 1,
    message: null,
    source: "publish",
    createdAt: "2026-09-07T10:00:00.000Z",
  },
];

const plan = (overrides?: Partial<ThemeRollbackPlan>): ThemeRollbackPlan => ({
  restored: [],
  rewritten: [],
  removed: [],
  unchanged: [],
  ...overrides,
});

function renderPanel(overrides?: Partial<Parameters<typeof EditorCodeHistoryPanel>[0]>) {
  const onRollback = vi.fn();
  const onSelectRevision = vi.fn();
  render(
    <EditorCodeHistoryPanel
      revisions={revisions}
      isLoading={false}
      selectedRevisionNumber={1}
      onSelectRevision={onSelectRevision}
      plan={plan({ restored: ["src/components/Header.tsx"] })}
      isPlanLoading={false}
      onRollback={onRollback}
      isRollingBack={false}
      {...overrides}
    />,
  );
  return { onRollback, onSelectRevision };
}

describe("the source history panel", () => {
  it("names the files a restore would bring back", () => {
    renderPanel();

    expect(screen.getByText("Restored · 1")).toBeTruthy();
    expect(screen.getByText("src/components/Header.tsx")).toBeTruthy();
  });

  it("warns before deleting work done since the version", () => {
    renderPanel({
      plan: plan({ removed: ["src/components/New.tsx"] }),
    });

    expect(screen.getByText("Deleted · 1")).toBeTruthy();
    expect(screen.getByText(/will be deleted/)).toBeTruthy();
  });

  it("refuses to restore over unsaved edits", () => {
    const { onRollback } = renderPanel({
      blockedReason: "Save your open changes first — 1 file has unsaved edits.",
    });

    const button = screen.getByRole("button", { name: /Restore version/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("says nothing would change rather than offering an empty restore", () => {
    renderPanel({ plan: plan() });

    expect(screen.getByText(/already matches this version/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore version/ })).toBeNull();
  });

  it("restores the version that was actually inspected", () => {
    const { onRollback } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Restore version/ }));

    expect(onRollback).toHaveBeenCalledWith(1);
  });

  it("falls back to the kind of version when it has no message", () => {
    renderPanel();

    expect(screen.getByText("Rewrote the header")).toBeTruthy();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
  });
});
