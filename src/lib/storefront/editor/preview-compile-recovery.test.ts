import { describe, expect, it } from "vitest";
import { createPreviewCompileRecovery } from "./preview-compile-recovery";

describe("replacing a frame whose Theme did not compile", () => {
  it("loads a new frame once for a fix written after the failure", () => {
    const recovery = createPreviewCompileRecovery();
    recovery.noteDocumentStarted("frame-1");
    expect(recovery.takeReload("frame-1")).toBe(false);

    recovery.noteSourceWritten();
    expect(recovery.takeReload("frame-1")).toBe(true);
    // The same write never buys a second frame.
    expect(recovery.takeReload("frame-1")).toBe(false);
  });

  it("does not loop when the new frame fails again on the same source", () => {
    const recovery = createPreviewCompileRecovery();
    recovery.noteDocumentStarted("frame-1");
    recovery.noteSourceWritten();
    expect(recovery.takeReload("frame-1")).toBe(true);

    recovery.noteDocumentStarted("frame-2");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(recovery.takeReload("frame-2")).toBe(false);
    }
    // The next write is the next chance, and only one.
    recovery.noteSourceWritten();
    expect(recovery.takeReload("frame-2")).toBe(true);
    expect(recovery.takeReload("frame-2")).toBe(false);
  });

  it("replaces a document whose failure arrives after a write it never compiled", () => {
    // The write landed while the page was still loading the source before it.
    const recovery = createPreviewCompileRecovery();
    recovery.noteDocumentStarted("frame-1");
    recovery.noteSourceWritten();
    expect(recovery.takeReload("frame-1")).toBe(true);
  });

  it("keeps a document that reloaded in place after the write it failed on", () => {
    // Vite reloads a page in place when a hot update fails: that document
    // started after the write and failed on it, so another frame would fail
    // the same way.
    const recovery = createPreviewCompileRecovery();
    recovery.noteDocumentStarted("frame-1");
    recovery.noteSourceWritten();
    recovery.noteDocumentStarted("frame-1");
    expect(recovery.takeReload("frame-1")).toBe(false);
  });

  it("does not credit one frame's document to another", () => {
    const recovery = createPreviewCompileRecovery();
    recovery.noteSourceWritten();
    recovery.noteDocumentStarted("frame-2");
    expect(recovery.takeReload("frame-1")).toBe(true);
  });
});
