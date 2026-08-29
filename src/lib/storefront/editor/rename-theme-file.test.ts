import { describe, expect, it } from "vitest";
import { prepareThemeFileRename } from "./rename-theme-file";

const existing = [
  "src/components/Hero.tsx",
  "src/components/Other.tsx",
  "morph.theme.json",
];

describe("prepareThemeFileRename", () => {
  it("keeps the parent directory while renaming the file", () => {
    expect(
      prepareThemeFileRename("Promo.tsx", "src/components/Hero.tsx", existing),
    ).toEqual({ ok: true, path: "src/components/Promo.tsx" });
  });

  it("allows confirming the unchanged name", () => {
    expect(
      prepareThemeFileRename("Hero.tsx", "src/components/Hero.tsx", existing),
    ).toEqual({ ok: true, path: "src/components/Hero.tsx" });
  });

  it("rejects empty, nested, unsafe, generated, and duplicate names", () => {
    expect(prepareThemeFileRename("", existing[0]!, existing).ok).toBe(false);
    expect(
      prepareThemeFileRename("nested/Promo.tsx", existing[0]!, existing).ok,
    ).toBe(false);
    expect(
      prepareThemeFileRename("../Promo.tsx", existing[0]!, existing).ok,
    ).toBe(false);
    expect(
      prepareThemeFileRename("Other.tsx", existing[0]!, existing),
    ).toEqual({ ok: false, message: '"src/components/Other.tsx" already exists.' });
    expect(
      prepareThemeFileRename("vite.config.ts", "Hero.tsx", existing),
    ).toMatchObject({ ok: false });
  });
});
