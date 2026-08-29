import { describe, expect, it } from "vitest";
import { prepareNewThemeFolder } from "./new-theme-folder";

describe("prepareNewThemeFolder", () => {
  it("normalizes a folder name relative to its parent", () => {
    expect(prepareNewThemeFolder("  pages\\blog  ", "src", [])).toEqual({
      ok: true,
      path: "src/pages/blog",
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
