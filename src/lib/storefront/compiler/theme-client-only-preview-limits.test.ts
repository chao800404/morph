import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_ONLY_PREVIEW_LIMITS,
  collectThemeClientOnlyPreviewLimits,
  themePreviewRuntimeReport,
} from "./theme-client-only-preview-limits";
import { STARTER_THEME_CATALOG_FILES } from "../starter-theme-catalog-files";
import { STARTER_THEME_FILES } from "../starter-theme-files";

const file = (path: string, content: string) => ({ path, content });
const collect = (path: string, content: string) =>
  collectThemeClientOnlyPreviewLimits([file(path, content)]);

describe("client-only preview limits", () => {
  it("reports a createServerFn call at its line", () => {
    expect(
      collect(
        "src/routes/index.tsx",
        [
          'import { createServerFn } from "@tanstack/react-start";',
          "",
          "export const getHome = createServerFn().handler(() => 1);",
        ].join("\n"),
      ),
    ).toEqual([
      { file: "src/routes/index.tsx", line: 3, kind: "createServerFn" },
    ]);
  });

  it("follows an aliased import", () => {
    expect(
      collect(
        "src/lib/data.ts",
        [
          'import { createServerFn as serverFn, createServerOnlyFn as only } from "@tanstack/react-start";',
          "export const a = serverFn({ method: 'GET' }).handler(() => 1);",
          "export const b = only(() => 2);",
        ].join("\n"),
      ),
    ).toEqual([
      { file: "src/lib/data.ts", line: 2, kind: "createServerFn" },
      { file: "src/lib/data.ts", line: 3, kind: "createServerOnlyFn" },
    ]);
  });

  it("follows a namespace import", () => {
    expect(
      collect(
        "src/lib/data.ts",
        'import * as Start from "@tanstack/react-start";\nexport const a = Start.createServerFn().handler(() => 1);',
      ),
    ).toEqual([{ file: "src/lib/data.ts", line: 2, kind: "createServerFn" }]);
  });

  it("reports a route's server handlers", () => {
    expect(
      collect(
        "src/routes/api/users.ts",
        [
          'import { createFileRoute } from "@tanstack/react-router";',
          'export const Route = createFileRoute("/api/users")({',
          "  server: { handlers: { GET: () => new Response('[]') } },",
          "});",
        ].join("\n"),
      ),
    ).toEqual([
      { file: "src/routes/api/users.ts", line: 3, kind: "server-route" },
    ]);
  });

  it("reports a server API used outside any stripped boundary", () => {
    expect(
      collect(
        "src/lib/cookie.ts",
        'import { getCookie } from "@tanstack/react-start/server";\nexport const theme = () => getCookie("theme");',
      ),
    ).toEqual([
      {
        file: "src/lib/cookie.ts",
        line: 1,
        kind: "server-api",
        names: ["getCookie"],
      },
    ]);
  });

  it("reports the server function, not the server API inside its handler", () => {
    expect(
      collect(
        "src/lib/cookie.ts",
        [
          'import { createServerFn } from "@tanstack/react-start";',
          'import { getCookie } from "@tanstack/react-start/server";',
          'export const theme = createServerFn().handler(() => getCookie("theme"));',
        ].join("\n"),
      ),
    ).toEqual([
      { file: "src/lib/cookie.ts", line: 3, kind: "createServerFn" },
    ]);
  });

  describe("reports nothing for", () => {
    it.each([
      ["no Start import", "export const a = () => 1;"],
      [
        "a type-only import",
        'import type { createServerFn } from "@tanstack/react-start";\nexport type A = typeof createServerFn;',
      ],
      [
        "an imported but unused createServerFn",
        'import { createServerFn } from "@tanstack/react-start";\nexport const a = 1;',
      ],
      [
        "a local function of the same name",
        "function createServerFn() { return { handler: (f: () => number) => f }; }\nexport const a = createServerFn().handler(() => 1);",
      ],
      [
        "createServerFn from another package",
        'import { createServerFn } from "./my-start";\nexport const a = createServerFn().handler(() => 1);',
      ],
      [
        "a server API only in an isomorphic function's server branch",
        'import { createIsomorphicFn } from "@tanstack/react-start";\nimport { getRequest } from "@tanstack/react-start/server";\nexport const f = createIsomorphicFn().client(() => null).server(() => getRequest().url);',
      ],
      [
        "a file route without a server option",
        'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/")({ component: () => null });',
      ],
      ["a syntax error", 'import { createServerFn } from "@tanstack/react-start";\nconst = ;'],
    ])("%s", (_name, source) => {
      expect(collect("src/routes/index.tsx", source)).toEqual([]);
    });

    it("binary and non-module files", () => {
      expect(
        collectThemeClientOnlyPreviewLimits([
          { path: "public/logo.png" },
          file("README.md", "createServerFn()"),
          file(
            "node_modules/x/index.js",
            'import { createServerFn } from "@tanstack/react-start"; createServerFn();',
          ),
        ]),
      ).toEqual([]);
    });

    it("the starter Theme and its catalog module", () => {
      expect(
        collectThemeClientOnlyPreviewLimits([
          ...STARTER_THEME_FILES,
          ...STARTER_THEME_CATALOG_FILES,
        ]),
      ).toEqual([]);
    });
  });

  it("orders by file and line, and caps the list", () => {
    const many = Array.from({ length: MAX_CLIENT_ONLY_PREVIEW_LIMITS + 5 }, (_, index) =>
      file(
        `src/fns/f${String(index).padStart(3, "0")}.ts`,
        'import { createServerFn } from "@tanstack/react-start";\nexport const a = createServerFn().handler(() => 1);',
      ),
    ).reverse();
    const limits = collectThemeClientOnlyPreviewLimits(many);
    expect(limits).toHaveLength(MAX_CLIENT_ONLY_PREVIEW_LIMITS);
    expect(limits[0]?.file).toBe("src/fns/f000.ts");
  });
});

describe("the runtime a preview start reports", () => {
  const files = [
    file(
      "src/routes/index.tsx",
      'import { createServerFn } from "@tanstack/react-start";\nexport const a = createServerFn().handler(() => 1);',
    ),
  ];

  it("lists limits for a client-only preview of a Start Theme", () => {
    expect(
      themePreviewRuntimeReport({
        previewRuntime: undefined,
        frameworkId: "tanstack-start",
        files,
      }),
    ).toEqual({
      previewRuntime: "client",
      clientOnlyLimits: [
        { file: "src/routes/index.tsx", line: 2, kind: "createServerFn" },
      ],
    });
  });

  it("lists none for the full Start preview", () => {
    expect(
      themePreviewRuntimeReport({
        previewRuntime: "start",
        frameworkId: "tanstack-start",
        files,
      }),
    ).toEqual({ previewRuntime: "start", clientOnlyLimits: [] });
  });

  it("lists none for another framework, or one that did not resolve", () => {
    for (const frameworkId of ["astro", null]) {
      expect(
        themePreviewRuntimeReport({
          previewRuntime: undefined,
          frameworkId,
          files,
        }).clientOnlyLimits,
      ).toEqual([]);
    }
  });
});
