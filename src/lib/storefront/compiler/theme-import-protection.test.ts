import { describe, expect, it } from "vitest";
import {
  collectThemeImportProtectionDiagnostics,
  collectThemeImportProtectionDiagnosticsForBuild,
} from "./theme-import-protection";

const file = (path: string, content: string) => ({ path, content });

describe("theme import protection", () => {
  it("blocks a .server module from a reachable client entry", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file("src/pages/index.tsx", 'import data from "../data.server"; export default data;'),
        file("src/data.server.ts", "export default 'secret';"),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_SERVER_IN_CLIENT",
          filePath: "src/pages/index.tsx",
          importSource: "../data.server",
          target: "client",
        }),
      ]),
    );
  });

  it("blocks a .client module from a reachable server route", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file("src/routes/index.tsx", 'import Widget from "../widget.client"; export const Route = Widget;'),
        file("src/widget.client.tsx", "export default () => null;"),
      ],
      { target: "server", entryPaths: ["src/routes/index.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_CLIENT_IN_SERVER",
          filePath: "src/routes/index.tsx",
          importSource: "../widget.client",
          target: "server",
        }),
      ]),
    );
  });

  it("honors TanStack server-only and client-only marker imports", () => {
    const clientDiagnostics = collectThemeImportProtectionDiagnostics(
      [
        file("src/pages/index.tsx", 'import "@tanstack/react-start/server-only"; export default () => null;'),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );
    expect(clientDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_MARKER",
          importSource: "@tanstack/react-start/server-only",
        }),
      ]),
    );

    const serverDiagnostics = collectThemeImportProtectionDiagnostics(
      [
        file("src/routes/index.tsx", 'import "@tanstack/react-start/client-only"; export const Route = {};'),
      ],
      { target: "server", entryPaths: ["src/routes/index.tsx"] },
    );
    expect(serverDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_MARKER",
          importSource: "@tanstack/react-start/client-only",
        }),
      ]),
    );
  });

  it("checks all route files in a Start build, matching the generated route tree graph", () => {
    const diagnostics = collectThemeImportProtectionDiagnosticsForBuild(
      [
        file("src/router.tsx", "export function getRouter() { return {}; }"),
        file("src/routes/__root.tsx", "export const Route = {};"),
        file(
          "src/routes/about.tsx",
          'import secret from "../secret.server"; export const Route = secret;',
        ),
        file("src/secret.server.ts", "export default 'secret';"),
      ],
      { entry: "src/routes/about.tsx", hasStartRuntime: true },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_SERVER_IN_CLIENT",
          filePath: "src/routes/about.tsx",
        }),
      ]),
    );
  });

  it("does not flag an unreachable server-only file in a client-only build", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file("src/pages/index.tsx", "export default () => null;"),
        file("src/secret.server.ts", "export default 'secret';"),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("resolves tsconfig path aliases before checking server/client boundaries", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "tsconfig.json",
          JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
        ),
        file("src/pages/index.tsx", 'import secret from "@/secret.server"; export default secret;'),
        file("src/secret.server.ts", "export default 'secret';"),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_SERVER_IN_CLIENT",
          importSource: "@/secret.server",
        }),
      ]),
    );
  });

  it("allows Start server imports used only inside an isomorphic server boundary", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/router.tsx",
          'import { createIsomorphicFn } from "@tanstack/react-start"; import { getRequest } from "@tanstack/react-start/server"; export const value = createIsomorphicFn().server(() => getRequest());',
        ),
      ],
      { target: "client", entryPaths: ["src/router.tsx"] },
    );

    expect(diagnostics).toHaveLength(0);
  });

  it("blocks a direct Start server import that is outside a compiler boundary", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/pages/index.tsx",
          'import { getRequest } from "@tanstack/react-start/server"; export default () => String(getRequest());',
        ),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_SERVER_IN_CLIENT",
          importSource: "@tanstack/react-start/server",
        }),
      ]),
    );
  });

  it("checks optional Start server and start entry points in the server graph", () => {
    const diagnostics = collectThemeImportProtectionDiagnosticsForBuild(
      [
        file("src/router.tsx", "export function getRouter() { return {}; }"),
        file("src/routes/__root.tsx", "export const Route = {};"),
        file(
          "src/server.ts",
          'import Widget from "./widget.client"; export default Widget;',
        ),
        file("src/widget.client.tsx", "export default () => null;"),
      ],
      { entry: "src/routes/__root.tsx", hasStartRuntime: true },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "THEME_IMPORT_CLIENT_IN_SERVER",
          filePath: "src/server.ts",
        }),
      ]),
    );
  });
});
