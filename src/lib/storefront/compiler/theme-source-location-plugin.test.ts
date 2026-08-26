import { describe, expect, it } from "vitest";
import { parseThemeSourceLocation } from "./theme-source-location-plugin";

describe("parseThemeSourceLocation", () => {
  it("parses an injected location", () => {
    expect(parseThemeSourceLocation("src/components/Hero.tsx:23:5")).toEqual({
      filePath: "src/components/Hero.tsx",
      line: 23,
      column: 5,
    });
  });

  it("refuses anything that could not address theme source", () => {
    // A tampered attribute must never become a source edit target.
    for (const value of [
      null,
      undefined,
      "",
      "Hero.tsx:1:1",
      "../secret.tsx:1:1",
      "src/..\\evil.tsx:1:1",
      "src/a.tsx:0:1",
      "src/a.tsx:1:0",
      "src/a.tsx:x:1",
      "src/a.tsx",
      `src/a.tsx:1:${"9".repeat(500)}`,
    ]) {
      expect(parseThemeSourceLocation(value as string), String(value)).toBeNull();
    }
  });

  it("keeps colons inside the path intact", () => {
    expect(parseThemeSourceLocation("src/a:b.tsx:4:2")).toEqual({
      filePath: "src/a:b.tsx",
      line: 4,
      column: 2,
    });
  });
});
