import { describe, expect, it } from "vitest";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import { prepareNewThemeFolder } from "./new-theme-folder";

describe("prepareNewThemeFolder", () => {
  it("normalizes a folder name relative to its parent", () => {
    expect(prepareNewThemeFolder("  pages\\blog  ", "src", [])).toEqual({
      ok: true,
      path: "src/pages/blog",
    });
  });

  it("collapses repeated separators before creating a nested folder", () => {
    expect(
      prepareNewThemeFolder("pages//blog///posts", "src//content", []),
    ).toEqual({
      ok: true,
      path: "src/content/pages/blog/posts",
    });
  });

  it("rejects unsafe or empty names", () => {
    expect(prepareNewThemeFolder("", "", [])).toEqual({
      ok: false,
      message: "Enter a folder name.",
    });
    expect(prepareNewThemeFolder("../escape", "src", [])).toMatchObject({
      ok: false,
    });
    expect(prepareNewThemeFolder("node_modules", "", [])).toMatchObject({
      ok: false,
    });
  });

  it("rejects non-canonical paths at the shared storage boundary", () => {
    expect(safeThemeFilePathSchema.safeParse("src/content//pages").success).toBe(
      false,
    );
  });

  it("refuses paths already represented by a file or folder", () => {
    expect(
      prepareNewThemeFolder("components", "src", ["src/components/App.tsx"]),
    ).toEqual(
      {
        ok: false,
        message: 'The folder "src/components" already exists.',
      },
    );
    expect(
      prepareNewThemeFolder("Hero.tsx", "src/components", [
        "src/components/Hero.tsx",
      ]),
    ).toEqual({
      ok: false,
      message: 'A file already exists at "src/components/Hero.tsx".',
    });
    expect(prepareNewThemeFolder("pages", "", [], ["pages"])).toEqual({
      ok: false,
      message: 'The folder "pages" already exists.',
    });
  });
});
