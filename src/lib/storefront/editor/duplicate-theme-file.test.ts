import { describe, expect, it } from "vitest";
import { prepareDuplicateThemeFile } from "./duplicate-theme-file";

describe("prepareDuplicateThemeFile", () => {
  it("uses the first available copy name", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero.tsx", [
      "src/components/Hero.tsx",
    ]);

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/Hero-copy.tsx",
      mimeType: "text/typescript",
    });
  });

  it("increments the copy suffix when earlier copies exist", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero.tsx", [
      "src/components/Hero.tsx",
      "src/components/Hero-copy.tsx",
      "src/components/Hero-copy-2.tsx",
    ]);

    expect(result).toMatchObject({
      ok: true,
      path: "src/components/Hero-copy-3.tsx",
    });
  });

  it("preserves extensionless paths for validation", () => {
    const result = prepareDuplicateThemeFile("src/components/Hero", [
      "src/components/Hero",
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("can be created");
  });
});
