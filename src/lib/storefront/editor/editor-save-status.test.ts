import { describe, expect, it } from "vitest";
import {
  editorSaveStatusLabel,
  resolveEditorSaveState,
} from "./editor-save-status";

const none = { saving: false, outOfDate: false, failed: false, unsaved: false };

describe("resolveEditorSaveState", () => {
  it("is unsaved while an edit waits to be sent", () => {
    expect(resolveEditorSaveState({ ...none, unsaved: true })).toBe("unsaved");
  });

  it("is saving only while a request is out", () => {
    expect(resolveEditorSaveState({ ...none, saving: true })).toBe("saving");
    // An older write still out, a newer edit waiting: not saved either way.
    expect(
      resolveEditorSaveState({ ...none, saving: true, unsaved: true }),
    ).toBe("saving");
  });

  it("keeps a failure or a conflict ahead of a newer unsent edit", () => {
    expect(
      resolveEditorSaveState({ ...none, failed: true, unsaved: true }),
    ).toBe("failed");
    expect(
      resolveEditorSaveState({ ...none, outOfDate: true, failed: true }),
    ).toBe("out-of-date");
  });

  it("is saved only when nothing is waiting, out or refused", () => {
    expect(resolveEditorSaveState(none)).toBe("saved");
  });
});

describe("editorSaveStatusLabel", () => {
  const label = (
    saveState: Parameters<typeof editorSaveStatusLabel>[0]["saveState"],
    hasUnpublishedChanges = true,
  ) =>
    editorSaveStatusLabel({
      publishing: false,
      saveState,
      hasUnpublishedChanges,
    });

  it("never shows the publish state for an edit that is not stored", () => {
    // The bug: "Unpublished" stood beside an edit nothing had sent yet.
    expect(label("unsaved")).toBe("Unsaved");
    expect(label("saving")).toBe("Saving…");
    expect(label("failed")).toBe("Save failed");
    expect(label("out-of-date")).toBe("Out of date");
  });

  it("shows the publish state once everything is stored", () => {
    expect(label("saved", true)).toBe("Unpublished");
    expect(label("saved", false)).toBe("Published");
  });

  it("names a source save error", () => {
    expect(
      editorSaveStatusLabel({
        publishing: false,
        saveState: "failed",
        failure: "Theme source moved on elsewhere",
        hasUnpublishedChanges: true,
      }),
    ).toBe("Save failed: Theme source moved on elsewher…");
  });
});
