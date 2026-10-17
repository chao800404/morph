import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES,
  MAX_CLIENT_ONLY_PREVIEW_LIMITS,
  MAX_CLIENT_ONLY_PREVIEW_TOTAL_BYTES,
  collectThemeClientOnlyPreviewLimits,
  themePreviewRuntimeReport,
} from "./theme-client-only-preview-limits";
import { STARTER_THEME_CATALOG_FILES } from "../starter-theme-catalog-files";
import { STARTER_THEME_FILES } from "../starter-theme-files";

const file = (path: string, content: string) => ({ path, content });
const collect = (path: string, content: string) =>
  collectThemeClientOnlyPreviewLimits([file(path, content)]).limits;
const NOTHING = { limits: [], omitted: 0, incomplete: false };

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
    ])("%s", (_name, source) => {
      expect(
        collectThemeClientOnlyPreviewLimits([file("src/routes/index.tsx", source)]),
      ).toEqual(NOTHING);
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
      ).toEqual(NOTHING);
    });

    it("the starter Theme and its catalog module", () => {
      expect(
        collectThemeClientOnlyPreviewLimits([
          ...STARTER_THEME_FILES,
          ...STARTER_THEME_CATALOG_FILES,
        ]),
      ).toEqual(NOTHING);
    });
  });

  // Review C15 probes: a nested declaration shadows the import only inside
  // its own scope, so it must not hide the file's other uses.
  describe("a nested declaration does not hide the file's uses", () => {
    it("a nested `const start` beside a namespace import", () => {
      expect(
        collect(
          "src/lib/data.ts",
          [
            'import * as start from "@tanstack/react-start";',
            "export const a = start.createServerFn().handler(() => 1);",
            "export function f() { const start = 1; return start; }",
          ].join("\n"),
        ),
      ).toEqual([{ file: "src/lib/data.ts", line: 2, kind: "createServerFn" }]);
    });

    it("a nested `const createServerFn`", () => {
      expect(
        collect(
          "src/lib/data.ts",
          [
            'import { createServerFn } from "@tanstack/react-start";',
            "export const a = createServerFn().handler(() => 1);",
            "export function f() { const createServerFn = () => 2; return createServerFn; }",
          ].join("\n"),
        ),
      ).toEqual([{ file: "src/lib/data.ts", line: 2, kind: "createServerFn" }]);
    });

  });

  describe("dynamic imports of the server module", () => {
    it("reports a string or substitution-free template specifier", () => {
      expect(
        collect(
          "src/lib/lazy.ts",
          [
            'export const a = () => import("@tanstack/react-start/server");',
            "export const b = () => import(`@tanstack/react-start/server`);",
          ].join("\n"),
        ),
      ).toEqual([
        { file: "src/lib/lazy.ts", line: 1, kind: "server-api", names: [] },
        { file: "src/lib/lazy.ts", line: 2, kind: "server-api", names: [] },
      ]);
    });

    it("does not resolve a template with a substitution (stated limit)", () => {
      expect(
        collect(
          "src/lib/lazy.ts",
          'const name = "server";\nexport const a = () => import(`@tanstack/react-start/${name}`);',
        ),
      ).toEqual([]);
    });
  });

  describe("fails safe: an unread file makes the result incomplete, never empty-and-complete", () => {
    const serverFn =
      'import { createServerFn } from "@tanstack/react-start";\nexport const a = createServerFn().handler(() => 1);\n';

    it("a syntax error", () => {
      expect(
        collectThemeClientOnlyPreviewLimits([
          file("src/routes/index.tsx", 'import { createServerFn } from "@tanstack/react-start";\nconst = ;'),
        ]),
      ).toEqual({ limits: [], omitted: 0, incomplete: true });
    });

    it("a very deep member chain does not throw", () => {
      const source = `${serverFn}export const deep = a${".b".repeat(50_000)};\n`;
      const result = collectThemeClientOnlyPreviewLimits([file("src/lib/deep.ts", source)]);
      // The walk is iterative, so the use is still found.
      expect(result.limits).toEqual([{ file: "src/lib/deep.ts", line: 2, kind: "createServerFn" }]);
      expect(result.incomplete).toBe(false);
    });

    it("4000 nested divs do not throw", () => {
      const source = `${serverFn}export const C = () => (${"<div>".repeat(4000)}x${"</div>".repeat(4000)});\n`;
      const result = collectThemeClientOnlyPreviewLimits([file("src/routes/deep.tsx", source)]);
      expect(
        result.limits.length > 0 || result.incomplete,
        JSON.stringify(result),
      ).toBe(true);
    });

    it("an analysis that throws is reported as incomplete by the start", () => {
      const exploding = {
        path: "src/routes/index.tsx",
        get content(): string {
          throw new RangeError("Maximum call stack size exceeded");
        },
      };
      expect(
        themePreviewRuntimeReport({
          previewRuntime: undefined,
          frameworkId: "tanstack-start",
          files: [exploding],
        }),
      ).toEqual({
        previewRuntime: "client",
        clientOnlyLimits: [],
        clientOnlyLimitsOmitted: 0,
        clientOnlyLimitsIncomplete: true,
      });
    });
  });

  describe("byte limits", () => {
    const serverFn = (path: string) =>
      file(
        path,
        'import { createServerFn } from "@tanstack/react-start";\nexport const a = createServerFn().handler(() => 1);\n',
      );
    const padded = (path: string, bytes: number) => {
      const base = serverFn(path).content;
      return file(path, `${base}//${"x".repeat(bytes - base.length - 3)}\n`);
    };

    it("reads a file at the per-file limit", () => {
      const result = collectThemeClientOnlyPreviewLimits([
        padded("src/a.ts", MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES),
      ]);
      expect(result.limits).toHaveLength(1);
      expect(result.incomplete).toBe(false);
    });

    it("skips a file over the per-file limit, counting UTF-8 bytes, and says so", () => {
      // 1 byte over in UTF-8, though not in UTF-16 units: "é" is 2 bytes.
      const base = padded("src/a.ts", MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES);
      const result = collectThemeClientOnlyPreviewLimits([
        file("src/a.ts", `${base.content.slice(0, -2)}é\n`),
        serverFn("src/b.ts"),
      ]);
      expect(result.limits).toEqual([{ file: "src/b.ts", line: 2, kind: "createServerFn" }]);
      expect(result.incomplete).toBe(true);
    });

    it("stops reading at the total budget, in path order, and says so", () => {
      const perFile = MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES;
      const fit = MAX_CLIENT_ONLY_PREVIEW_TOTAL_BYTES / perFile;
      const files = Array.from({ length: fit + 1 }, (_, index) =>
        padded(`src/f${String(index).padStart(3, "0")}.ts`, perFile),
      );
      const result = collectThemeClientOnlyPreviewLimits(files.reverse());
      expect(result.limits).toHaveLength(fit);
      expect(result.limits.map((limit) => limit.file)).not.toContain(
        `src/f${String(fit).padStart(3, "0")}.ts`,
      );
      expect(result.incomplete).toBe(true);
    });
  });

  it("orders by file and line, and caps the list", () => {
    const many = Array.from({ length: MAX_CLIENT_ONLY_PREVIEW_LIMITS + 5 }, (_, index) =>
      file(
        `src/fns/f${String(index).padStart(3, "0")}.ts`,
        'import { createServerFn } from "@tanstack/react-start";\nexport const a = createServerFn().handler(() => 1);',
      ),
    ).reverse();
    const result = collectThemeClientOnlyPreviewLimits(many);
    expect(result.limits).toHaveLength(MAX_CLIENT_ONLY_PREVIEW_LIMITS);
    expect(result.limits[0]?.file).toBe("src/fns/f000.ts");
    // The rest are counted, so the notice can say "and 5 more".
    expect(result.omitted).toBe(5);
    expect(result.incomplete).toBe(false);
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
      clientOnlyLimitsOmitted: 0,
      clientOnlyLimitsIncomplete: false,
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

  // Research C4: "client-only" and "full Start" are not Astro preview modes,
  // so an Astro start must not carry a field that reads like one, whatever
  // the deployment's Start setting and even if its files import Start.
  it.each([
    ["an Astro Theme on the default preview", "astro", undefined],
    ["an Astro Theme where the deployment runs the full Start preview", "astro", "start"],
    ["a framework that did not resolve", null, undefined],
    ["a framework that did not resolve, under the full Start preview", null, "start"],
  ] as const)("reports no runtime fields for %s", (_name, frameworkId, previewRuntime) => {
    const report = themePreviewRuntimeReport({
      previewRuntime,
      frameworkId,
      files,
    });
    expect(report).toStrictEqual({});
    expect("previewRuntime" in report).toBe(false);
    expect("clientOnlyLimits" in report).toBe(false);
  });
});
