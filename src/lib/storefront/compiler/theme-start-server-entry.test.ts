import { describe, expect, it } from "vitest";
import {
  resolveThemeStartServerEntry,
  THEME_START_SERVER_ENTRY_PATHS,
} from "./theme-start-toolchain";
import { collectThemeImportProtectionDiagnosticsForBuild } from "./theme-import-protection";

describe("Theme Start server entry", () => {
  it("falls back only when no conventional entry exists", () => {
    expect(resolveThemeStartServerEntry([])).toBe(
      "@tanstack/react-start/server-entry",
    );
    expect(
      resolveThemeStartServerEntry([
        { path: "src/server.jsx" },
        { path: "src/server.ts" },
      ]),
    ).toBe("./src/server.ts");
  });
  it.each(THEME_START_SERVER_ENTRY_PATHS)("selects and protects %s", (path) => {
    expect(resolveThemeStartServerEntry([{ path }])).toBe(`./${path}`);
    const diagnostics = collectThemeImportProtectionDiagnosticsForBuild(
      [
        { path, content: 'import "./widget.client.ts"; export default {};' },
        { path: "src/widget.client.ts", content: "export const value = 1;" },
      ],
      {
        entry: "src/routes/index.tsx",
        hasStartRuntime: true,
        nativeStartCompilation: true,
      },
    );
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.code === "THEME_IMPORT_CLIENT_IN_SERVER",
      ),
    ).toBe(true);
  });
});
