import { describe, expect, it } from "vitest";
import { diffLines, LINE_DIFF_MAX_CELLS } from "./line-diff";

describe("diffLines", () => {
  it("keeps common lines and marks what is dropped and gained", () => {
    expect(diffLines("a\nb\nc\n", "a\nx\nc\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("treats a new file as all added and a deleted one as all removed", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { kind: "added", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(diffLines("a", "")).toEqual([{ kind: "removed", text: "a" }]);
  });

  it("reads equal texts as unchanged", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("gives up on texts too long to compare here", () => {
    const side = Math.ceil(Math.sqrt(LINE_DIFF_MAX_CELLS));
    const long = Array.from(
      { length: side },
      (_, index) => `line ${index}`,
    ).join("\n");
    expect(diffLines(long, `${long}\nmore`)).toBeNull();
  });
});
