import { describe, expect, it } from "vitest";
import { planThemeFileCopies } from "./theme-file-copy";

const file = (path: string) => ({
  path,
  content: `// ${path}`,
  mimeType: "text/typescript",
});

describe("planThemeFileCopies", () => {
  it("copies a file into a folder and allocates a VSCode-style copy name", () => {
    const plan = planThemeFileCopies({
      files: [file("src/Hero.tsx"), file("src/ui/Hero.tsx")],
      selectedPaths: ["src/Hero.tsx"],
      destinationFolder: "src/ui",
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [{ path: "src/ui/Hero-copy.tsx" }],
    });
  });

  it("copies a folder tree atomically and preserves empty folders", () => {
    const plan = planThemeFileCopies({
      files: [file("src/cards/Hero.tsx"), file("src/cards/nested/Copy.tsx")],
      selectedPaths: ["src/cards"],
      destinationFolder: "src/ui",
      pendingFolders: ["src/cards/empty"],
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [
        { path: "src/ui/cards/Hero.tsx" },
        { path: "src/ui/cards/nested/Copy.tsx" },
      ],
    });
    if (plan.ok) {
      expect(plan.createdFolders).toContain("src/ui/cards/empty");
    }
  });

  it("rejects copying a folder into itself", () => {
    expect(
      planThemeFileCopies({
        files: [file("src/cards/Hero.tsx")],
        selectedPaths: ["src/cards"],
        destinationFolder: "src/cards/nested",
      }),
    ).toEqual({
      ok: false,
      reason: "A folder cannot be copied inside itself.",
    });
  });
});
