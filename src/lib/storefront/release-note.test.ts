import { describe, expect, it } from "vitest";
import {
  MAX_RELEASE_NOTE_LENGTH,
  normalizeReleaseNote,
  readReleaseNote,
  withReleaseNote,
} from "./release-note";

describe("normalizeReleaseNote", () => {
  it("keeps what a person wrote", () => {
    expect(normalizeReleaseNote("Reworded the hero")).toBe("Reworded the hero");
  });

  it("treats blank input as no note rather than an empty one", () => {
    expect(normalizeReleaseNote("   ")).toBeUndefined();
    expect(normalizeReleaseNote("")).toBeUndefined();
    expect(normalizeReleaseNote(undefined)).toBeUndefined();
    expect(normalizeReleaseNote(null)).toBeUndefined();
  });

  it("ignores a value that is not text", () => {
    expect(normalizeReleaseNote({ note: "x" })).toBeUndefined();
    expect(normalizeReleaseNote(42)).toBeUndefined();
  });

  it("bounds the length so one release cannot carry an essay", () => {
    const long = "a".repeat(MAX_RELEASE_NOTE_LENGTH + 50);
    expect(normalizeReleaseNote(long)).toHaveLength(MAX_RELEASE_NOTE_LENGTH);
  });
});

describe("withReleaseNote", () => {
  it("writes a note onto empty metadata", () => {
    expect(withReleaseNote(null, "Hero copy")).toEqual({ note: "Hero copy" });
  });

  it("keeps other metadata a release already carries", () => {
    // The column is shared free-form metadata, so writing a note must not be a
    // way to silently drop everything else stored on the release.
    expect(withReleaseNote({ source: "editor" }, "Hero copy")).toEqual({
      source: "editor",
      note: "Hero copy",
    });
  });

  it("removes the note when it is cleared, without touching the rest", () => {
    expect(withReleaseNote({ source: "editor", note: "old" }, "  ")).toEqual({
      source: "editor",
    });
  });

  it("returns null when clearing leaves nothing behind", () => {
    expect(withReleaseNote({ note: "old" }, undefined)).toBeNull();
  });
});

describe("readReleaseNote", () => {
  it("reads a stored note", () => {
    expect(readReleaseNote({ note: "Hero copy" })).toBe("Hero copy");
  });

  it("reports no note for metadata that has none", () => {
    expect(readReleaseNote(null)).toBeUndefined();
    expect(readReleaseNote({})).toBeUndefined();
    expect(readReleaseNote({ source: "editor" })).toBeUndefined();
  });

  it("ignores a note that is not text", () => {
    expect(readReleaseNote({ note: 12 } as never)).toBeUndefined();
  });
});
