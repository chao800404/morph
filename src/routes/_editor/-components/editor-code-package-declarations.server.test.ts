// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Imported on the server only if the guard is gone; the test then fails here.
const imported = vi.hoisted(() => ({ count: 0 }));
vi.mock("./editor-code-package-declarations.generated", () => {
  imported.count += 1;
  return { GENERATED_THEME_PACKAGE_DECLARATIONS: [] };
});

import {
  getGeneratedThemePackageDeclarations,
  preloadGeneratedThemePackageDeclarations,
} from "./editor-code-package-types";

describe("the package declarations on the server", () => {
  it("are never loaded, and read as none, as they always have", async () => {
    // The server build's `import.meta.env.SSR`: what drops the `import()`
    // and with it the multi-megabyte chunk from the Worker bundle.
    expect(import.meta.env.SSR).toBe(true);

    await expect(preloadGeneratedThemePackageDeclarations()).resolves.toEqual(
      [],
    );
    expect(getGeneratedThemePackageDeclarations()).toEqual([]);
    expect(imported.count).toBe(0);
  });
});
