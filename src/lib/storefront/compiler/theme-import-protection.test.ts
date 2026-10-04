import { describe, expect, it } from "vitest";
import {
  collectThemeImportProtectionDiagnostics,
  collectThemeImportProtectionDiagnosticsForBuild,
} from "./theme-import-protection";

const file = (path: string, content: string) => ({ path, content });

describe("theme import protection", () => {
  describe("native Start local server boundaries", () => {
    const routePath = "src/routes/index.tsx";
    const helper = file(
      "src/data.server.ts",
      "export const data = () => 'private';",
    );
    const check = (source: string, nativeStartCompilation: boolean) =>
      collectThemeImportProtectionDiagnosticsForBuild(
        [file(routePath, source), helper],
        { entry: routePath, hasStartRuntime: true, nativeStartCompilation },
      );

    it.each([
      'import { createServerFn } from "@tanstack/react-start"; import { data } from "../data.server"; export const action = createServerFn().handler(() => data());',
      'import { createFileRoute } from "@tanstack/react-router"; import { data } from "../data.server"; export const Route = createFileRoute("/")({ server: { handlers: { GET: () => new Response(data()) } } });',
    ])(
      "permits native handler bindings, but keeps legacy artifacts blocked: %s",
      (source) => {
        expect(check(source, true)).toEqual([]);
        expect(check(source, false)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "THEME_IMPORT_SERVER_IN_CLIENT" }),
          ]),
        );
      },
    );

    it.each([
      [
        "component leak",
        'import { createServerFn } from "@tanstack/react-start"; import { data } from "../data.server"; export const action = createServerFn().handler(() => data()); export default () => <div>{data()}</div>;',
      ],
      ["side effect", 'import "../data.server"; export default () => null;'],
      [
        "dynamic import",
        'import { createServerFn } from "@tanstack/react-start"; export const action = createServerFn().handler(async () => (await import("../data.server")).data());',
      ],
      [
        "static plus dynamic import",
        'import { createServerFn } from "@tanstack/react-start"; import { data } from "../data.server"; export const action = createServerFn().handler(() => data()); export const leaked = import("../data.server");',
      ],
      [
        "fake factory",
        'import { data } from "../data.server"; const createServerFn = () => ({ handler: (fn: any) => fn() }); export const action = createServerFn().handler(() => data());',
      ],
      [
        "re-export",
        'import { data } from "../data.server"; export { data } from "../data.server";',
      ],
    ])("still rejects %s with native compilation enabled", (_name, source) => {
      expect(check(source, true)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "THEME_IMPORT_SERVER_IN_CLIENT",
            filePath: routePath,
          }),
        ]),
      );
    });

    it("rejects a server-only module that is itself a client root", () => {
      const diagnostics = collectThemeImportProtectionDiagnosticsForBuild(
        [file("src/routes/thing.server.ts", "export const data = 'private';")],
        {
          entry: "src/routes/thing.server.ts",
          hasStartRuntime: true,
          nativeStartCompilation: true,
        },
      );
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "THEME_IMPORT_SERVER_IN_CLIENT",
            filePath: "src/routes/thing.server.ts",
          }),
        ]),
      );
    });

    it("the paired server pass still inspects a helper skipped by the client pass", () => {
      const files = [
        file(
          routePath,
          'import { createServerFn } from "@tanstack/react-start"; import { data } from "../data.server"; export const action = createServerFn().handler(() => data());',
        ),
        file(
          "src/data.server.ts",
          'import { browser } from "./browser.client"; export const data = () => browser;',
        ),
        file("src/browser.client.ts", "export const browser = 'browser';"),
      ];
      expect(
        collectThemeImportProtectionDiagnostics(files, {
          target: "client",
          entryPaths: [routePath],
          nativeStartCompilation: true,
        }),
      ).toEqual([]);
      expect(
        collectThemeImportProtectionDiagnosticsForBuild(files, {
          entry: routePath,
          hasStartRuntime: true,
          nativeStartCompilation: true,
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "THEME_IMPORT_CLIENT_IN_SERVER",
            filePath: "src/data.server.ts",
            importSource: "./browser.client",
            target: "server",
          }),
        ]),
      );
    });
  });
  it("blocks a .server module from a reachable client entry", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/pages/index.tsx",
          'import data from "../data.server"; export default data;',
        ),
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
        file(
          "src/routes/index.tsx",
          'import Widget from "../widget.client"; export const Route = Widget;',
        ),
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
        file(
          "src/pages/index.tsx",
          'import "@tanstack/react-start/server-only"; export default () => null;',
        ),
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
        file(
          "src/routes/index.tsx",
          'import "@tanstack/react-start/client-only"; export const Route = {};',
        ),
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
        file(
          "src/pages/index.tsx",
          'import secret from "@/secret.server"; export default secret;',
        ),
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

  it("allows Start server imports used only in a file route's server handlers", () => {
    // Start removes the `server` property from the client build, so this is
    // how its own documentation writes a server route that reads a cookie.
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/routes/api/cookie.ts",
          'import { createFileRoute } from "@tanstack/react-router"; import { getCookie } from "@tanstack/react-start/server"; export const Route = createFileRoute("/api/cookie")({ server: { handlers: { GET: async () => Response.json({ value: getCookie("a") }) } } });',
        ),
      ],
      { target: "client", entryPaths: ["src/routes/api/cookie.ts"] },
    );

    expect(diagnostics).toHaveLength(0);
  });

  it.each([
    'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/api/test")({ server: { handlers: { GET: () => helper() } } });',
    'import { createServerFn } from "@tanstack/react-start"; export const action = createServerFn().handler(() => helper());',
  ])(
    "keeps uncompiled client-only preview conservative for local .server helpers",
    (source) => {
      const files = [
        file(
          "src/routes/test.tsx",
          'import { helper } from "../helper.server"; ' + source,
        ),
        file(
          "src/helper.server.ts",
          'import { getRequest } from "@tanstack/react-start/server"; export const helper = () => getRequest();',
        ),
      ];
      expect(
        collectThemeImportProtectionDiagnostics(files, {
          target: "client",
          entryPaths: ["src/routes/test.tsx"],
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "THEME_IMPORT_SERVER_IN_CLIENT" }),
        ]),
      );
      expect(
        collectThemeImportProtectionDiagnostics(files, {
          target: "server",
          entryPaths: ["src/routes/test.tsx"],
        }),
      ).toEqual([]);
    },
  );

  it.each([
    'import { helper } from "../helper.server"; import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/test")({ component: () => helper(), server: { handlers: { GET: () => helper() } } });',
    'import "../helper.server"; import { createServerFn } from "@tanstack/react-start"; export const action = createServerFn().handler(() => 1);',
    'import { helper } from "../helper.server"; const createServerFn = () => ({ handler: (fn: any) => fn() }); export const action = createServerFn().handler(() => helper());',
    'export { helper } from "../helper.server";',
  ])(
    "still refuses local .server code used by the client, side effects, fake factories or re-exports",
    (source) => {
      const diagnostics = collectThemeImportProtectionDiagnostics(
        [
          file("src/routes/test.tsx", source),
          file(
            "src/helper.server.ts",
            "export const helper = () => 'private';",
          ),
        ],
        { target: "client", entryPaths: ["src/routes/test.tsx"] },
      );
      expect(
        diagnostics.some(
          (item) => item.code === "THEME_IMPORT_SERVER_IN_CLIENT",
        ),
      ).toBe(true);
    },
  );

  it("still blocks the same import when it is used outside the route's server property", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/routes/page.tsx",
          'import { createFileRoute } from "@tanstack/react-router"; import { getCookie } from "@tanstack/react-start/server"; export const Route = createFileRoute("/page")({ component: () => String(getCookie("a")), server: { handlers: { GET: async () => new Response("ok") } } });',
        ),
      ],
      { target: "client", entryPaths: ["src/routes/page.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_IMPORT_SERVER_IN_CLIENT" }),
      ]),
    );
  });

  it("does not treat any other `server` property as a server route", () => {
    const diagnostics = collectThemeImportProtectionDiagnostics(
      [
        file(
          "src/pages/index.tsx",
          'import { getRequest } from "@tanstack/react-start/server"; export const config = { server: () => getRequest() };',
        ),
      ],
      { target: "client", entryPaths: ["src/pages/index.tsx"] },
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "THEME_IMPORT_SERVER_IN_CLIENT" }),
      ]),
    );
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
