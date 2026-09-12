// @vitest-environment node
import { describe, expect, it } from "vitest";
import { refuseThemeWorkspacePath } from "./theme-workspace-path";

describe("what may be written into a container workspace", () => {
  it("accepts an ordinary Theme file", () => {
    for (const path of [
      "src/components/Hero.tsx",
      "src/routes/index.tsx",
      "src/styles/global.css",
    ]) {
      expect(refuseThemeWorkspacePath(path)).toBeNull();
    }
  });

  it("refuses a path that climbs out of the workspace", () => {
    for (const path of [
      "../etc/passwd",
      "src/../../escape.tsx",
      "/etc/passwd",
    ]) {
      expect(refuseThemeWorkspacePath(path)).toContain("WORKSPACE_PATH_ESCAPE");
    }
  });

  it("refuses anything inside node_modules, however it is spelled", () => {
    for (const path of [
      "node_modules/evil.js",
      "src/node_modules/evil.js",
      "src/NODE_MODULES/evil.js",
    ]) {
      expect(refuseThemeWorkspacePath(path)).toContain("RESERVED_THEME_PATH");
    }
  });

  it("refuses a file the platform owns", () => {
    expect(refuseThemeWorkspacePath("vite.config.ts")).toContain(
      "RESERVED_THEME_BUILD_PATH",
    );
  });

  it("sees a backslash the same way it sees a slash", () => {
    // Otherwise a Windows-shaped path would walk straight past every rule.
    expect(refuseThemeWorkspacePath("..\\..\\etc\\passwd")).toContain(
      "WORKSPACE_PATH_ESCAPE",
    );
    expect(refuseThemeWorkspacePath("src\\node_modules\\evil.js")).toContain(
      "RESERVED_THEME_PATH",
    );
  });
});
